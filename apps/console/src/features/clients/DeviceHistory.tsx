import type { Client, HistoryRange } from '@zeeli/router-api';
import { useState } from 'react';
import { bytes } from '../../lib/format.ts';
import { KeyValues } from '../../ui/Layout.tsx';
import { lasted, pairUp, when } from '../history/pairs.ts';
import { ChartBox, HistoryGate, RangePicker, TrafficChart } from '../history/parts.tsx';
import { useSubjectEvents, useTraffic } from '../history/useHistory.ts';

/** What this device used over time, and when it was connected. Draws nothing the router can’t back up. */
export function DeviceHistory({ client }: { client: Client }) {
  return (
    <HistoryGate inline>
      <Usage mac={client.mac} />
      <Visits mac={client.mac} />
    </HistoryGate>
  );
}

function Usage({ mac }: { mac: string }) {
  const [range, setRange] = useState<HistoryRange>('24h');
  const traffic = useTraffic('client', mac, range);
  const series = traffic.data;
  return (
    <section>
      <h3>Usage</h3>
      <div className="stack-sm">
        <RangePicker value={range} onChange={setRange} />
        <ChartBox loading={traffic.isLoading} data={series} height={110}>
          {series ? (
            <>
              <TrafficChart series={series} label="Usage of this device" height={110} />
              <KeyValues
                rows={[
                  ['Downloaded', bytes(series.totals.down)],
                  ['Uploaded', bytes(series.totals.up)],
                ]}
              />
            </>
          ) : null}
        </ChartBox>
      </div>
    </section>
  );
}

function Visits({ mac }: { mac: string }) {
  const events = useSubjectEvents(mac, ['device.new', 'device.joined', 'device.left']);
  const visits = pairUp(events.data ?? [], 'device.joined', 'device.left').slice(0, 8);
  const first = events.data?.find((e) => e.kind === 'device.new');
  return (
    <section>
      <h3>Connection history</h3>
      {visits.length ? (
        <KeyValues
          rows={visits.map((v) => [
            `${when(v.from)}${v.to ? ` to ${v.to.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`,
            v.to ? lasted(v) : 'Connected now',
          ])}
        />
      ) : (
        <p className="hint">{events.isLoading ? 'Reading the history…' : 'No connections recorded yet.'}</p>
      )}
      {first ? <p className="hint">First seen {when(first.time)}.</p> : null}
    </section>
  );
}
