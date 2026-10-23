import type { HealthPoint, Series } from '@zeeli/router-api';

/** The mean, lowest and highest of the values that were measured; null for all three when nothing was. */
export function stats(values: (number | null)[]) {
  const xs = values.filter((v): v is number => v !== null);
  if (!xs.length) return { avg: null, min: null, max: null };
  return { avg: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) };
}

/** `stats` of one field of a series. */
export const summary = <P extends object>(series: Series<P>, field: keyof P) =>
  stats(series.points.map((p) => (typeof p?.[field] === 'number' ? (p[field] as number) : null)));

/** Milliseconds as people read them: one decimal under 10, none above. */
export const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;
export const percent = (v: number) => `${Number(v.toFixed(v < 10 ? 1 : 0))}%`;
/** A number in `format`, or a dash when there isn't one. */
export const show = (v: number | null, format: (v: number) => string) => (v === null ? '–' : format(v));

export type HealthSeries = Series<HealthPoint>;
