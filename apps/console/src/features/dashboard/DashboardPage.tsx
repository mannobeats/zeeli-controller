import { useQuery } from '@tanstack/react-query';
import type { Client, RepeaterStatus, RouterStatus } from '@zeeli/router-api';
import { UPLINKS } from '@zeeli/router-api';
import { LIVE, useClients, useInfo, useStatus } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { CATEGORIES, categoryOf } from '../../lib/devices.ts';
import { BAND_LABEL, bytes, connectedFor, duration, plural, rate, rateText, signal } from '../../lib/format.ts';
import { useSamples } from '../../lib/useSamples.ts';
import { DataTable } from '../../ui/DataTable.tsx';
import { DeviceIcon, Swatch } from '../../ui/DeviceIcon.tsx';
import { Grid, KeyValues, Meter, Panel } from '../../ui/Layout.tsx';
import { Sparkline } from '../../ui/Sparkline.tsx';
import { TrafficPath, VerticalPath } from './TrafficPath.tsx';

export interface Uplinks {
  active: (typeof UPLINKS)[number][];
  standby: (typeof UPLINKS)[number][];
}

const uplinksOf = (status: RouterStatus): Uplinks => {
  const up = new Set(status.uplinks.filter((n) => n.up).map((n) => n.interface));
  return {
    active: UPLINKS.filter((u) => up.has(u.id)),
    standby: UPLINKS.filter((u) => !up.has(u.id) && u.id !== 'secondwan'),
  };
};

const openDevice = (mac: string) => navigate(`clients?device=${encodeURIComponent(mac)}`);

export default function DashboardPage() {
  const status = useStatus();
  const clients = useClients();
  const info = useInfo().data;
  const repeater = useQuery({ queryKey: ['repeater'], queryFn: api.internet.repeater, refetchInterval: LIVE.slow / 2 }).data;
  const fan = useQuery({ queryKey: ['fan'], queryFn: api.system.fan, refetchInterval: LIVE.slow }).data;
  const adguard = useQuery({ queryKey: ['adguard'], queryFn: api.dns.adguard.get, refetchInterval: LIVE.slow }).data;
  const vpn = useQuery({ queryKey: ['tunnels'], queryFn: api.vpn.tunnels, refetchInterval: LIVE.slow }).data;

  const online = (clients.data ?? []).filter((c) => c.online);
  const down = online.reduce((n, c) => n + c.rx, 0);
  const up = online.reduce((n, c) => n + c.tx, 0);
  const samples = useSamples<[number, number]>(clients.data ? [down, up] : undefined, clients.dataUpdatedAt);

  if (!status.data) return <output className="panel skeleton" aria-busy="true" aria-label="Loading the dashboard" />;
  const s = status.data;
  const links = uplinksOf(s);
  const rep = links.active.some((u) => u.id === 'wwan') && repeater?.connected ? repeater : null;
  const busiest = [...online].sort((a, b) => b.rx + b.tx - (a.rx + a.tx));
  const hostname = info?.hostname ?? 'Router';

  return (
    <>
      <Panel>
        <div className="status">
          <Headline links={links} rep={rep} />
          <div className="rates">
            <Rate label="Download" bytesPerSec={down} kind="down" />
            <Rate label="Upload" bytesPerSec={up} kind="up" />
            <Sparkline samples={samples} label="Internet traffic over the last few minutes" />
          </div>
        </div>
      </Panel>

      <Panel
        title="Traffic path"
        note={<PathLegend clients={busiest.slice(0, 5)} standby={links.standby.length > 0} />}
        className="section"
      >
        <div className="path">
          <TrafficPath status={s} hostname={hostname} links={links} rep={rep} busiest={busiest} total={down + up} onDevice={openDevice} />
        </div>
        <VerticalPath status={s} hostname={hostname} links={links} rep={rep} />
      </Panel>

      <Panel
        title="Busiest devices"
        className="section"
        actions={
          <button type="button" className="link" onClick={() => navigate('clients')}>
            All {clients.data?.length ?? 0} clients
          </button>
        }
      >
        <BusiestDevices busiest={busiest} />
      </Panel>

      <div className="section-gap">
        <Grid cols={3}>
          <RouterHealth status={s} fan={fan} />
          <Radios status={s} clients={online} />
          <Services status={s} adguardOn={adguard?.enabled} vpn={vpn} />
        </Grid>
      </div>
    </>
  );
}

function BusiestDevices({ busiest }: { busiest: Client[] }) {
  if (!busiest.length) return <p className="empty">No devices online.</p>;
  return (
    <DataTable
      label="Busiest devices"
      rows={busiest.slice(0, 5)}
      rowKey={(c) => c.mac}
      onRowClick={(c) => openDevice(c.mac)}
      columns={[
        {
          key: 'dev',
          header: 'Device',
          phone: 'title',
          cell: (c) => (
            <div className="dev-cell">
              <DeviceIcon client={c} />
              {c.name}
            </div>
          ),
        },
        {
          key: 'conn',
          header: 'Connected to',
          cell: (c) => (
            <span className="conn">
              <Swatch category={categoryOf(c)} />
              {c.link.label}
            </span>
          ),
        },
        { key: 'down', header: 'Down', align: 'end', phone: 'end', cell: (c) => rateText(c.rx) },
        { key: 'up', header: 'Up', align: 'end', cell: (c) => rateText(c.tx) },
      ]}
    />
  );
}

function Headline({ links, rep }: { links: Uplinks; rep: RepeaterStatus | null }) {
  if (!links.active.length)
    return (
      <div>
        <h1 className="offline">Offline: no uplink is connected</h1>
        <div className="context">
          <span>{links.standby.map((u) => u.name).join(', ')} all disconnected</span>
        </div>
      </div>
    );
  const sig = signal(rep?.signal);
  return (
    <div>
      <h1>{rep ? `Online through ${rep.ssid}` : `Online through ${links.active[0]?.name}`}</h1>
      <div className="context">
        {rep ? (
          <>
            <span>
              Repeater on {BAND_LABEL[rep.band] ?? rep.band}, channel {rep.channel}
              {rep.dfs ? ' (DFS)' : ''}
            </span>
            <span className={`num ${sig.weak ? 'weak' : 'good'}`}>
              Signal {String(rep.signal).replace('-', '−')} dBm, {sig.word}
            </span>
            <span className="num">
              {rep.ip} via {rep.gateway}
            </span>
            <span>Connected {connectedFor(rep.connectedFor)}</span>
          </>
        ) : (
          <span>{links.standby.length ? `Standby: ${links.standby.map((u) => u.name).join(', ')}` : 'No standby uplink'}</span>
        )}
      </div>
    </div>
  );
}

function Rate({ label, bytesPerSec, kind }: { label: string; bytesPerSec: number; kind: 'down' | 'up' }) {
  const r = rate(bytesPerSec);
  return (
    <div className={`rate ${kind}`}>
      <span className="label">{label}</span>
      <span className="value num">
        {r.value}
        <small>{r.unit}</small>
      </span>
    </div>
  );
}

function PathLegend({ clients, standby }: { clients: Client[]; standby: boolean }) {
  const present = new Set(clients.map(categoryOf));
  return (
    <span className="legend">
      {CATEGORIES.filter(([k]) => present.has(k)).map(([k, l]) => (
        <span className="conn" key={k}>
          <Swatch category={k} />
          {l}
        </span>
      ))}
      {standby ? <span className="conn">┄ standby uplink</span> : null}
    </span>
  );
}

function RouterHealth({ status, fan }: { status: RouterStatus; fan: { speed: number; status: boolean } | undefined }) {
  const used = status.memory.total - status.memory.free - status.memory.cache;
  return (
    <Panel
      title="Router"
      actions={
        <button type="button" className="link" onClick={() => navigate('device')}>
          Details
        </button>
      }
    >
      <KeyValues
        rows={[
          [
            'CPU load',
            <>
              <span className="num">{status.load[0] ?? '–'}</span>
              <span className="muted num"> {status.load.slice(1).join(' · ')}</span>
            </>,
          ],
          [
            'Memory',
            <>
              <span className="num">
                {bytes(used)} of {bytes(status.memory.total)}
              </span>
              <Meter value={used / status.memory.total} />
            </>,
          ],
          ['Storage', `${bytes(status.flash.total - status.flash.free)} of ${bytes(status.flash.total)}`],
          ['Temperature', status.cpuTemp === null ? '–' : `${status.cpuTemp} °C`],
          ['Fan', fan ? (fan.status ? `${fan.speed.toLocaleString()} rpm` : 'Off') : '–'],
          ['Uptime', duration(status.uptime)],
        ]}
      />
    </Panel>
  );
}

const BAND_CAT: Record<string, string> = { '2G': '24', '5G': '5', '6G': '6', MLD: 'mlo' };
const LINK_BAND: Record<string, string> = { '2G': '2.4', '5G': '5', '6G': '6', MLD: 'mlo' };

function Radios({ status, clients }: { status: RouterStatus; clients: Client[] }) {
  const nets = status.wifi.filter((w) => w.up && !w.iot);
  const count = (band: string, guest: boolean) =>
    clients.filter((c) => c.link.medium === 'wifi' && c.link.band === LINK_BAND[band] && c.link.guest === guest).length;
  return (
    <Panel
      title="WiFi"
      actions={
        <button type="button" className="link" onClick={() => navigate('wifi')}>
          Settings
        </button>
      }
    >
      {nets.length ? (
        nets.map((w) => (
          <div className="radio-row" key={w.name}>
            <span className={`swatch cat-${BAND_CAT[w.band] ?? 'wired'}`} />
            <span className="band">
              {BAND_LABEL[w.band] ?? w.band}
              {w.guest ? ' guest' : ''}
            </span>
            <span className="ssid">{w.ssid}</span>
            <span className="count">{plural(count(w.band, w.guest), 'client')}</span>
          </div>
        ))
      ) : (
        <p className="empty">All WiFi is off</p>
      )}
    </Panel>
  );
}

function Services({
  status,
  adguardOn,
  vpn,
}: {
  status: RouterStatus;
  adguardOn: boolean | undefined;
  vpn: { enabled: boolean; tunnels: unknown[] } | undefined;
}) {
  const svc = (n: string) => status.services.find((x) => x.name === n)?.running ?? false;
  const rows: [string, boolean, string, string?][] = [
    ['AdGuard Home', adguardOn ?? svc('adguardhome'), 'adguard'],
    ['VPN client', vpn?.enabled ?? false, 'tunnels', vpn && !vpn.tunnels.length ? 'No tunnels yet' : undefined],
    ['Tailscale', svc('tailscale'), 'tailscale'],
    ['WireGuard server', svc('wgserver'), 'wgserver'],
    ['ZeroTier', svc('zerotier'), 'zerotier'],
    ['IPv6', status.flags.ipv6 ?? false, 'ipv6'],
  ];
  return (
    <Panel title="Services">
      {rows.map(([name, on, page, note]) => (
        <button type="button" className="svc" key={name} onClick={() => navigate(page)}>
          <span className="txt">
            <span className="name">{name}</span>
            {note ? <span className="detail">{note}</span> : null}
          </span>
          <span className={`state${on ? ' on' : ''}`}>{on ? 'On' : 'Off'}</span>
        </button>
      ))}
    </Panel>
  );
}
