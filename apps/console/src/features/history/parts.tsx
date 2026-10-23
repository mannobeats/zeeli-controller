import { HISTORY_RANGES, type HistoryRange, type TrafficSeries } from '@zeeli/router-api';
import type { ReactNode } from 'react';
import { navigate } from '../../app/useHashRoute.ts';
import { pointLabel } from '../../lib/chart.ts';
import { bytes, rateText } from '../../lib/format.ts';
import { Figure } from '../../ui/Figure.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { Empty } from '../../ui/Layout.tsx';
import { TimeChart } from '../../ui/TimeChart.tsx';
import { averageRate, busiest } from './sum.ts';
import { useHistoryStatus } from './useHistory.ts';

const SHORT: Record<HistoryRange, string> = { '24h': '24 hours', '30d': '30 days', '12m': '12 months' };
const RANGES = (Object.keys(HISTORY_RANGES) as HistoryRange[]).map((r) => [r, SHORT[r]] as const);

/** The same three ranges everywhere history is drawn. */
export function RangePicker({ value, onChange }: { value: HistoryRange; onChange: (r: HistoryRange) => void }) {
  return <Segmented label="Time range" value={value} options={RANGES} onChange={onChange} />;
}

/** Shown where history would be, on a router whose agent can’t record it yet. `inline` skips the panel, for use inside a sheet. */
function HistoryNote({ inline }: { inline?: boolean }) {
  const note = (
    <p className="history-note">
      History needs the Zeeli agent on your router. Update the console in{' '}
      <button type="button" className="link" onClick={() => navigate('firmware')}>
        Firmware
      </button>{' '}
      and the router starts recording. Until then this page shows what the router itself counts.
    </p>
  );
  return inline ? note : <div className="panel">{note}</div>;
}

/** Children once the router is recording history; a short note when it can’t, nothing while we ask. */
export function HistoryGate({ children, inline }: { children: ReactNode; inline?: boolean }) {
  const status = useHistoryStatus();
  if (status.data === undefined) return null;
  if (status.data === null) return <HistoryNote {...(inline ? { inline } : {})} />;
  return <>{children}</>;
}

/** A chart’s loading and empty states, so every chart handles them the same way. Empty means no point has a sample. */
export function ChartBox({
  loading,
  data,
  height = 140,
  children,
}: {
  loading: boolean;
  data: { points: unknown[] } | null | undefined;
  height?: number;
  children: ReactNode;
}) {
  if (loading) return <output className="skeleton" style={{ minHeight: height + 40 }} aria-busy="true" aria-label="Loading history" />;
  if (!data?.points.some((p) => p !== null))
    return (
      <Empty>Nothing recorded for this yet. The router records once a minute, so a chart appears a few minutes after it starts.</Empty>
    );
  return <>{children}</>;
}

/** Download as a filled area, upload as a dashed line, in bytes per point. */
export function TrafficChart({ series, label, height }: { series: TrafficSeries; label: string; height?: number }) {
  return (
    <TimeChart
      label={label}
      start={series.start}
      step={series.step}
      format={bytes}
      {...(height ? { height } : {})}
      series={[
        { key: 'down', label: 'Download', tone: 'brand', shape: 'area', values: series.points.map((p) => p?.down ?? null) },
        { key: 'up', label: 'Upload', tone: 'ok', shape: 'line', dashed: true, values: series.points.map((p) => p?.up ?? null) },
      ]}
    />
  );
}

/** What a traffic series added up to, and how busy it got. */
export function TrafficFigures({ series }: { series: TrafficSeries }) {
  const peak = busiest(series);
  return (
    <div className="figures">
      <Figure label="Downloaded" value={bytes(series.totals.down)} />
      <Figure label="Uploaded" value={bytes(series.totals.up)} />
      <Figure label="Average" value={rateText(averageRate(series))} />
      <Figure label="Busiest" value={peak ? rateText(peak.rate) : '–'} {...(peak ? { sub: pointLabel(peak.at, series.step) } : {})} />
    </div>
  );
}
