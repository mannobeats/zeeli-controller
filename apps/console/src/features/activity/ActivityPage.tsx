import {
  type Icon,
  IconAlertTriangle,
  IconCloudOff,
  IconCloudUp,
  IconDeviceMobileOff,
  IconDeviceMobilePlus,
  IconKey,
  IconLock,
  IconPlugConnected,
  IconPlugConnectedX,
  IconRefresh,
  IconTag,
  IconUpload,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { ActivityKind } from '@zeeli/router-api';
import { useState } from 'react';
import { useClients } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { ago } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { Empty, PageHeader, Panel } from '../../ui/Layout.tsx';

type Filter = 'all' | 'devices' | 'internet' | 'security';
const GROUP: Record<ActivityKind, Filter> = {
  'device.joined': 'devices',
  'device.left': 'devices',
  'device.address': 'devices',
  'uplink.up': 'internet',
  'uplink.down': 'internet',
  'internet.lost': 'internet',
  'internet.back': 'internet',
  'admin.ssh': 'security',
  'admin.failed': 'security',
  firmware: 'security',
  'service.error': 'internet',
};
const ICON: Record<ActivityKind, [Icon, string]> = {
  'device.joined': [IconDeviceMobilePlus, 'ok'],
  'device.left': [IconDeviceMobileOff, 'off'],
  'device.address': [IconTag, 'off'],
  'uplink.up': [IconPlugConnected, 'ok'],
  'uplink.down': [IconPlugConnectedX, 'bad'],
  'internet.lost': [IconCloudOff, 'bad'],
  'internet.back': [IconCloudUp, 'ok'],
  'admin.ssh': [IconKey, 'off'],
  'admin.failed': [IconLock, 'bad'],
  firmware: [IconUpload, 'off'],
  'service.error': [IconAlertTriangle, 'warn'],
};
const IFACE: Record<string, string> = {
  wan: 'Ethernet 1',
  secondwan: 'Ethernet 2',
  wwan: 'Repeater',
  lan: 'Main LAN',
  guest: 'Guest',
  iot: 'IoT',
  repeater: 'Repeater',
};

/** What happened on the network, newest first: devices, uplinks and sign-ins. */
export default function ActivityPage() {
  const events = useQuery({ queryKey: ['activity'], queryFn: api.activity.recent, refetchInterval: 30_000 });
  const clients = useClients().data ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const nameOf = (subject: string) => clients.find((c) => c.mac === subject)?.name ?? IFACE[subject] ?? subject;
  const rows = (events.data ?? []).filter((e) => filter === 'all' || GROUP[e.kind] === filter);
  const failed = (events.data ?? []).filter((e) => e.kind === 'admin.failed').reduce((n, e) => n + e.count, 0);

  return (
    <>
      <PageHeader
        title="Activity"
        sub="From the router’s log since it last started."
        actions={
          <Button icon={<IconRefresh size={16} />} onClick={() => events.refetch()}>
            Refresh
          </Button>
        }
      />
      {failed ? (
        <div className="panel notice">
          {failed} failed sign-in {failed === 1 ? 'attempt' : 'attempts'} on SSH. If that wasn’t you, turn off SSH from the internet in{' '}
          <button type="button" className="link" onClick={() => navigate('remote')}>
            Remote management
          </button>
          .
        </div>
      ) : null}
      <Panel
        actions={
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              ['all', 'Everything'],
              ['devices', 'Devices'],
              ['internet', 'Internet'],
              ['security', 'Security'],
            ]}
          />
        }
      >
        {events.isError ? (
          <Empty>Couldn’t read the log: {errorMessage(events.error)}</Empty>
        ) : rows.length ? (
          <ol className="timeline">
            {rows.map((e) => {
              const [I, tone] = ICON[e.kind];
              const device = clients.find((c) => c.mac === e.subject);
              return (
                <li key={`${e.time.getTime()}-${e.kind}-${e.subject}`} className={`tl-${tone}`}>
                  <span className="tl-dot">
                    <I size={16} stroke={1.75} />
                  </span>
                  <div className="tl-body">
                    <b>
                      {device ? (
                        <button type="button" className="link" onClick={() => navigate(`clients?device=${encodeURIComponent(device.mac)}`)}>
                          {device.name}
                        </button>
                      ) : (
                        nameOf(e.subject)
                      )}
                    </b>{' '}
                    {e.detail.charAt(0).toLowerCase() + e.detail.slice(1)}
                    {e.count > 1 ? <span className="muted"> ×{e.count}</span> : null}
                  </div>
                  <time className="tl-time" dateTime={e.time.toISOString()} title={e.time.toLocaleString()}>
                    {ago(e.time.getTime() / 1000)}
                  </time>
                </li>
              );
            })}
          </ol>
        ) : (
          <Empty>{events.isLoading ? 'Reading the log…' : 'Nothing to show yet.'}</Empty>
        )}
      </Panel>
    </>
  );
}
