import type { TrafficSeries } from '@zeeli/router-api';

/**
 * Add uplinks together into one internet line. All series come from one request time, so they
 * line up; a point is missing only where every uplink was.
 */
export function sumTraffic(list: TrafficSeries[]): TrafficSeries | null {
  const [first] = list;
  if (!first) return null;
  return {
    start: first.start,
    step: first.step,
    totals: list.reduce((a, s) => ({ down: a.down + s.totals.down, up: a.up + s.totals.up }), { down: 0, up: 0 }),
    points: first.points.map((_, i) => {
      const there = list.flatMap((s) => s.points[i] ?? []);
      return there.length ? { down: there.reduce((a, p) => a + p.down, 0), up: there.reduce((a, p) => a + p.up, 0) } : null;
    }),
  };
}

/** The busiest point of a series: its average rate in bytes per second, and when it started (seconds). */
export function busiest(series: TrafficSeries): { rate: number; at: number } | null {
  let best: { rate: number; at: number } | null = null;
  series.points.forEach((p, i) => {
    const rate = p ? (p.down + p.up) / series.step : 0;
    if (p && (!best || rate > best.rate)) best = { rate, at: series.start + i * series.step };
  });
  return best;
}

/** Bytes per second over the points that have a sample. */
export function averageRate(series: TrafficSeries): number {
  const seen = series.points.filter((p) => p !== null).length;
  return seen ? (series.totals.down + series.totals.up) / (seen * series.step) : 0;
}
