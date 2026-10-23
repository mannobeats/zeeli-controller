import { type HealthPoint, type HistoryEvent, type HistoryRange, uplinkName } from '@zeeli/router-api';
import { useState } from 'react';
import { niceMax } from '../../lib/chart.ts';
import { DataTable } from '../../ui/DataTable.tsx';
import { Figure } from '../../ui/Figure.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { Chip, Empty, Panel } from '../../ui/Layout.tsx';
import { type ChartBand, type ChartSeries, TimeChart } from '../../ui/TimeChart.tsx';
import { type HealthSeries, ms, percent, show, summary } from '../history/health.ts';
import { lasted, pairUp, type Span, when } from '../history/pairs.ts';
import { ChartBox, HistoryGate, RangePicker } from '../history/parts.tsx';
import { useHealth, useSubjectEvents, useTop } from '../history/useHistory.ts';

/** Latency, packet loss and outages for each uplink the router has recorded. */
export function WanHealth() {
  return (
    <HistoryGate>
      <HealthPanel />
    </HistoryGate>
  );
}

function HealthPanel() {
  const [range, setRange] = useState<HistoryRange>('24h');
  const [picked, setPicked] = useState<string | null>(null);
  const top = useTop('12m');
  const uplinks = top.data?.wans.map((w) => w.id) ?? [];
  const uplink = picked && uplinks.includes(picked) ? picked : (uplinks[0] ?? null);
  return (
    <Panel
      title="Health"
      note="Pings every minute"
      actions={
        <span className="row-actions">
          {uplinks.length > 1 ? (
            <Segmented label="Uplink" value={uplink ?? ''} options={uplinks.map((u) => [u, uplinkName(u)] as const)} onChange={setPicked} />
          ) : null}
          <RangePicker value={range} onChange={setRange} />
        </span>
      }
    >
      {uplink ? (
        <UplinkHealth key={uplink} uplink={uplink} range={range} />
      ) : (
        <Empty>{top.isLoading ? 'Reading the history…' : 'No uplink has been recorded yet.'}</Empty>
      )}
    </Panel>
  );
}

const line = (key: string, label: string, tone: ChartSeries['tone'], values: (number | null)[], dashed = false): ChartSeries => ({
  key,
  label,
  tone,
  shape: 'line',
  values,
  ...(dashed ? { dashed } : {}),
});

/** The outages that overlap the chart, as shaded stretches. */
function bandsOf(outages: Span[], series: HealthSeries): ChartBand[] {
  const end = series.start + series.points.length * series.step;
  return outages
    .map((o) => ({ from: o.from.getTime() / 1000, to: o.to ? o.to.getTime() / 1000 : end, label: `Down ${when(o.from)}` }))
    .filter((b) => b.to > series.start && b.from < end);
}

function UplinkHealth({ uplink, range }: { uplink: string; range: HistoryRange }) {
  const health = useHealth(uplink, range);
  const events = useSubjectEvents(uplink, ['wan.down', 'wan.up']);
  const series = health.data;
  const bands = series ? bandsOf(pairUp(events.data ?? [], 'wan.down', 'wan.up'), series) : [];
  return (
    <ChartBox loading={health.isLoading} data={series} height={200}>
      {series ? (
        <div className="stack-sm">
          <HealthFigures series={series} outages={bands.length} />
          <HealthCharts series={series} bands={bands} />
          <Outages events={events.data ?? []} since={series.start} />
        </div>
      ) : null}
    </ChartBox>
  );
}

function HealthFigures({ series, outages }: { series: HealthSeries; outages: number }) {
  const internet = summary(series, 'internetMs');
  const gateway = summary(series, 'gatewayMs');
  const lost = summary(series, 'internetLoss');
  return (
    <div className="figures">
      <Figure label="Internet latency" value={show(internet.avg, ms)} sub={`up to ${show(internet.max, ms)}`} />
      <Figure label="Router to gateway" value={show(gateway.avg, ms)} sub={`up to ${show(gateway.max, ms)}`} />
      <Figure label="Packets lost" value={show(lost.avg, percent)} sub={`up to ${show(lost.max, percent)}`} />
      <Figure label="Outages" value={String(outages)} {...(outages ? { tone: 'bad' as const } : {})} />
    </div>
  );
}

function HealthCharts({ series, bands }: { series: HealthSeries; bands: ChartBand[] }) {
  const column = (f: keyof HealthPoint) => series.points.map((p) => p?.[f] ?? null);
  const lossTop = Math.max(5, niceMax(summary(series, 'internetLoss').max ?? 0));
  return (
    <>
      <TimeChart
        label="Latency"
        start={series.start}
        step={series.step}
        format={ms}
        bands={bands}
        series={[line('internet', 'Internet', 'brand', column('internetMs')), line('gateway', 'Gateway', 'ok', column('gatewayMs'), true)]}
      />
      <TimeChart
        label="Packets lost"
        start={series.start}
        step={series.step}
        format={percent}
        max={lossTop}
        height={80}
        bands={bands}
        series={[
          { key: 'internet', label: 'Internet', tone: 'warn', shape: 'bars', values: column('internetLoss') },
          line('gateway', 'Gateway', 'bad', column('gatewayLoss'), true),
        ]}
      />
    </>
  );
}

function Outages({ events, since }: { events: HistoryEvent[]; since: number }) {
  const outages = pairUp(events, 'wan.down', 'wan.up').filter((o) => (o.to?.getTime() ?? Date.now()) / 1000 > since);
  if (!outages.length) return <p className="hint">No outages in this time.</p>;
  return (
    <DataTable
      label="Outages"
      rows={outages}
      rowKey={(o) => String(o.from.getTime())}
      columns={[
        { key: 'down', header: 'Went down', phone: 'title', cell: (o) => when(o.from) },
        { key: 'up', header: 'Back up', phone: 'sub', cell: (o) => (o.to ? when(o.to) : <Chip tone="bad">Down now</Chip>) },
        { key: 'for', header: 'Lasted', align: 'end', phone: 'end', cell: (o) => lasted(o) },
      ]}
    />
  );
}
