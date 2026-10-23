// zeeli.ring: the history files. One file per thing we measure (a device, a network, an
// uplink), holding three fixed-size rings of text slots: minutes for 24 hours, hours for
// 30 days and days for 12 months. A slot is rewritten in place, so a file never grows and
// the service keeps nothing in memory. Slots are hex numbers of a fixed width; `-` marks
// "no sample", which is different from a measured zero.
//
//   header (96 bytes)  ZRING2 <layout> <last minute> <last hour> <last day>
//   minute slots       1440 × slot width
//   hour slots         720 × slot width
//   day slots          365 × slot width
//
// Minute and hour numbers count from the epoch in UTC; day numbers count local days (the
// caller passes the timezone offset), so a daily bar is a day on the owner's wall clock.
'use strict';

import { open, readfile, rename, stat, writefile } from 'fs';

const TIERS = [
	{ name: 'min', step: 60, n: 1440 },
	{ name: 'hour', step: 3600, n: 720 },
	{ name: 'day', step: 86400, n: 365 },
];
const HEAD = 96;

/**
 * What a slot holds. `agg` is how minutes fold into an hour and hours into a day: bytes
 * add up, a gauge averages (or keeps its peak). `scale` turns the stored integer back into
 * the unit people read (0.1 °C is stored as 10 times the value). A layout of only sums is
 * `incremental`: a sample is added to its hour and day, which costs a few reads however many
 * devices there are. Gauges are refolded from the finer ring.
 */
const LAYOUTS = {
	// 12 hex digits hold 281 TB a slot; the first release used 10 (1.1 TB), see `widen`
	traffic: { w: 12, incremental: true, fields: [{ name: 'down', agg: 'sum', scale: 1 }, { name: 'up', agg: 'sum', scale: 1 }] },
	system: {
		w: 4,
		fields: [
			{ name: 'cpu', agg: 'avg', scale: 10 },
			{ name: 'mem', agg: 'avg', scale: 10 },
			{ name: 'temp', agg: 'max', scale: 10 },
		],
	},
	health: {
		w: 5,
		fields: [
			{ name: 'gatewayMs', agg: 'avg', scale: 100 },
			{ name: 'gatewayLoss', agg: 'avg', scale: 10 },
			{ name: 'internetMs', agg: 'avg', scale: 100 },
			{ name: 'internetLoss', agg: 'avg', scale: 10 },
		],
	},
};

/** The seconds a local day is shifted from UTC at time `t`. */
function tzoff(t) {
	return timegm(localtime(t)) - t;
}

/** The slot number of time `t` in tier `ti`. */
function slotOf(ti, t, off) {
	return ti == 2 ? int((t + off) / 86400) : int(t / TIERS[ti].step);
}

/** The first time (epoch seconds) covered by slot `s` of tier `ti`. */
function slotTime(ti, s, off) {
	return ti == 2 ? s * 86400 - off : s * TIERS[ti].step;
}

const slotWidth = (lay) => length(lay.fields) * lay.w;

function repeat(s, n) {
	let out = '', part = s;
	for (let k = n; k > 0; k = int(k / 2)) {
		if (k % 2) out += part;
		part += part;
	}
	return out;
}

const blankSlot = (lay) => repeat('-', slotWidth(lay));

function encode(lay, values) {
	const max = (1 << (4 * lay.w)) - 1;
	let out = '';
	for (let i = 0; i < length(lay.fields); i++) {
		const v = values[i];
		out += v == null ? repeat('-', lay.w) : sprintf(`%0${lay.w}x`, v < 0 ? 0 : (v > max ? max : int(v)));
	}
	return out;
}

/** One slot of `text`, starting at `at`, as numbers; null where a field has no sample. */
function decodeSlot(lay, text, at) {
	const out = [];
	for (let i = 0; i < length(lay.fields); i++) {
		const p = at + i * lay.w;
		out[i] = substr(text, p, 1) == '-' ? null : hex(substr(text, p, lay.w));
	}
	return out;
}

function decodeAll(lay, text) {
	const rows = [];
	for (let i = 0, sw = slotWidth(lay); i < length(text); i += sw) push(rows, decodeSlot(lay, text, i));
	return rows;
}

/** Combine rows of decoded slots into one row, field by field, the way each field folds. */
function combine(lay, rows) {
	const out = [];
	for (let i = 0; i < length(lay.fields); i++) {
		const agg = lay.fields[i].agg;
		let sum = 0, n = 0, peak = null;
		for (let row in rows) {
			const v = row ? row[i] : null;
			if (v == null) continue;
			sum += v;
			n++;
			if (peak == null || v > peak) peak = v;
		}
		out[i] = n == 0 ? null : (agg == 'sum' ? sum : (agg == 'max' ? peak : int((sum * 2 + n) / (n * 2))));
	}
	return out;
}

/** A row with no sample in any field is null, so callers can tell a gap from a zero. */
const orNull = (row) => row && length(filter(row, (v) => v != null)) ? row : null;

function base(lay, ti) {
	let at = HEAD;
	for (let i = 0; i < ti; i++) at += TIERS[i].n * slotWidth(lay);
	return at;
}

/** ZRING1 files are the first release's: the same, except a traffic slot was 10 digits wide. */
function readHead(f) {
	f.seek(0);
	const p = split(trim(f.read(HEAD) ?? ''), ' ');
	if ((p[0] != 'ZRING1' && p[0] != 'ZRING2') || !LAYOUTS[p[1]]) return null;
	return { layout: p[1], last: [int(p[2]), int(p[3]), int(p[4])], legacy: p[0] == 'ZRING1' && p[1] == 'traffic' };
}

function writeHead(f, layout, last) {
	f.seek(0);
	f.write(sprintf('%-95s\n', `ZRING2 ${layout} ${last[0]} ${last[1]} ${last[2]}`));
}

/** The text of `count` consecutive slots starting at slot number `from`, wrapping round the ring. */
function rawRead(f, lay, ti, from, count) {
	const sw = slotWidth(lay), n = TIERS[ti].n, at = base(lay, ti);
	const first = from % n, run = first + count > n ? n - first : count;
	f.seek(at + first * sw);
	let out = f.read(run * sw) ?? '';
	if (run < count) {
		f.seek(at);
		out += f.read((count - run) * sw) ?? '';
	}
	return out;
}

function rawWrite(f, lay, ti, from, text) {
	const sw = slotWidth(lay), n = TIERS[ti].n, at = base(lay, ti);
	const count = int(length(text) / sw);
	const first = from % n, run = first + count > n ? n - first : count;
	f.seek(at + first * sw);
	f.write(substr(text, 0, run * sw));
	if (run < count) {
		f.seek(at);
		f.write(substr(text, run * sw));
	}
}

/** Rewrite a first-release traffic file with 12-digit slots, keeping every value. */
function widen(path) {
	const text = readfile(path);
	if (text == null) return false;
	const p = split(trim(substr(text, 0, HEAD)), ' ');
	const pad = repeat('0', 2), blank = repeat('-', 12);
	let out = sprintf('%-95s\n', `ZRING2 traffic ${p[2]} ${p[3]} ${p[4]}`);
	for (let i = HEAD; i < length(text); i += 10) {
		const field = substr(text, i, 10);
		out += substr(field, 0, 1) == '-' ? blank : pad + field;
	}
	writefile(`${path}.tmp`, out);
	return rename(`${path}.tmp`, path);
}

/** Open a history file with its header read, upgrading an old-format file first. */
function openRing(path, mode) {
	let f = open(path, mode);
	if (!f) return null;
	let head = readHead(f);
	if (head?.legacy) {
		f.close();
		f = widen(path) ? open(path, mode) : null;
		head = f ? readHead(f) : null;
	}
	if (!head) {
		f?.close();
		return null;
	}
	return { f, head };
}

/** Create an empty history file, every slot "no sample". */
function create(path, layout) {
	const lay = LAYOUTS[layout];
	const f = open(path, 'w');
	if (!f) return false;
	writeHead(f, layout, [0, 0, 0]);
	for (let ti = 0; ti < 3; ti++) f.write(repeat(blankSlot(lay), TIERS[ti].n));
	f.close();
	return true;
}

/** Blank the slots after the last one written, up to and including `s`: they hold last lap's data. */
function advance(f, lay, ti, last, s) {
	if (last == 0 || s <= last) return;
	const count = s - last > TIERS[ti].n ? TIERS[ti].n : s - last;
	rawWrite(f, lay, ti, s - count + 1, repeat(blankSlot(lay), count));
}

/**
 * Record one sample taken at time `t`: write its minute slot, then bring the hour and day it
 * falls in up to date. Returns false when the sample is older than the newest one (the
 * clock went backwards), so a bad clock can't overwrite good history.
 */
function put(path, layout, t, values, off) {
	const lay = LAYOUTS[layout];
	if (!stat(path) && !create(path, layout)) return false;
	const opened = openRing(path, 'r+');
	if (!opened || opened.head.layout != layout) {
		opened?.f.close();
		return false;
	}
	const f = opened.f, head = opened.head;
	const last = head.last;
	const m = slotOf(0, t, off), h = slotOf(1, t, off);
	let d = slotOf(2, t, off);
	if (m < last[0]) {
		f.close();
		return false;
	}
	if (d < last[2]) d = last[2];

	advance(f, lay, 0, last[0], m);
	advance(f, lay, 1, last[1], h);
	advance(f, lay, 2, last[2], d);
	// two samples in one minute (a restart): bytes add up, gauges take the newer value
	const old = m == last[0] ? decodeSlot(lay, rawRead(f, lay, 0, m, 1), 0) : map(values, () => null);
	const row = map(values, (v, i) => lay.fields[i].agg == 'sum' && old[i] != null ? (v ?? 0) + old[i] : v ?? old[i]);
	rawWrite(f, lay, 0, m, encode(lay, row));

	let hourRow, dayRow;
	if (lay.incremental) {
		const add = (ti, slot) => map(decodeSlot(lay, rawRead(f, lay, ti, slot, 1), 0), (v, i) => (v ?? 0) + (row[i] ?? 0) - (old[i] ?? 0));
		hourRow = add(1, h);
		dayRow = add(2, d);
	} else {
		// the hour so far from this hour's minutes, the day so far from this day's hours
		hourRow = combine(lay, decodeAll(lay, rawRead(f, lay, 0, h * 60, m - h * 60 + 1)));
		const first = int((d * 86400 - off + 3599) / 3600);
		dayRow = combine(lay, h >= first ? decodeAll(lay, rawRead(f, lay, 1, first, h - first + 1)) : []);
	}
	rawWrite(f, lay, 1, h, encode(lay, hourRow));
	rawWrite(f, lay, 2, d, encode(lay, dayRow));

	writeHead(f, layout, [m, h > last[1] ? h : last[1], d > last[2] ? d : last[2]]);
	f.close();
	return true;
}

/**
 * The points of tier `ti` that end at time `now`, oldest first: an array of rows (null where
 * there is no sample) as the stored integers. `start` is the time of the first row.
 */
function read(path, ti, now, off) {
	const opened = openRing(path, 'r');
	if (!opened) return null;
	const f = opened.f, head = opened.head;
	const lay = LAYOUTS[head.layout], n = TIERS[ti].n, last = head.last[ti];
	const end = slotOf(ti, now, off) > last ? slotOf(ti, now, off) : last;
	const text = rawRead(f, lay, ti, 0, n);
	f.close();
	const rows = [], sw = slotWidth(lay), blank = blankSlot(lay);
	for (let s = end - n + 1; s <= end; s++) {
		const at = (s % n) * sw;
		push(rows, last == 0 || s > last || s <= last - n || substr(text, at, sw) == blank ? null : decodeSlot(lay, text, at));
	}
	return { layout: head.layout, firstSlot: end - n + 1, start: slotTime(ti, end - n + 1, off), step: TIERS[ti].step, rows };
}

/**
 * Fold every `k` rows into one, aligned to the slot numbers (minutes into five-minute
 * points on the clock). The partial group at the old edge is dropped, the one at the new
 * edge ("the last few minutes") is kept.
 */
function fold(series, k) {
	if (k <= 1) return series;
	const lay = LAYOUTS[series.layout];
	const skip = (k - series.firstSlot % k) % k;
	const out = [];
	for (let i = skip; i < length(series.rows); i += k)
		push(out, orNull(combine(lay, slice(series.rows, i, i + k))));
	return { ...series, start: series.start + skip * series.step, step: series.step * k, rows: out };
}

export { TIERS, LAYOUTS, tzoff, slotOf, slotTime, create, put, read, fold, combine };
