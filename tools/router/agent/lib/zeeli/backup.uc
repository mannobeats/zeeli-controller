// zeeli.backup, the file half: the standard OpenWrt backup archive (what `sysupgrade -b` makes),
// downloaded through GL’s /download and restored from a file sent to GL’s /upload.
//
// GL’s endpoints only move files whose path matches a pattern in /usr/share/gl-download.d or
// gl-upload.d, and then only for an admin session. The agent adds one pattern for each, naming
// exactly one folder and filename shape in /tmp/zeeli, and the console never chooses a path: it
// asks the agent where to send or fetch, and the agent only ever opens those files.
//
// Restoring is deliberately slow and explicit: the archive is listed and checked, the person
// confirms the file they were shown (a token over its contents), the current settings are
// snapshotted, and the router must be restarted afterwards.
'use strict';

import { chmod, lsdir, lstat, mkdir, readfile, stat, unlink, writefile } from 'fs';
import { fail, paths, run } from 'zeeli.common';
import { create } from 'zeeli.snapshots';

/** The largest archive we take: a backup of a busy router is well under 1 MB. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_UNPACKED = 64 * 1024 * 1024;
const MAX_FILES = 5000;

const BACKUP = /^backup-[0-9]+\.tar\.gz$/;

/** The sandbox keeps these inside the test folder, and unpacks into a fake root. */
function folder() {
	return paths.confdir ? `${paths.state}/files` : '/tmp/zeeli';
}

function root() {
	return paths.confdir ? `${paths.state}/root` : '/';
}

const upload = () => `${folder()}/restore.tar.gz`;

/**
 * One line per allowed shape, as Lua patterns, which is what GL’s endpoints read. Written on
 * first use rather than shipped, so an agent installed before this existed still works.
 */
const ALLOW = [
	{ file: '/usr/share/gl-upload.d/zeeli', lines: ['/tmp/zeeli/restore%.tar%.gz$'] },
	{ file: '/usr/share/gl-download.d/zeeli', lines: ['/tmp/zeeli/backup%-[0-9]+%.tar%.gz$'] },
];

function allow() {
	if (paths.confdir) return;
	for (let a in ALLOW) {
		const want = `${join('\n', a.lines)}\n`;
		if (readfile(a.file) != want) writefile(a.file, want);
	}
}

/**
 * Make sure the working folder is ours: created here with mode 0700, or already a real folder
 * owned by root. Anything else (a link, a folder someone else made) could send a backup, which
 * holds the router’s passwords and keys, to the wrong place. Returns null, or why not.
 */
function ready() {
	if (lstat(folder()) == null && !mkdir(folder(), 448)) // 0700
		return 'The router couldn’t create its backup folder.';
	const st = lstat(folder());
	if (st?.type != 'directory' || st.uid != 0)
		return 'The router’s backup folder isn’t safe to use, because it isn’t a plain folder owned by root, so nothing was written. Remove it and try again.';
	chmod(folder(), 448);
	allow();
	return null;
}

/** How long a backup stays fetchable if the console never says it has it. Tests replace `start`. */
const expiry = {
	start: function(filename) {
		if (paths.confdir) return;
		run(['/usr/libexec/zeeli/zeeli-backup-expire', filename]);
	},
};

function clear(pattern) {
	for (let n in lsdir(folder()) ?? []) if (match(n, pattern)) unlink(`${folder()}/${n}`);
}

/**
 * Make a fresh archive of the router’s settings for the console to fetch.
 * Returns { path, filename, size }.
 */
function download() {
	const bad = ready();
	if (bad) return fail(bad);
	clear(BACKUP);
	const filename = `backup-${time()}.tar.gz`;
	const path = `${folder()}/${filename}`;
	let r;
	if (paths.confdir) {
		// the tests have no router to back up, so they pack the sandbox’s settings the same way
		run(['mkdir', '-p', `${paths.state}/stage/etc`]);
		run(['cp', '-R', paths.confdir, `${paths.state}/stage/etc/config`]);
		r = run(['tar', '-czf', path, '-C', `${paths.state}/stage`, 'etc']);
	} else r = run(['sysupgrade', '-b', path]);
	const size = stat(path)?.size ?? 0;
	if (r.code != 0 || size == 0) {
		unlink(path);
		return fail(`The router couldn’t make a backup: ${trim(r.stdout) || 'no file was written'}`);
	}
	chmod(path, 384); // 0600
	expiry.start(filename);
	return { path, filename, size };
}

/** The console has the file: delete it, since it holds passwords and keys. */
function finish() {
	clear(BACKUP);
	return {};
}

/** Where the console sends a file to restore from, after clearing the last one. */
function prepare() {
	const bad = ready();
	if (bad) return fail(bad);
	clear(/^restore\.tar\.gz$/);
	return { path: upload(), maxBytes: MAX_BYTES };
}

/** The upload gone, whether it was used or not. */
function discard() {
	unlink(upload());
	return {};
}

/** The archive’s entries, or why it can’t be trusted. */
function listing(path) {
	const r = run(['tar', '-tvzf', path]);
	if (r.code != 0) return fail('That file isn’t a backup archive from a router.');
	const files = [];
	let unpacked = 0;
	for (let line in split(trim(r.stdout), '\n')) {
		const m = match(line, /^([-dlhcbps])[rwxsStT-]{9} +[^ ]+ +([0-9]+) +[0-9-]+ +[0-9:]+ +(.*)$/);
		if (!m) return fail('That archive has entries the router can’t read, so it wasn’t restored.');
		const kind = m[1], size = m[2], name = m[3];
		// only plain files and folders: a link could point anywhere once it is unpacked. tar prints
		// the target after “ -> ” and takes the type letter from the entry’s own mode bits, which an
		// archive can lie about, so restore() looks at what was really unpacked as well.
		if ((kind != '-' && kind != 'd') || index(name, ' -> ') >= 0 || index(name, ' link to ') >= 0) return fail('That archive contains links or special files, so it wasn’t restored.');
		if (match(name, /^\//) || index(split(name, '/'), '..') >= 0 || match(name, /[[:cntrl:]]/))
			return fail(`That archive has a file that points outside its own folders (${name}), so it wasn’t restored.`);
		unpacked += int(size);
		// the firmware's own backups also carry a few files outside /etc (GL keeps /lib/wifi
		// settings); those are left out, only /etc is restored
		push(files, { name, kind, outside: !match(name, /^etc\//) });
	}
	if (length(files) > MAX_FILES || unpacked > MAX_UNPACKED) return fail('That archive is far bigger than a router backup, so it wasn’t restored.');
	if (!length(filter(files, (f) => match(f.name, /^etc\/config\/./) && f.kind == '-')))
		return fail('That archive has no router settings in it.');
	return { files, unpacked };
}

function digest(path) {
	return split(trim(run(['sha256sum', path]).stdout), ' ')[0];
}

/**
 * Check the uploaded archive and describe it. The token it returns names these exact bytes;
 * restore() only takes that token, so what gets restored is what the person was shown.
 */
function inspect() {
	const size = stat(upload())?.size;
	if (!size) return fail('No backup file has been sent yet.');
	if (size > MAX_BYTES) {
		unlink(upload());
		return fail('That file is too big to be a router backup.');
	}
	const l = listing(upload());
	if (l.error) return l;
	const configs = filter(l.files, (f) => match(f.name, /^etc\/config\/[^\/]+$/) && f.kind == '-');
	const plain = filter(l.files, (f) => f.kind == '-');
	return {
		token: digest(upload()),
		bytes: size,
		files: length(filter(plain, (f) => !f.outside)),
		configs: length(configs),
		leftOut: length(filter(plain, (f) => f.outside)),
	};
}

/**
 * Unpack beside the router’s files and look at what really came out: only plain files and
 * folders, all under etc/. Returns null when it is safe to copy from `stage`, else why not
 * (and removes `stage`).
 */
function unpack(file, stage) {
	run(['rm', '-rf', stage]);
	run(['mkdir', '-p', stage]);
	const r = run(['tar', '-xzf', file, '-C', stage]);
	const odd = r.code == 0 ? trim(run(['find', stage, '!', '-type', 'f', '!', '-type', 'd']).stdout) : '';
	if (r.code == 0 && odd == '' && index(lsdir(stage) ?? [], 'etc') >= 0) {
		// only etc/ is restored; the rest of an unpacked firmware backup is plain files, dropped here
		for (let n in lsdir(stage)) if (n != 'etc') run(['rm', '-rf', `${stage}/${n}`]);
		return null;
	}
	run(['rm', '-rf', stage]);
	return r.code != 0 ? 'The router couldn’t unpack that archive, so nothing was restored.' : 'That archive contains links or files outside /etc, so nothing was restored.';
}

/** Put the archive’s files over the router’s. The router must restart afterwards. */
function restore(token) {
	const check = inspect();
	if (check.error) return check;
	if (token != check.token) return fail('That isn’t the file you were shown. Choose it again.');
	const undo = create('Before restoring a backup file');
	if (undo.error) return undo;
	const stage = `${folder()}/stage`;
	const bad = unpack(upload(), stage);
	unlink(upload());
	if (bad) return fail(bad);
	run(['mkdir', '-p', `${root()}/etc`]);
	const r = run(['cp', '-pR', `${stage}/etc/.`, `${root()}/etc/`]);
	run(['rm', '-rf', stage]);
	if (r.code != 0) return fail(`The backup was only partly restored (${trim(r.stdout)}). Restore the snapshot from just before it, then restart the router.`);
	return { restored: check.files, rebootRequired: true, undo: undo.id };
}

// this ucode needs exports listed rather than marked inline
export { MAX_BYTES, expiry, download, finish, prepare, discard, inspect, unpack, restore };
