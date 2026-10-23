// Snapshots of /etc/config: made on demand, before risky writes (see zeeli.rollback) and from
// the Backup page. Other areas call `create(reason)` before a write they might want to undo.
//
// Where they live: /overlay/zeeli/snapshots. The overlay is the router's flash, so snapshots
// survive a reboot (the point of a restore point), yet the folder sits outside /etc, so it is in
// neither a snapshot nor a sysupgrade backup. Each one is a plain copy of the files, about
// 450 kB, so 10 of them cost 5 MB of 6 GB.
'use strict';

import { lsdir, open, readfile, stat } from 'fs';
import { cursor as uci_cursor } from 'uci';
import { cursor, fail, paths, run, services } from 'zeeli.common';

/** Snapshots kept; the oldest go first. */
const KEEP = 10;
const ID = /^s([0-9]+)(-([0-9]+))?$/;
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

function confdir() {
	return paths.confdir ?? '/etc/config';
}

/** The tests keep snapshots in their sandbox, so nothing touches the router's flash. */
function snapdir() {
	return paths.confdir ? `${paths.state}/snapshots` : '/overlay/zeeli/snapshots';
}

/** UCI files directly in `dir`, sorted. Folders such as cellular/ are not settings files. */
function configFiles(dir) {
	return filter(sort(lsdir(dir) ?? []), (n) => match(n, FILE) != null && stat(`${dir}/${n}`)?.type == 'file');
}

function meta(id) {
	try {
		const m = json(readfile(`${snapdir()}/${id}/meta.json`));
		return type(m) == 'object' ? { ...m, id } : null;
	} catch (e) {
		return null;
	}
}

/** Ids are `s<time>`, or `s<time>-<n>` for the n-th within one second, so they order by those numbers. */
function age(id) {
	const m = match(id, ID);
	return int(m[1]) * 10000 + int(m[3] ?? 0);
}

/** Newest first. */
function list() {
	const found = filter(map(lsdir(snapdir()) ?? [], (id) => match(id, ID) ? meta(id) : null), (m) => m != null);
	return sort(found, (a, b) => age(b.id) - age(a.id));
}

/** A snapshot by id. The id is only ever matched against what is on disk, never used as a path first. */
function find(id) {
	return type(id) == 'string' ? filter(list(), (m) => m.id == id)[0] : null;
}

function remove(id) {
	const snap = find(id);
	if (!snap) return fail('That snapshot is already gone.');
	run(['rm', '-rf', `${snapdir()}/${snap.id}`]);
	return { id: snap.id };
}

/**
 * Copy the settings files (or just `only`, a list of config names) and keep the newest KEEP.
 * Returns the snapshot, or { error }.
 */
function create(reason, only) {
	const files = filter(configFiles(confdir()), (n) => only == null || index(only, n) >= 0);
	if (!length(files)) return fail('There are no settings files to save.');
	const base = snapdir();
	const now = time();
	// always newer than the newest, so order and pruning hold even within one second
	const newest = length(list()) ? age(list()[0].id) : 0;
	const at = now * 10000 > newest ? now * 10000 : newest + 1;
	const n = at % 10000;
	const id = n == 0 ? `s${at / 10000}` : `s${(at - n) / 10000}-${n}`;
	const dir = `${base}/${id}`;
	let r = run(['mkdir', '-p', `${dir}/config`]);
	if (r.code == 0) r = run(['cp', '-p', ...map(files, (n) => `${confdir()}/${n}`), `${dir}/config/`]);
	if (r.code != 0) {
		run(['rm', '-rf', dir]);
		return fail(`Couldn’t save a snapshot: ${trim(r.stdout)}`);
	}
	let size = 0;
	for (let n in files) size += stat(`${dir}/config/${n}`)?.size ?? 0;
	const m = { time: now, reason: `${reason}`, size, configs: files };
	const f = open(`${dir}/meta.json`, 'w');
	f.write(sprintf('%J', m));
	f.close();
	for (let old in slice(list(), KEEP)) run(['rm', '-rf', `${base}/${old.id}`]);
	return { ...m, id };
}

/**
 * What it takes to make the router use a restored file. These services re-read their settings
 * on reload. Anything else (GL’s own settings, kmwan, mlo) is read at startup or by services
 * we can’t safely reload from here, so the router needs a restart for it to take effect.
 */
const RELOAD = {
	network: 'network',
	// OpenWrt’s network reload also reloads WiFi, which is how wireless changes apply
	wireless: 'network',
	dhcp: 'dnsmasq',
	firewall: 'firewall',
	system: 'system',
	dropbear: 'dropbear',
	// the agent reads its own settings on every call
	zeeli: null,
};
const RELOAD_ORDER = ['network', 'dnsmasq', 'firewall', 'system', 'dropbear'];

/**
 * Write a snapshot's files back over the current ones (only those that differ, and only
 * `only` if given), then reload what can be reloaded. Unless `only` is given (the rollback
 * timer, which is itself the undo) a fresh snapshot is made first, so a restore can be undone.
 * Returns { restored, reloaded, rebootNeeded, summary, undo }.
 */
function restore(id, only) {
	const snap = find(id);
	if (!snap) return fail('That snapshot is gone.');
	const src = `${snapdir()}/${snap.id}/config`;
	const differ = filter(snap.configs, (n) => (only == null || index(only, n) >= 0) && readfile(`${src}/${n}`) != readfile(`${confdir()}/${n}`));
	if (!length(differ)) return { restored: [], reloaded: [], rebootNeeded: false, summary: 'The router already matches this snapshot.', undo: null };

	let undo = null;
	if (only == null) {
		undo = create(`Before restoring the snapshot from ${snap.reason}`);
		if (undo.error) return undo;
	}
	const r = run(['cp', '-p', ...map(differ, (n) => `${src}/${n}`), `${confdir()}/`]);
	if (r.code != 0) return fail(`Couldn’t write the settings back: ${trim(r.stdout)}`);

	const wanted = [];
	const needsRestart = [];
	for (let n in differ) {
		if (!(n in RELOAD)) push(needsRestart, n);
		else if (RELOAD[n] != null && index(wanted, RELOAD[n]) < 0) push(wanted, RELOAD[n]);
	}
	const reloaded = filter(RELOAD_ORDER, (s) => index(wanted, s) >= 0);
	for (let s in reloaded) services.reload(s);

	const names = join(', ', differ);
	let summary = `Restored ${names}.`;
	if (length(reloaded)) summary += ` Reloaded ${join(', ', reloaded)} so the change is live now.`;
	if (length(needsRestart))
		summary += ` ${join(', ', needsRestart)} ${length(needsRestart) == 1 ? 'is' : 'are'} only read when the router starts, so restart it for that to take effect.`;
	return { restored: differ, reloaded, rebootNeeded: length(needsRestart) > 0, summary, undo: undo?.id ?? null };
}

/** Where two UCI sections that have no name of their own are matched up: by type and `name`, else by position. */
function sectionKeys(all) {
	const seen = {};
	const keys = {};
	for (let sid, s in all) {
		let key;
		if (!s['.anonymous']) key = `${s['.type']} ${sid}`;
		else {
			key = s.name != null ? `${s['.type']} ${s.name}` : `${s['.type']}`;
			seen[key] = (seen[key] ?? 0) + 1;
			if (seen[key] > 1 || s.name == null) key = `${key} #${seen[key]}`;
		}
		keys[key] = s;
	}
	return keys;
}

const skip = (o) => match(o, /^\./) != null;

/**
 * What changed in the settings since a snapshot. Only names of options, never their values,
 * so a diff can't show a WiFi key or a password.
 * Returns { files: [{ name, change, sections: [{ section, change, options }] }] }.
 */
function diff(id) {
	const snap = find(id);
	if (!snap) return fail('That snapshot is gone.');
	const src = `${snapdir()}/${snap.id}/config`;
	const nowFiles = configFiles(confdir());
	const names = sort(uniq([...nowFiles, ...snap.configs]));
	const files = [];
	const old = uci_cursor(src);
	const now = cursor();
	for (let name in names) {
		const a = readfile(`${src}/${name}`);
		const b = readfile(`${confdir()}/${name}`);
		if (a == b) continue;
		if (a == null || b == null) {
			push(files, { name, change: a == null ? 'added' : 'removed', sections: [] });
			continue;
		}
		const before = sectionKeys(old.get_all(name) ?? {});
		const after = sectionKeys(now.get_all(name) ?? {});
		const sections = [];
		for (let key in sort(uniq([...keys(before), ...keys(after)]))) {
			const x = before[key], y = after[key];
			if (x == null) push(sections, { section: key, change: 'added', options: [] });
			else if (y == null) push(sections, { section: key, change: 'removed', options: [] });
			else {
				const opts = filter(sort(uniq([...keys(x), ...keys(y)])), (o) => !skip(o) && sprintf('%J', x[o]) != sprintf('%J', y[o]));
				if (length(opts)) push(sections, { section: key, change: 'changed', options: opts });
			}
		}
		push(files, { name, change: 'changed', sections: slice(sections, 0, 200) });
	}
	return { files };
}

// this ucode needs exports listed rather than marked inline
export { KEEP, create, list, find, remove, restore, diff };
