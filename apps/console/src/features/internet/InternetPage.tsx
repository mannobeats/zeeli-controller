import { type Icon, IconCellSignal5, IconDeviceMobile, IconPlugConnected, IconWifi } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  isIpv4,
  type RepeaterStatus,
  type SavedNetwork,
  type ScannedNetwork,
  UPLINKS,
  type WanConfig,
  type WanProtocol,
} from '@zeeli/router-api';
import { useState } from 'react';
import { LIVE, useStatus, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { BAND_LABEL, connectedFor, signal } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, Empty, KeyValues, Note, PageHeader, Panel, ToneText } from '../../ui/Layout.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

const KIND_ICON: Record<string, Icon> = { wifi: IconWifi, wired: IconPlugConnected, phone: IconDeviceMobile, cellular: IconCellSignal5 };
const dbm = (v: number | null) => (v === null ? '' : `${String(v).replace('-', '−')} dBm`);
const sigTone = (v: number | null) => (v === null ? 'off' : signal(v).weak ? 'warn' : 'ok');

export default function InternetPage() {
  const [sheet, setSheet] = useState<'wan' | 'repeater' | null>(null);
  const [joining, setJoining] = useState<ScannedNetwork | null>(null);
  const wan = useQuery({ queryKey: ['wan'], queryFn: api.internet.wan.get });
  const repeater = useQuery({ queryKey: ['repeater'], queryFn: api.internet.repeater, refetchInterval: LIVE.normal });
  const rep = repeater.data ?? null;
  return (
    <>
      <PageHeader title="Internet" />
      <Uplinks wan={wan.data} rep={rep} onSetUpWan={() => setSheet('wan')} />
      <RepeaterPanel rep={rep} onSettings={() => setSheet('repeater')} />
      <SavedNetworks current={rep?.connected ? rep.ssid : null} />
      <Nearby onJoin={setJoining} />
      {joining ? <JoinSheet network={joining} onClose={() => setJoining(null)} /> : null}
      {sheet === 'wan' && wan.data ? <WanSheet config={wan.data} onClose={() => setSheet(null)} /> : null}
      {sheet === 'repeater' ? <RepeaterSettings onClose={() => setSheet(null)} /> : null}
    </>
  );
}

function Uplinks({ wan, rep, onSetUpWan }: { wan: WanConfig | undefined; rep: RepeaterStatus | null; onSetUpWan: () => void }) {
  const status = useStatus().data;
  const teth = useQuery({ queryKey: ['tethering'], queryFn: api.internet.tethering });
  const up = (id: string) => status?.uplinks.find((u) => u.interface === id)?.up ?? false;
  const detail: Record<string, string> = {
    wwan: rep?.connected ? `${rep.ssid} · ${BAND_LABEL[rep.band] ?? rep.band} ch ${rep.channel}` : 'Not connected',
    wan: up('wan') ? (wan?.protocol ?? 'dhcp').toUpperCase() : 'No cable',
    secondwan: up('secondwan') ? 'Connected' : 'LAN1 is set as a LAN port',
    tethering: teth.data?.devices?.length ? 'Phone connected' : 'No phone connected',
    modem_1_1_2: 'No modem',
  };
  return (
    <Panel title="Uplinks" note="The router uses the first connected uplink">
      <DataTable
        label="Uplinks"
        rows={[...UPLINKS]}
        rowKey={(u) => u.id}
        columns={[
          {
            key: 'name',
            header: 'Uplink',
            phone: 'title',
            cell: (u) => {
              const I = KIND_ICON[u.kind] ?? IconPlugConnected;
              return (
                <div className="dev-cell">
                  <I size={16} stroke={1.75} />
                  {u.name}
                </div>
              );
            },
          },
          { key: 'detail', header: 'Details', phone: 'sub', cell: (u) => detail[u.id] },
          {
            key: 'state',
            header: 'State',
            align: 'end',
            phone: 'end',
            cell: (u) => (
              <span className="row-actions">
                {u.id === 'wan' ? (
                  <Button variant="ghost" onClick={onSetUpWan}>
                    Set up
                  </Button>
                ) : null}
                {up(u.id) ? <Chip tone="ok">Active</Chip> : <ToneText tone="off">Standby</ToneText>}
              </span>
            ),
          },
        ]}
      />
      <Note>
        A WAN MAC address and port roles are set in{' '}
        <button type="button" className="link" onClick={() => navigate('ports')}>
          Ethernet ports
        </button>
        . Failover order is in{' '}
        <button type="button" className="link" onClick={() => navigate('multiwan')}>
          Multi-WAN
        </button>
        .
      </Note>
    </Panel>
  );
}

function RepeaterPanel({ rep, onSettings }: { rep: RepeaterStatus | null; onSettings: () => void }) {
  const { toast, confirm } = useFeedback();
  const disconnect = useWrite(() => api.internet.disconnect(), [['repeater']]);
  async function leave() {
    if (
      !(await confirm({
        title: `Disconnect from ${rep?.ssid}?`,
        body: 'If this is your only active uplink, every device loses internet until the router joins a network again.',
        confirm: 'Disconnect',
      }))
    )
      return;
    try {
      await disconnect.mutateAsync(undefined);
      toast(`Disconnected from ${rep?.ssid}`);
    } catch (err) {
      toast(`Couldn’t disconnect: ${errorMessage(err)}`);
    }
  }
  return (
    <Panel
      className="section"
      title="Repeater"
      actions={
        <span className="row-actions">
          <Button onClick={onSettings}>Settings</Button>
          {rep?.connected ? (
            <Button variant="danger" onClick={leave}>
              Disconnect
            </Button>
          ) : null}
        </span>
      }
    >
      {rep?.connected ? <RepeaterDetails rep={rep} /> : <Empty>The repeater isn’t connected. Find a network below.</Empty>}
    </Panel>
  );
}

function RepeaterDetails({ rep }: { rep: RepeaterStatus }) {
  return (
    <KeyValues
      rows={[
        ['Network', rep.ssid],
        ['Signal', <ToneText key="s" tone={sigTone(rep.signal)}>{`${dbm(rep.signal)}, ${signal(rep.signal).word}`}</ToneText>],
        [
          'Band',
          `${BAND_LABEL[rep.band] ?? rep.band}, channel ${rep.channel}${rep.dfs ? ' (DFS)' : ''} · WiFi ${rep.generation} · ${rep.htmode}`,
        ],
        [
          'Address',
          <span key="a" className="mono">
            {rep.ip}
          </span>,
        ],
        ['Gateway and DNS', <span key="g" className="mono">{`${rep.gateway} · ${rep.dns.join(', ')}`}</span>],
        ['Connected for', connectedFor(rep.connectedFor)],
        ['Router MAC on this network', <span key="m" className="mono">{`${rep.mac}${rep.randomMac ? ' (random)' : ''}`}</span>],
      ]}
    />
  );
}

function SavedNetworks({ current }: { current: string | null }) {
  const { toast, confirm } = useFeedback();
  const saved = useQuery({ queryKey: ['saved-networks'], queryFn: api.internet.saved });
  const forget = useWrite((ssids: string[]) => api.internet.forgetAll(ssids), [['saved-networks']]);
  async function forgetAll(list: SavedNetwork[]) {
    if (
      !(await confirm({
        title: `Forget ${list.length === 1 ? list[0]?.ssid : `${list.length} networks`}?`,
        body: 'The router won’t rejoin them automatically.',
        confirm: 'Forget',
      }))
    )
      return;
    try {
      await forget.mutateAsync(list.map((n) => n.ssid));
      toast('Forgot the selected networks');
    } catch (err) {
      toast(`Couldn’t forget: ${errorMessage(err)}`);
    }
  }
  return (
    <Panel className="section" title="Saved networks">
      {saved.data?.length ? (
        <DataTable
          label="Saved networks"
          rows={saved.data}
          rowKey={(n) => n.ssid}
          bulk={[{ label: 'Forget', danger: true, run: forgetAll }]}
          columns={[
            {
              key: 'ssid',
              header: 'Network',
              phone: 'title',
              cell: (n) => (
                <span className="name">
                  {n.ssid} {n.ssid === current ? <Chip tone="brand">Connected</Chip> : null}
                </span>
              ),
            },
            {
              key: 'proto',
              header: 'Address',
              phone: 'sub',
              cell: (n) => `${n.protocol.toUpperCase()}${n.randomMac ? ' · random MAC' : ''}`,
            },
          ]}
        />
      ) : (
        <Empty>No saved networks.</Empty>
      )}
    </Panel>
  );
}

type ScanState = { state: 'idle' | 'scanning' | 'done' | 'error'; list: ScannedNetwork[]; error?: string };

function Nearby({ onJoin }: { onJoin: (n: ScannedNetwork) => void }) {
  const [scan, setScan] = useState<ScanState>({ state: 'idle', list: [] });
  async function run() {
    setScan({ state: 'scanning', list: [] });
    try {
      setScan({ state: 'done', list: await api.internet.scan() });
    } catch (err) {
      setScan({ state: 'error', list: [], error: errorMessage(err) });
    }
  }
  return (
    <Panel
      className="section"
      title="Nearby networks"
      actions={
        <Button variant="strong" busy={scan.state === 'scanning'} onClick={run}>
          {scan.state === 'scanning' ? 'Scanning…' : scan.list.length ? 'Scan again' : 'Find networks'}
        </Button>
      }
    >
      <ScanResult scan={scan} onJoin={onJoin} />
    </Panel>
  );
}

function ScanResult({ scan, onJoin }: { scan: ScanState; onJoin: (n: ScannedNetwork) => void }) {
  if (scan.state === 'scanning') return <Empty>Scanning all bands. This takes up to 20 seconds.</Empty>;
  if (scan.state === 'error') return <Empty>Scan failed: {scan.error}</Empty>;
  if (!scan.list.length) return <Empty>Scan to see networks the router can join as a repeater.</Empty>;
  return (
    <DataTable
      label="Nearby networks"
      rows={scan.list}
      rowKey={(n) => n.bssid || n.ssid}
      onRowClick={onJoin}
      columns={[
        { key: 'ssid', header: 'Network', phone: 'title', cell: (n) => <span className="name">{n.ssid || 'Hidden network'}</span> },
        {
          key: 'band',
          header: 'Band',
          phone: 'sub',
          cell: (n) => `${BAND_LABEL[n.band] ?? n.band}${n.channel ? ` · ch ${n.channel}` : ''}`,
        },
        { key: 'sec', header: 'Security', cell: (n) => (n.open ? 'Open' : 'Secured') },
        {
          key: 'sig',
          header: 'Signal',
          align: 'end',
          phone: 'end',
          cell: (n) => <ToneText tone={sigTone(n.signal)}>{dbm(n.signal)}</ToneText>,
        },
      ]}
    />
  );
}

function JoinSheet({ network, onClose }: { network: ScannedNetwork; onClose: () => void }) {
  const { toast } = useFeedback();
  const [ssid, setSsid] = useState(network.ssid);
  const [key, setKey] = useState('');
  const join = useWrite(
    () => api.internet.join({ ssid, ...(network.open ? {} : { key }), ...(network.bssid ? { bssid: network.bssid } : {}) }),
    [['repeater'], ['saved-networks']],
  );
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Join ${network.ssid || 'hidden network'}`}
      sub="The router switches its internet to this network. Devices lose internet for a few seconds while it connects."
      save="Join network"
      onSave={async () => {
        if (!ssid) throw new Error('Enter the network name.');
        if (!network.open && key.length < 8) throw new Error('Enter the network password.');
        await join.mutateAsync(undefined);
        toast(`Joining ${ssid}. The dashboard updates once it’s online.`);
      }}
    >
      {network.ssid ? null : <TextField label="Network name" value={ssid} onChange={setSsid} />}
      {network.open ? (
        <Note>This network is open, no password needed.</Note>
      ) : (
        <TextField label="Password" type="password" value={key} onChange={setKey} />
      )}
    </Sheet>
  );
}

function RepeaterSettings({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const cfg = useQuery({ queryKey: ['repeater-config'], queryFn: api.internet.repeaterConfig.get });
  const [auto, setAuto] = useState<boolean | null>(null);
  const [band, setBand] = useState<string | null>(null);
  if (!cfg.data) return null;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Repeater settings"
      onSave={async () => {
        await api.internet.repeaterConfig.set({
          auto: auto ?? cfg.data.auto,
          ...((band ?? cfg.data.lock_band) ? { lock_band: band ?? cfg.data.lock_band } : {}),
        });
        toast('Repeater settings saved');
      }}
    >
      <SwitchRow label="Join saved networks automatically" checked={auto ?? cfg.data.auto} onChange={setAuto} />
      <SelectField
        label="Band"
        value={band ?? cfg.data.lock_band ?? ''}
        options={[
          ['', 'Any band'],
          ['2g', '2.4 GHz only'],
          ['5g', '5 GHz only'],
          ['6g', '6 GHz only'],
        ]}
        onChange={setBand}
      />
    </Sheet>
  );
}

interface WanFields {
  user: string;
  pass: string;
  ip: string;
  mask: string;
  gw: string;
  dns1: string;
  dns2: string;
}

const wanFields = (c: WanConfig): WanFields => ({
  user: c.username ?? '',
  pass: c.password ?? '',
  ip: c.ipv4?.ip ?? '',
  mask: c.ipv4?.netmask ?? '255.255.255.0',
  gw: c.ipv4?.gateway ?? '',
  dns1: c.ipv4?.dns[0] ?? '',
  dns2: c.ipv4?.dns[1] ?? '',
});

/** Check the form and build what the router stores; only the chosen protocol's fields go along. */
function wanBody(protocol: WanProtocol, f: WanFields): WanConfig {
  if (protocol === 'pppoe') return { protocol, username: f.user, password: f.pass };
  if (protocol !== 'static') return { protocol };
  if (![f.ip, f.mask, f.gw, f.dns1].every(isIpv4)) throw new Error('Enter the address, mask, gateway and DNS server as IPv4 addresses.');
  if (f.dns2 && !isIpv4(f.dns2)) throw new Error('The second DNS server isn’t an IPv4 address.');
  return { protocol, ipv4: { ip: f.ip, netmask: f.mask, gateway: f.gw, dns: [f.dns1, f.dns2].filter(Boolean) } };
}

type SetWan = (k: keyof WanFields) => (value: string) => void;

function WanSheet({ config, onClose }: { config: WanConfig; onClose: () => void }) {
  const { toast, confirm } = useFeedback();
  const [protocol, setProtocol] = useState<WanProtocol>(config.protocol);
  const [f, setF] = useState(() => wanFields(config));
  const set: SetWan = (k) => (value) => setF((x) => ({ ...x, [k]: value }));
  const save = useWrite((c: WanConfig) => api.internet.wan.set(c, 'the WAN settings'), [['wan']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Ethernet 1 (WAN)"
      sub="How the router gets online through the WAN port."
      save="Apply"
      onSave={async () => {
        const body = wanBody(protocol, f);
        if (
          !(await confirm({
            title: 'Change the WAN connection?',
            body: 'The WAN port reconnects. If the settings are wrong, the router loses internet through this port until you change them back.',
            confirm: 'Apply',
            danger: false,
          }))
        )
          return false;
        await save.mutateAsync(body);
        toast('WAN settings applied. Reconnecting…');
      }}
    >
      <SelectField
        label="Connection"
        value={protocol}
        options={[
          ['dhcp', 'Automatic (DHCP)'],
          ['pppoe', 'PPPoE (username and password)'],
          ['static', 'Static IP'],
        ]}
        onChange={setProtocol}
      />
      {protocol === 'pppoe' ? <PppoeFields f={f} set={set} /> : null}
      {protocol === 'static' ? <StaticFields f={f} set={set} /> : null}
    </Sheet>
  );
}

function PppoeFields({ f, set }: { f: WanFields; set: SetWan }) {
  return (
    <>
      <TextField label="Username" value={f.user} onChange={set('user')} />
      <TextField label="Password" type="password" value={f.pass} onChange={set('pass')} />
    </>
  );
}

function StaticFields({ f, set }: { f: WanFields; set: SetWan }) {
  return (
    <>
      <TextField label="IP address" mono value={f.ip} onChange={set('ip')} />
      <TextField label="Subnet mask" mono value={f.mask} onChange={set('mask')} />
      <TextField label="Gateway" mono value={f.gw} onChange={set('gw')} />
      <TextField label="DNS server" mono value={f.dns1} onChange={set('dns1')} />
      <TextField label="Second DNS server" mono value={f.dns2} onChange={set('dns2')} placeholder="Optional" />
    </>
  );
}
