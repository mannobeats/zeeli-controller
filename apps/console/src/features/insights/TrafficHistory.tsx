import { useQuery } from '@tanstack/react-query';
import { type HistoryRange, historyNetworkId, type UsageTotal } from '@zeeli/router-api';
import { useState } from 'react';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { ago } from '../../lib/format.ts';
import { Empty, Panel } from '../../ui/Layout.tsx';
import { useDeviceName } from '../dns/names.ts';
import { ChartBox, RangePicker, TrafficChart, TrafficFigures } from '../history/parts.tsx';
import { useInternetTraffic, useTop } from '../history/useHistory.ts';
import { BarTable } from './BarTable.tsx';

const rows = (list: UsageTotal[], nameOf: (id: string) => string) =>
  list.map((t) => ({ key: t.id, name: nameOf(t.id), down: t.down, up: t.up, total: t.down + t.up }));

/** Traffic over 24 hours, 30 days or 12 months from the router’s own record: the internet, each network and each device. */
export function TrafficHistory() {
  const [range, setRange] = useState<HistoryRange>('24h');
  const internet = useInternetTraffic(range);
  const top = useTop(range, 25);
  const networks = useQuery({ queryKey: ['networks'], queryFn: api.networks.list });
  const deviceName = useDeviceName();
  const networkName = (id: string) => networks.data?.find((n) => historyNetworkId(n) === id)?.label ?? id;
  const asOf = top.data?.asOf ? `Added up ${ago(top.data.asOf.getTime() / 1000)}` : undefined;

  return (
    <>
      <Panel title="Internet" note="Everything through your uplinks" actions={<RangePicker value={range} onChange={setRange} />}>
        <ChartBox loading={internet.isLoading} data={internet.data} height={160}>
          {internet.data ? (
            <>
              <TrafficFigures series={internet.data} />
              <TrafficChart series={internet.data} label="Internet traffic" height={160} />
            </>
          ) : null}
        </ChartBox>
      </Panel>
      <Panel className="section" title="By network" note={asOf}>
        {top.data?.networks.length ? (
          <BarTable label="Traffic by network" rows={rows(top.data.networks, networkName)} />
        ) : (
          <Empty>{top.isLoading ? 'Adding up…' : 'No network traffic recorded in this time.'}</Empty>
        )}
      </Panel>
      <Panel className="section" title="By device" note={asOf}>
        {top.data?.clients.length ? (
          <BarTable
            label="Traffic by device"
            rows={rows(top.data.clients, deviceName)}
            onRow={(mac) => navigate(`clients?device=${encodeURIComponent(mac)}`)}
          />
        ) : (
          <Empty>{top.isLoading ? 'Adding up…' : 'No device traffic recorded in this time.'}</Empty>
        )}
      </Panel>
    </>
  );
}
