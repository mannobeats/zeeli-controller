import { type PointerEvent, useState } from 'react';
import { areaPath, axisTicks, linePath, niceMax, pointLabel } from '../lib/chart.ts';

/**
 * One line, area or set of bars on a chart. The tone only picks a colour; each shape also
 * reads without it: a main line is solid, a second one dashed, problems are bars.
 */
export interface ChartSeries {
  key: string;
  label: string;
  /** One value per point, null where nothing was measured. */
  values: (number | null)[];
  tone: 'brand' | 'ok' | 'warn' | 'bad';
  shape: 'area' | 'line' | 'bars';
  dashed?: boolean;
}

/** A stretch of time to shade, such as an outage. Times are in seconds. */
export interface ChartBand {
  from: number;
  to: number;
  label: string;
}

interface Props {
  /** What the chart shows, for screen readers and the summary. */
  label: string;
  /** The time of the first point, in seconds, and the seconds between points. */
  start: number;
  step: number;
  series: ChartSeries[];
  /** A value as the axis and tooltip print it. */
  format: (v: number) => string;
  min?: number;
  max?: number;
  height?: number;
  bands?: ChartBand[];
}

const top = (series: ChartSeries[]) => Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));

/** Bars as one path: a rectangle for each point that has a value. */
function barsPath(values: (number | null)[], y: (v: number) => number) {
  return values.map((v, i) => (v === null ? '' : `M${i + 0.12} 100 V${y(v)} H${i + 0.88} V100 Z`)).join(' ');
}

function Shape({ s, y }: { s: ChartSeries; y: (v: number) => number }) {
  if (s.shape === 'bars') return <path className={`chart-bar s-${s.tone}`} d={barsPath(s.values, y)} />;
  return (
    <>
      {s.shape === 'area' ? <path className={`chart-area s-${s.tone}`} d={areaPath(s.values, y)} /> : null}
      <path className={`chart-line s-${s.tone}${s.dashed ? ' dashed' : ''}`} d={linePath(s.values, y)} />
    </>
  );
}

function Key({ series }: { series: ChartSeries[] }) {
  return (
    <span className="legend">
      {series.map((s) => (
        <span key={s.key} className={`chart-key s-${s.tone}`}>
          <i className={`${s.shape}${s.dashed ? ' dashed' : ''}`} aria-hidden />
          {s.label}
        </span>
      ))}
    </span>
  );
}

function Tip({
  i,
  n,
  start,
  step,
  series,
  format,
}: {
  i: number;
  n: number;
  start: number;
  step: number;
  series: ChartSeries[];
  format: Props['format'];
}) {
  const side = i < n * 0.2 ? ' start' : i > n * 0.8 ? ' end' : '';
  return (
    <>
      <span className="chart-cursor" style={{ left: `${((i + 0.5) / n) * 100}%` }} />
      <div className={`chart-tip${side}`} style={{ left: `${((i + 0.5) / n) * 100}%` }}>
        <b>{pointLabel(start + i * step, step)}</b>
        {series.map((s) => (
          <div key={s.key} className={`s-${s.tone}`}>
            <span className="chart-key">
              <i className={`${s.shape}${s.dashed ? ' dashed' : ''}`} aria-hidden />
              {s.label}
            </span>
            <span className="num">{s.values[i] == null ? 'No data' : format(s.values[i])}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * A chart over time with its axes, a legend and a tooltip that follows the pointer. The plot
 * stretches to its box; the labels are ordinary text so they stay readable at any width.
 */
export function TimeChart({ label, start, step, series, format, min = 0, max, height = 140, bands = [] }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const ceiling = max ?? niceMax(top(series));
  const y = (v: number) => 100 - Math.min(1, Math.max(0, (v - min) / (ceiling - min))) * 100;
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(r.width ? Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))) : null);
  };
  const summary = series
    .map((s) => `${s.label} up to ${format(Math.max(0, ...s.values.filter((v): v is number => v !== null)))}`)
    .join(', ');
  return (
    <figure className="chart" aria-label={`${label}: ${summary}`}>
      {/* one line is named by the heading above the chart */}
      {series.length > 1 ? (
        <div className="chart-key-row">
          <Key series={series} />
        </div>
      ) : null}
      <div className="chart-y" aria-hidden>
        <span>{format(ceiling)}</span>
        <span>{format((ceiling + min) / 2)}</span>
        <span>{format(min)}</span>
      </div>
      {/* the tooltip is a pointer convenience; the legend, axes and totals carry the same numbers */}
      <div
        className="chart-plot"
        role="presentation"
        style={{ height }}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden>
          {[0, 50, 100].map((g) => (
            <line key={g} className={g === 100 ? 'chart-grid base' : 'chart-grid'} x1={0} x2={n} y1={g} y2={g} />
          ))}
          {bands.map((b) => (
            <rect
              key={b.from}
              className="chart-band"
              x={Math.max(0, (b.from - start) / step)}
              width={Math.max(0.8, (b.to - b.from) / step)}
              y={0}
              height={100}
            >
              <title>{b.label}</title>
            </rect>
          ))}
          {series.map((s) => (
            <Shape key={s.key} s={s} y={y} />
          ))}
        </svg>
        {hover !== null && n ? <Tip i={hover} n={n} start={start} step={step} series={series} format={format} /> : null}
      </div>
      <div className="chart-x" aria-hidden>
        {n ? axisTicks(start, step, n).map((t) => <span key={t.at}>{t.label}</span>) : null}
      </div>
    </figure>
  );
}
