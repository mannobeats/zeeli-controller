'use strict';

import { eq, ok, test, done } from 'assert';
import { stat } from 'fs';
import { paths } from 'zeeli.common';
import * as ring from 'zeeli.ring';

// midnight UTC, 2023-11-15
const T0 = 1700006400;
const file = (name) => `${paths.state}/${name}.ring`;

/** The non-empty rows of tier `ti`, as [time, ...values]. */
function seen(path, ti, now, off) {
	const r = ring.read(path, ti, now, off);
	const out = [];
	for (let i = 0; i < length(r.rows); i++)
		if (r.rows[i]) push(out, [r.start + i * r.step, ...r.rows[i]]);
	return out;
}

test('a sample lands in its minute, hour and day slots', () => {
	const p = file('a');
	ok(ring.put(p, 'traffic', T0 + 90, [100, 7], 0));
	eq(seen(p, 0, T0 + 90, 0), [[T0 + 60, 100, 7]]);
	eq(seen(p, 1, T0 + 90, 0), [[T0, 100, 7]]);
	eq(seen(p, 2, T0 + 90, 0), [[T0, 100, 7]]);
});

test('minutes add up to the hour, hours to the day', () => {
	const p = file('rollup');
	// every minute of the first three hours: 1 down, 2 up
	for (let m = 0; m < 180; m++) ring.put(p, 'traffic', T0 + m * 60 + 5, [1, 2], 0);
	eq(seen(p, 1, T0 + 179 * 60, 0), [[T0, 60, 120], [T0 + 3600, 60, 120], [T0 + 7200, 60, 120]]);
	eq(seen(p, 2, T0 + 179 * 60, 0), [[T0, 180, 360]]);
	// the next day starts its own slot and leaves yesterday's total alone
	ring.put(p, 'traffic', T0 + 86400 + 10, [5, 5], 0);
	eq(seen(p, 2, T0 + 86410, 0), [[T0, 180, 360], [T0 + 86400, 5, 5]]);
});

test('a day follows the local clock, not UTC', () => {
	const p = file('local');
	const off = -4 * 3600; // local midnight is 04:00 UTC
	ring.put(p, 'traffic', T0 + 3 * 3600, [10, 0], off); // 23:00 the evening before, local
	ring.put(p, 'traffic', T0 + 5 * 3600, [20, 0], off); // 01:00, local
	eq(seen(p, 2, T0 + 5 * 3600, off), [[T0 - 20 * 3600, 10, 0], [T0 + 4 * 3600, 20, 0]]);
});

test('gauges average and keep their peak, and a missing field stays missing', () => {
	const p = file('sys');
	ring.put(p, 'system', T0 + 60, [100, 500, 600], 0);
	ring.put(p, 'system', T0 + 120, [300, 500, 650], 0);
	eq(seen(p, 1, T0 + 120, 0), [[T0, 200, 500, 650]]);

	const h = file('health');
	ring.put(h, 'health', T0 + 60, [1000, 0, null, 1000], 0);
	ring.put(h, 'health', T0 + 120, [3000, 100, null, 1000], 0);
	eq(seen(h, 1, T0 + 120, 0), [[T0, 2000, 50, null, 1000]]);
});

test('minutes with no sample stay empty, and a long gap clears last lap', () => {
	const p = file('gap');
	ring.put(p, 'traffic', T0 + 60, [9, 9], 0);
	ring.put(p, 'traffic', T0 + 600, [4, 4], 0);
	eq(seen(p, 0, T0 + 600, 0), [[T0 + 60, 9, 9], [T0 + 600, 4, 4]]);
	// the collector was off for a day and a bit: the old minutes would sit in the same slots
	ring.put(p, 'traffic', T0 + 60 + 1500 * 60, [1, 1], 0);
	eq(seen(p, 0, T0 + 60 + 1500 * 60, 0), [[T0 + 60 + 1500 * 60, 1, 1]]);
	// but the hours and days are still there
	eq(length(seen(p, 1, T0 + 60 + 1500 * 60, 0)), 2);
});

test('the ring wraps: the oldest day of history is overwritten, not the newest', () => {
	const p = file('wrap');
	for (let d = 0; d < 367; d++) ring.put(p, 'traffic', T0 + d * 86400 + 30, [d + 1, 0], 0);
	const days = seen(p, 2, T0 + 366 * 86400 + 30, 0);
	eq(length(days), 365);
	eq(days[0], [T0 + 2 * 86400, 3, 0]);
	eq(days[364], [T0 + 366 * 86400, 367, 0]);
});

test('a clock that goes backwards is ignored; two samples in a minute add up', () => {
	const p = file('clock');
	ok(ring.put(p, 'traffic', T0 + 3600, [5, 5], 0));
	ok(!ring.put(p, 'traffic', T0 + 60, [99, 99], 0), 'older sample is refused');
	ok(ring.put(p, 'traffic', T0 + 3600 + 20, [1, 2], 0));
	eq(seen(p, 0, T0 + 3620, 0), [[T0 + 3600, 6, 7]]);
});

test('five-minute points for the day chart', () => {
	const p = file('fold');
	for (let m = 0; m < 20; m++) ring.put(p, 'traffic', T0 + m * 60, [1, 0], 0);
	const r = ring.fold(ring.read(p, 0, T0 + 19 * 60, 0), 5);
	eq(r.step, 300);
	// the 5-minute buckets that held samples
	const full = [];
	for (let i = 0; i < length(r.rows); i++)
		if (r.rows[i]) push(full, [r.start + i * 300, ...r.rows[i]]);
	eq(full, [[T0, 5, 0], [T0 + 300, 5, 0], [T0 + 600, 5, 0], [T0 + 900, 5, 0]]);
});

test('a history file has a fixed size however long it runs', () => {
	const p = file('size');
	ring.put(p, 'traffic', T0, [1, 1], 0);
	const before = stat(p).size;
	for (let m = 1; m < 3000; m++) ring.put(p, 'traffic', T0 + m * 60, [m, m], 0);
	eq(stat(p).size, before);
	ok(before < 52000, `a traffic file is ${before} bytes`);
});

done();
