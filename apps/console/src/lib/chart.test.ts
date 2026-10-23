import { expect, test } from 'vitest';
import { areaPath, axisLabel, axisTicks, linePath, niceMax, perStep, pointLabel, runs } from './chart.ts';

test('the top of a scale is a round number just above the data', () => {
  expect([0, -3, 0.7, 1, 1.4, 2.2, 7, 12, 480, 1_300_000].map(niceMax)).toEqual([1, 1, 1, 1, 2, 5, 10, 20, 500, 2_000_000]);
});

test('a missing value breaks a line into stretches', () => {
  expect(runs([1, 2, null, null, 3, null, 4, 5])).toEqual([
    [0, 1],
    [4, 4],
    [6, 7],
  ]);
  expect(runs([null, null])).toEqual([]);
  expect(runs([])).toEqual([]);
});

test('paths follow the stretches, in the middle of each point’s slot', () => {
  const y = (v: number) => 100 - v;
  expect(linePath([10, 20, null, 30], y)).toBe('M0.5 90 L1.5 80 M3.5 70');
  expect(areaPath([10, 20, null, 30], y)).toBe('M0.5 100 L0.5 90 L1.5 80 L1.5 100 Z M3.5 100 L3.5 70 L3.5 100 Z');
  expect(linePath([null], y)).toBe('');
});

test('axis labels suit the size of a step', () => {
  const t = new Date(2026, 9, 22, 20, 5).getTime() / 1000;
  expect(axisLabel(t, 300)).toMatch(/8/);
  expect(axisLabel(t, 3600)).toMatch(/Oct/);
  expect(axisLabel(t, 86_400)).toMatch(/Oct/);
  expect(pointLabel(t, 300)).toMatch(/8:05/);
  expect(pointLabel(t, 3600)).toMatch(/Oct 22/);
  expect(pointLabel(t, 86_400)).toMatch(/2026/);
});

test('ticks are spread from the first point to the last', () => {
  const ticks = axisTicks(0, 3600, 25, 5);
  expect(ticks.map((x) => x.at)).toEqual([0, 6, 12, 18, 24]);
  expect(ticks).toHaveLength(5);
});

test('a step in words', () => {
  expect([300, 3600, 86_400].map(perStep)).toEqual(['per 5 minutes', 'per hour', 'per day']);
});
