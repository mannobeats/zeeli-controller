// The arithmetic behind the time charts: scales, line segments and the labels on the axes.

/** The next "round" number at or above `v`: 1, 2, 5 or 10 times a power of ten. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(v));
  const f = v / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

/** The [first, last] index of each unbroken stretch of samples; a null value ends a stretch. */
export function runs(values: readonly (number | null)[]): [number, number][] {
  const out: [number, number][] = [];
  let from = -1;
  values.forEach((v, i) => {
    if (v !== null && from < 0) from = i;
    if (v === null && from >= 0) {
      out.push([from, i - 1]);
      from = -1;
    }
  });
  if (from >= 0) out.push([from, values.length - 1]);
  return out;
}

/** SVG path data for a line through each stretch; `y` turns a value into a 0 to 100 height. */
export function linePath(values: readonly (number | null)[], y: (v: number) => number): string {
  return runs(values)
    .map(([a, b]) =>
      values
        .slice(a, b + 1)
        .map((v, k) => `${k ? 'L' : 'M'}${a + k + 0.5} ${y(v ?? 0)}`)
        .join(' '),
    )
    .join(' ');
}

/** Like `linePath`, closed down to the baseline so the stretch can be filled. */
export function areaPath(values: readonly (number | null)[], y: (v: number) => number): string {
  return runs(values)
    .map(([a, b]) => {
      const top = values.slice(a, b + 1).map((v, k) => `L${a + k + 0.5} ${y(v ?? 0)}`);
      return `M${a + 0.5} 100 ${top.join(' ')} L${b + 0.5} 100 Z`;
    })
    .join(' ');
}

const HOUR_ONLY: Intl.DateTimeFormatOptions = { hour: 'numeric' };
const DAY_MONTH: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const MONTH_YEAR: Intl.DateTimeFormatOptions = { month: 'short', year: '2-digit' };

/** A short axis label for the time `t` (seconds) in a chart whose points are `step` seconds apart. */
export function axisLabel(t: number, step: number): string {
  const d = new Date(t * 1000);
  if (step < 3600) return d.toLocaleTimeString([], HOUR_ONLY);
  if (step < 86_400) return d.toLocaleDateString([], DAY_MONTH);
  return d.toLocaleDateString([], MONTH_YEAR);
}

/** A full label for the point at `t`, for tooltips. */
export function pointLabel(t: number, step: number): string {
  const d = new Date(t * 1000);
  if (step < 3600) return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  if (step < 86_400) return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' });
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** `count` evenly spaced axis labels across `n` points that start at `start` (seconds). */
export function axisTicks(start: number, step: number, n: number, count = 5): { at: number; label: string }[] {
  return Array.from({ length: count }, (_, k) => {
    const i = Math.round((k / (count - 1)) * (n - 1));
    return { at: i, label: axisLabel(start + i * step, step) };
  });
}

/** What one point covers, in words: "per 5 minutes", "per hour", "per day". */
export function perStep(step: number): string {
  if (step >= 86_400) return 'per day';
  if (step >= 3600) return 'per hour';
  return `per ${Math.round(step / 60)} minutes`;
}
