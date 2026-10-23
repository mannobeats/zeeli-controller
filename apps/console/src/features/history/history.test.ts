import type { HistoryEvent, HistoryEventKind, TrafficPoint, TrafficSeries } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { ms, percent, show, stats, summary } from './health.ts';
import { lasted, pairUp } from './pairs.ts';
import { averageRate, busiest, sumTraffic } from './sum.ts';

const at = (m: number) => new Date(Date.UTC(2026, 9, 22, 12, m));
const ev = (kind: HistoryEventKind, minute: number): HistoryEvent => ({
  id: minute,
  time: at(minute),
  kind,
  subject: 'wan',
  name: '',
  value: null,
  alert: false,
});

test('an outage runs from the first down to the next up, newest first', () => {
  const events = [ev('wan.up', 30), ev('wan.down', 20), ev('wan.up', 5), ev('wan.down', 1), ev('wan.down', 2)];
  expect(pairUp(events, 'wan.down', 'wan.up')).toEqual([
    { from: at(20), to: at(30) },
    { from: at(1), to: at(5) },
  ]);
});

test('an outage still going has no end, and an up with no down before it is skipped', () => {
  expect(pairUp([ev('wan.up', 1), ev('wan.down', 9)], 'wan.down', 'wan.up')).toEqual([{ from: at(9), to: null }]);
  expect(pairUp([], 'wan.down', 'wan.up')).toEqual([]);
});

test('how long something lasted, in the unit that fits', () => {
  const span = (seconds: number) => ({ from: at(0), to: new Date(at(0).getTime() + seconds * 1000) });
  expect([40, 240, 7500, 3 * 3600, 3 * 86_400].map((s) => lasted(span(s)))).toEqual(['40 s', '4 min', '2 h 5 min', '3 h', '3 days']);
  expect(lasted({ from: new Date(Date.now() - 600_000), to: null })).toBe('10 min');
});

const series = (points: ({ down: number; up: number } | null)[]): TrafficSeries => ({
  start: 1000,
  step: 100,
  points,
  totals: points.reduce<TrafficPoint>((a, p) => ({ down: a.down + (p?.down ?? 0), up: a.up + (p?.up ?? 0) }), { down: 0, up: 0 }),
});

test('uplinks add up point by point, and a point is missing only if every uplink missed it', () => {
  const a = series([{ down: 10, up: 1 }, null, null]);
  const b = series([{ down: 5, up: 2 }, { down: 7, up: 0 }, null]);
  const sum = sumTraffic([a, b]);
  expect(sum?.points).toEqual([{ down: 15, up: 3 }, { down: 7, up: 0 }, null]);
  expect(sum?.totals).toEqual({ down: 22, up: 3 });
  expect(sumTraffic([])).toBeNull();
});

test('the busiest point and the average rate come from the points that have a sample', () => {
  const s = series([{ down: 100, up: 100 }, null, { down: 1000, up: 0 }]);
  expect(busiest(s)).toEqual({ rate: 10, at: 1200 });
  expect(averageRate(s)).toBeCloseTo(6);
  expect(busiest(series([null]))).toBeNull();
  expect(averageRate(series([null]))).toBe(0);
});

test('mean, lowest and highest ignore gaps', () => {
  expect(stats([2, null, 4, 9])).toEqual({ avg: 5, min: 2, max: 9 });
  expect(stats([null])).toEqual({ avg: null, min: null, max: null });
  expect(summary({ start: 0, step: 60, points: [{ v: 1 }, null, { v: 3 }] }, 'v')).toEqual({ avg: 2, min: 1, max: 3 });
});

test('latency and loss print the way people read them', () => {
  expect([ms(2.25), ms(21.6), percent(0), percent(0.45), percent(12.3)]).toEqual(['2.3 ms', '22 ms', '0%', '0.5%', '12%']);
  expect([show(null, ms), show(5, ms)]).toEqual(['–', '5.0 ms']);
});
