// zeeli.stats: history, events and alerts. The collector service writes (see collector.uc);
// the rpcd object reads and changes settings. Everything lives under `paths.state` (RAM) and
// is copied to flash every 15 minutes by `persist`, and back by `restore` after a reboot.
'use strict';

import { cursor, paths, fail, valid } from 'zeeli.common';
import { dirname, lsdir, mkdir, open, readfile, rename, rmdir, stat, unlink, writefile } from 'fs';
import * as ring from 'zeeli.ring';

/** The history kinds, and which slot layout each one uses. */
const KINDS = { wan: 'traffic', network: 'traffic', client: 'traffic', system: 'system', health: 'health' };

/** A range reads one tier; the day's minutes are folded into five-minute points. */
const RANGES = { '24h': { tier: 0, fold: 5 }, '30d': { tier: 1, fold: 1 }, '12m': { tier: 2, fold: 1 } };

const EVENT_KINDS = ['device.new', 'device.joined', 'device.left', 'wan.down', 'wan.up', 'wan.failover', 'temp.high'];
/** Alerts on until someone changes them: the rare and important ones, not every join. */
const ALERT_KINDS = ['device.new', 'wan.down', 'wan.up', 'wan.failover', 'temp.high'];
const MAX_EVENTS = 500;
const MAX_CLIENTS = 96;
const YEAR = 366 * 86400;

const DEFAULTS = { target: '1.1.1.1', tempHigh: 85 };

const dir = () => `${paths.state}/stats`;
/** Flash copy. Under /overlay rather than /etc, so backups stay small and a factory reset clears it. */
const flashDir = () => getenv('ZEELI_PERSIST') ?? (paths.confdir ? `${paths.state}.flash` : '/overlay/zeeli');

function mkdirp(path) {
	let at = '';
	for (let part in split(path, '/')) {
		if (part == '') {
			at = at == '' ? '/' : at;
			continue;
		}
		at = at == '/' ? `/${part}` : (at == '' ? part : `${at}/${part}`);
		if (!stat(at)) mkdir(at);
	}
	return stat(path) != null;
}

function rmrf(path) {
	const s = stat(path);
	if (!s) return;
	if (s.type == 'directory') {
		for (let name in lsdir(path)) rmrf(`${path}/${name}`);
		rmdir(path);
	} else {
		unlink(path);
	}
}

function readJson(path) {
	const text = readfile(path);
	if (!text) return null;
	try {
		return json(text);
	} catch (e) {
		return null;
	}
}

/** Write a small file so a reader never sees half of it. */
function writeAtomic(path, text) {
	writefile(`${path}.tmp`, text);
	rename(`${path}.tmp`, path);
}

/** A whole number from the console as a string ('50'), within bounds, or the default when missing. */
function count(v, fallback, min, max) {
	if (v == null || v == '') return fallback;
	if (type(v) != 'string' || !match(v, /^[0-9]{1,10}$/)) return null;
	const n = int(v);
	return n < min || n > max ? null : n;
}

/* ---------- history files ---------- */

/** The file name part of an id: a MAC without colons, lower case; other ids as they are. */
const keyOf = (kind, id) => kind == 'client' ? lc(replace(id, ':', '-')) : id;
const idOf = (kind, key) => kind == 'client' ? uc(replace(key, '-', ':')) : key;
const ringPath = (kind, key) => `${dir()}/${kind}.${key}.ring`;

/** The ids with history of one kind, from the files on disk. */
function ids(kind) {
	const out = [];
	for (let name in lsdir(dir()) ?? []) {
		const p = split(name, '.');
		if (length(p) == 3 && p[0] == kind && p[2] == 'ring') push(out, idOf(kind, p[1]));
	}
	return out;
}

/**
 * The id from the console, if we have history for it. Never use the raw string for a
 * path: it only selects one of the names found on disk.
 */
function known(kind, id) {
	if (type(id) != 'string' || length(id) > 40) return null;
	if (kind == 'client' ? !valid.mac(id) : !match(id, /^[A-Za-z0-9_]{1,32}$/)) return null;
	for (let have in ids(kind)) if (have == (kind == 'client' ? uc(id) : id)) return have;
	return null;
}

/** A number as people read it: gauges are stored scaled up to stay whole numbers. */
const scaled = (v, scale) => v == null || v % scale == 0 ? (v == null ? null : v / scale) : v / (scale * 1.0);

/** `at` is the time the range ends at; only tests pass it. */
function series(args, at) {
	const kind = args.kind, range = RANGES[args.range ?? ''];
	if (type(kind) != 'string' || !KINDS[kind]) return fail('Choose wan, network, client, system or health.');
	if (!range) return fail('Choose 24h, 30d or 12m.');
	const id = known(kind, args.id);
	if (!id) return fail(`There is no history for ${type(args.id) == 'string' ? substr(args.id, 0, 40) : 'that'} yet.`);

	const now = at ?? time();
	const off = ring.tzoff(now);
	const s = ring.fold(ring.read(ringPath(kind, keyOf(kind, id)), range.tier, now, off), range.fold);
	if (!s) return fail('That history file couldn’t be read.');
	const fields = ring.LAYOUTS[s.layout].fields;
	const points = map(s.rows, (row) => row ? map(row, (v, i) => scaled(v, fields[i].scale)) : null);
	const out = { kind, id, range: args.range, start: s.start, step: s.step, fields: map(fields, (f) => f.name), points };
	if (s.layout == 'traffic') {
		let down = 0, up = 0;
		for (let row in s.rows) if (row) { down += row[0] ?? 0; up += row[1] ?? 0; }
		out.totals = { down, up };
	}
	return out;
}

/**
 * Totals per range for every device, network and uplink, read straight off the rings. It
 * takes a fraction of a second per device, so the collector does it every ten minutes and
 * `top` only reads the answer.
 */
function summarize(at) {
	const now = at ?? time(), off = ring.tzoff(now);
	const out = { t: now };
	for (let name, range in RANGES) {
		out[name] = {};
		for (let kind in ['client', 'network', 'wan']) {
			out[name][kind] = {};
			for (let id in ids(kind)) {
				const s = ring.read(ringPath(kind, keyOf(kind, id)), range.tier, now, off);
				let down = 0, up = 0;
				for (let row in s?.rows ?? []) if (row) { down += row[0] ?? 0; up += row[1] ?? 0; }
				if (down + up > 0) out[name][kind][id] = [down, up];
			}
		}
	}
	writeAtomic(`${dir()}/summary.json`, sprintf('%J', out));
	return out;
}

function top(args) {
	if (!RANGES[args.range ?? '']) return fail('Choose 24h, 30d or 12m.');
	const only = args.kind;
	if (only != null && only != '' && (type(only) != 'string' || !(only in ['client', 'network', 'wan']))) return fail('Choose client, network or wan.');
	const limit = count(args.limit, 10, 1, 100);
	if (limit == null) return fail('The limit must be a number from 1 to 100.');
	const sum = readJson(`${dir()}/summary.json`);
	const out = { range: args.range, asOf: sum?.t ?? null };
	for (let kind in ['client', 'network', 'wan']) {
		if (only && only != kind) continue;
		const rows = [];
		for (let id, v in sum?.[args.range]?.[kind] ?? {}) push(rows, { id, down: v[0], up: v[1] });
		out[`${kind}s`] = slice(sort(rows, (a, b) => (b.down + b.up) - (a.down + a.up)), 0, limit);
	}
	return out;
}

/* ---------- settings ---------- */

/** A file for UCI to load: `uci set` on a config that doesn't exist yet fails. */
function ensureConfig() {
	const file = `${paths.confdir ?? '/etc/config'}/zeeli`;
	if (!stat(file)) writefile(file, '');
}

/** The saved settings, with defaults for what was never set. */
function config() {
	const c = cursor();
	const on = c.get('zeeli', 'zeeli_alerts', 'on');
	const temp = int(c.get('zeeli', 'zeeli_stats', 'temp_high') ?? DEFAULTS.tempHigh);
	return {
		target: c.get('zeeli', 'zeeli_stats', 'target') ?? DEFAULTS.target,
		tempHigh: temp > 0 ? temp : DEFAULTS.tempHigh,
		alerts: type(on) == 'array' ? on : (c.get('zeeli', 'zeeli_alerts') ? [] : ALERT_KINDS),
	};
}

/* ---------- events and alerts ---------- */

const eventsPath = () => `${dir()}/events.jsonl`;

function readEvents() {
	const out = [];
	for (let line in split(readfile(eventsPath()) ?? '', '\n')) {
		if (line == '') continue;
		try {
			const e = json(line);
			if (type(e) == 'object' && e.id != null) push(out, e);
		} catch (err) {
			// a half-written last line
		}
	}
	return out;
}

/** The newest event id, so the collector can carry on numbering after a restart. */
function lastEventId() {
	const all = readEvents();
	return length(all) ? all[length(all) - 1].id : 0;
}

/** Add an event (the collector's job). Keeps the file to the newest MAX_EVENTS. */
function addEvent(e) {
	const f = open(eventsPath(), 'a');
	if (!f) return false;
	f.write(sprintf('%J', e) + '\n');
	f.close();
	if (e.id % 50 == 0) {
		const all = readEvents();
		if (length(all) > MAX_EVENTS) writeAtomic(eventsPath(), join('', map(slice(all, -MAX_EVENTS), (x) => sprintf('%J', x) + '\n')));
	}
	return true;
}

function events(args) {
	const since = count(args.since, 0, 0, 4294967295), limit = count(args.limit, 100, 1, MAX_EVENTS);
	if (since == null || limit == null) return fail('since and limit must be whole numbers.');
	const kinds = args.kinds ?? [];
	if (type(kinds) != 'array' || length(filter(kinds, (k) => !(k in EVENT_KINDS))) > 0) return fail('Unknown event kind.');
	// one device or uplink; a MAC is compared in upper case, as events store it
	let subject = args.subject;
	if (subject != null && subject != '') {
		if (type(subject) != 'string' || !(valid.mac(subject) || match(subject, /^[A-Za-z0-9_]{1,32}$/))) return fail('That isn’t a device or uplink.');
		if (valid.mac(subject)) subject = uc(subject);
	}
	const out = [];
	for (let e in reverse(readEvents())) {
		if (e.t <= since && since > 0) continue;
		if (subject && e.subject != subject) continue;
		if (length(kinds) && !(e.kind in kinds)) continue;
		push(out, e);
		if (length(out) >= limit) break;
	}
	return { events: out };
}

const acksPath = () => `${dir()}/acks.json`;
const readAcks = () => readJson(acksPath()) ?? { before: 0, ids: [] };

/** Alerts people haven't acknowledged, newest first. */
function unread() {
	const acks = readAcks();
	return filter(reverse(readEvents()), (e) => e.alert && e.id > acks.before && !(e.id in acks.ids));
}

/** Acknowledgements are rare and small, so they also go straight to flash. */
function writeAcks(acks) {
	mkdirp(dir());
	writeAtomic(acksPath(), sprintf('%J', acks));
	if (stat(flashDir())) writeAtomic(`${flashDir()}/acks.json`, sprintf('%J', acks));
}

function alerts(args) {
	const ack = args.ack ?? [], kinds = args.kinds;
	if (type(ack) != 'array' || length(filter(ack, (a) => type(a) != 'string' || !match(a, /^[0-9]{1,10}$/))) > 0) return fail('Acknowledge alerts by their number.');
	const save = args.save === true;
	if (save && (type(kinds) != 'array' || length(filter(kinds, (k) => !(k in EVENT_KINDS))) > 0)) return fail('Unknown alert kind.');

	if (save) {
		ensureConfig();
		const c = cursor();
		c.set('zeeli', 'zeeli_alerts', 'alerts');
		c.set('zeeli', 'zeeli_alerts', 'zeeli', '1');
		const on = filter(EVENT_KINDS, (k) => k in kinds);
		if (length(on)) c.set('zeeli', 'zeeli_alerts', 'on', on);
		else c.delete('zeeli', 'zeeli_alerts', 'on');
		c.save('zeeli');
		c.commit('zeeli');
	}
	if (args.all === true || length(ack)) {
		const acks = readAcks();
		if (args.all === true) {
			const all = readEvents();
			acks.before = length(all) ? all[length(all) - 1].id : acks.before;
			acks.ids = [];
		} else {
			for (let a in ack) if (!(int(a) in acks.ids)) push(acks.ids, int(a));
			// ids at or below the cursor are already read
			acks.ids = filter(acks.ids, (i) => i > acks.before);
		}
		writeAcks(acks);
	}
	const list = unread();
	return { alerts: list, unread: length(list), on: config().alerts, available: EVENT_KINDS };
}

/** An address or a host name that `ping` can take. It never starts with a dash. */
function validTarget(s) {
	if (type(s) != 'string' || length(s) > 253) return false;
	const v4 = match(s, /^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/);
	if (v4) return length(filter(slice(v4, 1), (o) => int(o) > 255)) == 0;
	return match(s, /^[0-9A-Fa-f:]{2,45}$/) != null && index(s, ':') >= 0 || match(s, /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/) != null;
}

function settings(args) {
	const save = args.save === true, target = save ? args.target : null, high = save ? args.tempHigh : null;
	if (target != null && !validTarget(target)) return fail('The ping target must be an IP address or a host name.');
	const heat = count(high, null, 50, 110);
	if (high != null && high != '' && heat == null) return fail('The temperature must be a number from 50 to 110 °C.');
	if (target != null || heat != null) {
		ensureConfig();
		const c = cursor();
		c.set('zeeli', 'zeeli_stats', 'stats');
		c.set('zeeli', 'zeeli_stats', 'zeeli', '1');
		if (target != null) c.set('zeeli', 'zeeli_stats', 'target', target);
		if (heat != null) c.set('zeeli', 'zeeli_stats', 'temp_high', `${heat}`);
		c.save('zeeli');
		c.commit('zeeli');
	}
	const cfg = config();
	return { target: cfg.target, tempHigh: cfg.tempHigh };
}

/* ---------- status, saving to flash ---------- */

function status() {
	const now = time();
	const s = readJson(`${dir()}/status.json`);
	let bytes = 0, files = 0;
	for (let name in lsdir(dir()) ?? []) {
		bytes += stat(`${dir()}/${name}`)?.size ?? 0;
		files++;
	}
	const saved = readJson(`${flashDir()}/meta.json`);
	return {
		running: s != null && now - s.t < 180,
		lastSample: s?.t ?? null,
		took: s?.took ?? null,
		devices: length(ids('client')),
		storage: { bytes, files },
		saved: saved ? { at: saved.at, bytes: saved.bytes } : null,
		durable: stat(flashDir()) != null || stat(dirname(flashDir())) != null,
	};
}

const COPIED = /\.(ring|jsonl|json)$/;

/** Copy the history to flash. The new copy is built beside the old one and swapped in. */
function persist() {
	const to = flashDir(), parent = dirname(to);
	if (!stat(parent)) return false;
	const stage = `${to}.new`;
	rmrf(stage);
	if (!mkdirp(stage)) return false;
	let bytes = 0;
	for (let name in lsdir(dir()) ?? []) {
		if (!match(name, COPIED) || name == 'status.json') continue;
		const text = readfile(`${dir()}/${name}`);
		if (text == null) continue;
		writefile(`${stage}/${name}`, text);
		bytes += length(text);
	}
	writefile(`${stage}/meta.json`, sprintf('%J', { at: time(), bytes }));
	rmrf(`${to}.old`);
	if (stat(to)) rename(to, `${to}.old`);
	const ok = rename(stage, to);
	rmrf(`${to}.old`);
	return ok;
}

/** After a reboot RAM is empty: bring the saved history back. Does nothing if there's history already. */
function restore() {
	mkdirp(dir());
	if (length(lsdir(dir()) ?? []) > 0) return false;
	for (let name in lsdir(flashDir()) ?? []) {
		if (!match(name, COPIED) || name == 'meta.json') continue;
		writefile(`${dir()}/${name}`, readfile(`${flashDir()}/${name}`) ?? '');
	}
	return true;
}

/** Drop history that's a year old, and the least recently seen devices beyond MAX_CLIENTS. */
function prune() {
	const now = time(), all = [];
	for (let name in lsdir(dir()) ?? []) {
		const p = split(name, '.');
		const s = stat(`${dir()}/${name}`);
		if (length(p) != 3 || p[2] != 'ring' || !s) continue;
		if (now - s.mtime > YEAR) unlink(`${dir()}/${name}`);
		else if (p[0] == 'client') push(all, { name, mtime: s.mtime });
	}
	const extra = length(all) - MAX_CLIENTS;
	if (extra > 0) for (let old in slice(sort(all, (a, b) => a.mtime - b.mtime), 0, extra)) unlink(`${dir()}/${old.name}`);
}

export { KINDS, EVENT_KINDS, ALERT_KINDS, MAX_EVENTS, dir, flashDir, mkdirp, readJson, writeAtomic, keyOf, ringPath, ids, series, summarize, top, addEvent, lastEventId, events, alerts, unread, config, settings, validTarget, status, persist, restore, prune };
