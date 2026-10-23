'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { paths, run } from 'zeeli.common';
import * as backup from 'zeeli.backup';
import * as snapshots from 'zeeli.snapshots';
import { lsdir, readfile, stat, unlink, writefile } from 'fs';

const rpc = plugin('backup')['zeeli.backup'];
const call = (method, args) => rpc[method].call({ args: args ?? {} });
const dir = () => `${paths.state}/files`;
const restoreFile = () => `${dir()}/restore.tar.gz`;

/** A ustar archive with the given entries, gzipped, written to `path`. Lets the tests build archives no tool would. */
function archive(path, entries) {
	// NUL bytes come from hexdec: replace() would cut a string at its first one
	const pad = (s, n) => n > length(s) ? s + hexdec(replace(sprintf(`%${n - length(s)}s`, ''), ' ', '00')) : s;
	let out = '';
	for (let e in entries) {
		const body = e.body ?? '';
		const fields = [
			pad(e.name, 100), pad('0000644', 8), pad('0000000', 8), pad('0000000', 8),
			pad(sprintf('%011o', length(body)), 12), pad('00000000000', 12), '        ',
			e.type ?? '0', pad(e.link ?? '', 100), pad('ustar', 6), '00', pad('', 32), pad('', 32), pad('', 8), pad('', 8), pad('', 155),
		];
		let header = pad(join('', fields), 512);
		let sum = 0;
		for (let i = 0; i < 512; i++) sum += ord(header, i);
		header = substr(header, 0, 148) + sprintf('%06o', sum) + chr(0) + ' ' + substr(header, 156);
		out += header + body + (length(body) % 512 ? pad('', 512 - length(body) % 512) : '');
	}
	writefile(`${path}.tar`, out + pad('', 1024));
	run(['gzip', '-f', `${path}.tar`]);
	run(['mv', `${path}.tar.gz`, path]);
}

const upload = (entries) => {
	call('prepare');
	archive(restoreFile(), entries);
};
const good = [{ name: 'etc/', type: '5' }, { name: 'etc/config/', type: '5' }, { name: 'etc/config/firewall', body: "config rule\n\toption name 'From backup'\n" }];

test('a backup is the router’s settings in an archive the console can fetch', () => {
	const r = call('download');
	ok(!r.error, r.error);
	ok(match(r.filename, /^backup-[0-9]+\.tar\.gz$/), r.filename);
	eq(r.path, `${dir()}/${r.filename}`);
	ok(r.size > 1000, 'it holds the settings');
	ok(match(run(['tar', '-tzf', r.path]).stdout, /etc\/config\/firewall/), 'with the usual etc/ paths');
	eq(stat(r.path).mode % 512, 384, 'readable by root only');
	const again = call('download');
	eq(filter(lsdir(dir()), (n) => match(n, /^backup-/)), [again.filename], 'only the newest is kept');
});

test('preparing a restore names the one place a file may go, and empties it', () => {
	writefile(restoreFile(), 'old');
	const r = call('prepare');
	eq(r, { path: restoreFile(), maxBytes: 8388608 });
	ok(!stat(restoreFile()), 'the last upload is gone');
});

test('there is nothing to inspect until a file is sent', () => {
	eq(call('inspect'), { error: 'No backup file has been sent yet.' });
});

test('a backup made here is accepted, described, and restored only with its token', () => {
	const made = call('download');
	call('prepare');
	run(['cp', made.path, restoreFile()]);
	const info = call('inspect');
	ok(!info.error, info.error);
	ok(match(info.token, /^[0-9a-f]{64}$/), info.token);
	ok(info.configs >= 5 && info.files >= info.configs, sprintf('%J', info));

	eq(call('restore_file', { token: 'nope' }), { error: 'That isn’t the file you were shown. Choose it again.' });
	eq(call('restore_file', { token: replace(sprintf('%64s', ''), ' ', '0') }), { error: 'That isn’t the file you were shown. Choose it again.' });
	ok(stat(restoreFile()), 'a refused token leaves the upload alone');

	const before = length(snapshots.list());
	writefile(`${paths.confdir}/firewall`, 'changed after the backup\n');
	const r = call('restore_file', { token: info.token });
	ok(!r.error, r.error);
	eq(r.rebootRequired, true);
	eq(r.restored, info.files);
	ok(!stat(restoreFile()), 'the upload is used up');
	eq(snapshots.find(r.undo).reason, 'Before restoring a backup file');
	eq(length(snapshots.list()), before + 1);
	ok(match(readfile(`${paths.state}/root/etc/config/firewall`), /config zone/), 'files land in the root, under etc/');
});

test('an archive for a different file than the one shown is refused', () => {
	upload(good);
	const first = call('inspect').token;
	upload([...good, { name: 'etc/config/dhcp', body: 'x\n' }]);
	eq(call('restore_file', { token: first }), { error: 'That isn’t the file you were shown. Choose it again.' });
});

test('archives that could write outside etc, or through links, are never unpacked', () => {
	for (let t in [
		[[...good, { name: 'root/.ssh/authorized_keys', body: 'k\n' }], 'That archive holds files outside /etc (root/.ssh/authorized_keys), so it wasn’t restored.'],
		[[...good, { name: 'etc/../../tmp/x', body: 'k\n' }], 'That archive has entries the router can’t read, so it wasn’t restored.'],
		[[...good, { name: '/etc/config/x', body: 'k\n' }], 'That archive has entries the router can’t read, so it wasn’t restored.'],
		[[...good, { name: './etc/config/x', body: 'k\n' }], 'That archive holds files outside /etc (./etc/config/x), so it wasn’t restored.'],
		[[...good, { name: 'etc/passwd-link', type: '2', link: '/etc/passwd' }], 'That archive contains links or special files, so it wasn’t restored.'],
		[[...good, { name: 'etc/hard', type: '1', link: 'etc/config/firewall' }], 'That archive contains links or special files, so it wasn’t restored.'],
		[[{ name: 'etc/', type: '5' }, { name: 'etc/hosts', body: 'x\n' }], 'That archive has no router settings in it.'],
	]) {
		upload(t[0]);
		eq(call('inspect').error, t[1], t[1]);
		ok(!stat(`${paths.state}/root/etc/hosts`), 'nothing was unpacked');
	}
	ok(!stat(`${paths.state}/root/tmp/x`) && !stat(`${paths.state}/root/root`), 'nothing escaped');
});

test('what is unpacked is checked again, whatever the listing said', () => {
	// a link whose mode bits make tar list it as a plain file: only looking at the files catches it
	const stage = `${paths.state}/stage-test`;
	call('prepare');
	archive(restoreFile(), [...good, { name: 'etc/evil', type: '2', link: '/etc/passwd' }]);
	eq(backup.unpack(restoreFile(), stage), 'That archive contains links or files outside /etc, so nothing was restored.');
	ok(!stat(stage), 'the staging folder is removed');
	archive(restoreFile(), good);
	eq(backup.unpack(restoreFile(), stage), null);
	ok(stat(`${stage}/etc/config/firewall`), 'a good archive is left in place to copy from');
	run(['rm', '-rf', stage]);
	call('prepare');
	writefile(restoreFile(), 'junk');
	eq(backup.unpack(restoreFile(), stage), 'The router couldn’t unpack that archive, so nothing was restored.');
});

test('files that aren’t archives, or are too big, are refused', () => {
	call('prepare');
	writefile(restoreFile(), 'not a tar file at all');
	eq(call('inspect'), { error: 'That file isn’t a backup archive from a router.' });
	call('prepare');
	run(['dd', 'if=/dev/zero', `of=${restoreFile()}`, 'bs=1048576', 'count=9']);
	eq(call('inspect'), { error: 'That file is too big to be a router backup.' });
	ok(!stat(restoreFile()), 'it is deleted');
});

test('the upload can be discarded', () => {
	upload(good);
	eq(call('discard'), {});
	ok(!stat(restoreFile()));
});

done();
