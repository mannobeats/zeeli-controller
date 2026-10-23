import type { HistoryRange } from '@zeeli/router-api';
import { useState } from 'react';
import { Panel } from '../../ui/Layout.tsx';
import { TimeChart } from '../../ui/TimeChart.tsx';
import { show, stats } from '../history/health.ts';
import { ChartBox, HistoryGate, RangePicker } from '../history/parts.tsx';
import { useSystemHistory } from '../history/useHistory.ts';

const whole = (v: number) => `${Math.round(v)}%`;
const degrees = (v: number) => `${Math.round(v)} °C`;

/** CPU, memory and temperature of the router over 24 hours, 30 days or 12 months. */
export function SystemHistory() {
  return (
    <HistoryGate>
      <Charts />
    </HistoryGate>
  );
}

function Charts() {
  const [range, setRange] = useState<HistoryRange>('24h');
  const system = useSystemHistory(range);
  const series = system.data;
  const column = (field: 'cpu' | 'memory' | 'temp') => series?.points.map((p) => p?.[field] ?? null) ?? [];
  const when = series ? { start: series.start, step: series.step } : { start: 0, step: 300 };
  return (
    <Panel
      title="History"
      note="Averages, with the hottest reading for temperature"
      actions={<RangePicker value={range} onChange={setRange} />}
    >
      <ChartBox loading={system.isLoading} data={series} height={140}>
        <div className="stack-sm">
          <Metric {...when} title="CPU" values={column('cpu')} format={whole} max={100} />
          <Metric {...when} title="Memory" values={column('memory')} format={whole} max={100} />
          <Metric {...when} title="Temperature" values={column('temp')} format={degrees} />
        </div>
      </ChartBox>
    </Panel>
  );
}

interface MetricProps {
  start: number;
  step: number;
  title: string;
  values: (number | null)[];
  format: (v: number) => string;
  max?: number;
}

function Metric({ start, step, title, values, format, max }: MetricProps) {
  const { avg, min, max: highest } = stats(values);
  // temperature sits well above zero: start the scale below the coolest reading so the line has room to move
  const floor = max ? 0 : Math.max(0, Math.floor(((min ?? 30) - 10) / 10) * 10);
  return (
    <div className="stack-sm">
      <div className="chart-title">
        <b>{title}</b>
        <span className="num">
          average {show(avg, format)} · highest {show(highest, format)}
        </span>
      </div>
      <TimeChart
        label={title}
        start={start}
        step={step}
        format={format}
        min={floor}
        {...(max ? { max } : {})}
        height={90}
        series={[{ key: title, label: title, tone: 'brand', shape: 'area', values }]}
      />
    </div>
  );
}
