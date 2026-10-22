import { IconChevronDown, IconChevronUp, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  type EthernetPort,
  inSubnet,
  isIpv4,
  isMac,
  type MacMode,
  type MultiWan,
  type NetInterface,
  prefixToMask,
  type StaticRoute,
  uplinkName,
  type VlanMode,
} from '@zeeli/router-api';
import { useEffect, useState } from 'react';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { AdvancedGate } from '../../ui/AdvancedGate.tsx';
import { Button, IconButton } from '../../ui/Button.tsx';
import { stateColumn } from '../../ui/columns.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { ChipPicker, Row2, SelectField, TextField } from '../../ui/fields.tsx';
import { Chip, Empty, Note, PageHeader, Panel, Stack, ToneText } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

/* ======================= Ethernet ports ======================= */

const randomMac = () => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  b[0] = ((b[0] ?? 0) & 0xfc) | 0x02; // locally administered, unicast
  return [...b]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
};

export function PortsPage() {
  const query = useQuery({
    queryKey: ['ports'],
    queryFn: async () => ({ ports: await api.internet.ports(), networks: await api.networks.list() }),
  });
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<EthernetPort | null>(null);
  const role = useWrite(({ port, to }: { port: EthernetPort; to: 'wan' | 'lan' }) => api.internet.setPortRole(port, to), [['ports']]);

  async function switchRole(p: EthernetPort) {
    const toWan = p.role !== 'wan';
    if (
      !(await confirm({
        title: `Make ${p.label} a ${toWan ? 'WAN' : 'LAN'} port?`,
        body: toWan
          ? `Devices plugged into ${p.label} lose their LAN connection; it becomes a second internet uplink.`
          : `${p.label} stops being an internet uplink and joins the Main LAN.`,
        confirm: `Make it ${toWan ? 'WAN' : 'LAN'}`,
        danger: false,
      }))
    )
      return;
    try {
      await role.mutateAsync({ port: p, to: toWan ? 'wan' : 'lan' });
      toast(`${p.label} is now a ${toWan ? 'WAN' : 'LAN'} port`);
    } catch (err) {
      toast(`Couldn’t change ${p.label}: ${errorMessage(err)}`);
    }
  }

  return (
    <Loaded query={query} title="Ethernet ports">
      {({ ports, networks }) => {
        const vlanName = (id: number) => networks.find((n) => n.vlanId === id || (id === 1 && n.id === 'main'))?.label ?? `VLAN ${id}`;
        return (
          <>
            <PageHeader title="Ethernet ports" />
            <Panel title="Back panel" note={`${ports.filter((p) => p.speedMbps).length} of ${ports.length} connected`}>
              <div className="ports">
                {ports.map((p) => (
                  <button type="button" key={p.name} className={`port${p.speedMbps ? ' up' : ''}`} onClick={() => setEditing(p)}>
                    <span className="jack" />
                    <span className="silk">{p.label}</span>
                    <span className={`ps${p.speedMbps ? ' link' : ''}`}>
                      {p.speedMbps ? (p.speedMbps >= 1000 ? `${p.speedMbps / 1000} GbE` : `${p.speedMbps} Mb`) : 'No cable'}
                    </span>
                    <span className="ps">{p.role === 'wan' ? 'Internet (WAN)' : 'LAN'}</span>
                  </button>
                ))}
              </div>
            </Panel>
            <Panel className="section">
              <DataTable
                label="Ethernet ports"
                rows={ports}
                rowKey={(p) => p.name}
                onRowClick={setEditing}
                columns={[
                  { key: 'port', header: 'Port', phone: 'title', cell: (p) => <span className="name">{p.label}</span> },
                  {
                    key: 'role',
                    header: 'Role',
                    phone: 'sub',
                    cell: (p) => (
                      <>
                        {p.role === 'wan' ? 'Internet (WAN)' : 'LAN'}
                        {p.role !== p.defaultRole ? <span className="muted"> (changed)</span> : null}
                      </>
                    ),
                  },
                  {
                    key: 'what',
                    header: 'VLAN or MAC',
                    cell: (p) =>
                      p.role === 'wan' ? (
                        p.mac && p.mac.mode !== 'default' ? (
                          <>
                            <span className="mono">{p.mac.address}</span>{' '}
                            <span className="muted">({p.mac.mode === 'clone' ? 'copied' : 'random'})</span>
                          </>
                        ) : (
                          'Router’s own MAC'
                        )
                      ) : p.untagged === null ? (
                        '—'
                      ) : p.vlanMode === 'Multiple VLANs' ? (
                        `${vlanName(p.untagged)} + ${p.tagged.map(vlanName).join(', ')} tagged`
                      ) : (
                        vlanName(p.untagged)
                      ),
                  },
                  {
                    key: 'act',
                    header: '',
                    align: 'end',
                    phone: 'end',
                    cell: (p) =>
                      p.canBeWan && p.name !== 'wan' ? (
                        <Button
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            switchRole(p);
                          }}
                        >
                          Use as {p.role === 'wan' ? 'LAN' : 'WAN'}
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </Panel>
            {editing ? (
              <PortSheet
                key={editing.name}
                port={editing}
                networks={networks.map((n) => [n.vlanId ?? 1, `${n.label} · VLAN ${n.vlanId ?? 1}`] as const)}
                onClose={() => setEditing(null)}
              />
            ) : null}
          </>
        );
      }}
    </Loaded>
  );
}

function PortSheet({ port, networks, onClose }: { port: EthernetPort; networks: (readonly [number, string])[]; onClose: () => void }) {
  return port.role === 'wan' ? (
    <WanMacSheet port={port} onClose={onClose} />
  ) : (
    <LanVlanSheet port={port} networks={networks} onClose={onClose} />
  );
}

function WanMacSheet({ port, onClose }: { port: EthernetPort; onClose: () => void }) {
  const { toast } = useFeedback();
  const clients = useClients().data ?? [];
  const own = port.mac?.own ?? '';
  const [mode, setMode] = useState<MacMode>(port.mac?.mode ?? 'default');
  const [mac, setMac] = useState(port.mac?.mode === 'default' ? own : (port.mac?.address ?? ''));
  const save = useWrite(async () => {
    const address = mode === 'default' ? own : mac.trim().toUpperCase();
    if (!isMac(address)) throw new Error('Enter a MAC address like 02:00:00:00:00:01.');
    await api.internet.setPortMac(port, mode, address);
    return address;
  }, [['ports']]);
  const pickMode = (m: MacMode) => {
    setMode(m);
    if (m === 'default') setMac(own);
    if (m === 'random' && (!mac || mac === own)) setMac(randomMac());
  };
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${port.label} MAC address`}
      sub="Some providers only hand out an address to the device they first saw."
      onSave={async () => toast(`${port.label} now uses ${await save.mutateAsync(undefined)}`)}
    >
      <SelectField
        label="MAC address"
        value={mode}
        options={[
          ['default', 'Router’s own'],
          ['clone', 'Copy a device’s'],
          ['random', 'Random'],
        ]}
        onChange={pickMode}
      />
      {mode === 'clone' && clients.length ? (
        <SelectField
          label="Device to copy"
          value=""
          options={[['', 'Enter a MAC address'], ...clients.map((c) => [c.mac, `${c.name} · ${c.mac}`] as const)]}
          onChange={(m) => m && setMac(m)}
        />
      ) : null}
      <TextField label="Address" mono value={mac} onChange={setMac} readOnly={mode === 'default'} hint={`Router’s own: ${own}`} />
    </Sheet>
  );
}

function LanVlanSheet({ port, networks, onClose }: { port: EthernetPort; networks: (readonly [number, string])[]; onClose: () => void }) {
  const { toast } = useFeedback();
  const [vlanMode, setVlanMode] = useState<VlanMode>(port.vlanMode ?? 'Standard');
  const [untagged, setUntagged] = useState(port.untagged ?? 1);
  const [tagged, setTagged] = useState<number[]>(port.tagged);
  const save = useWrite(async () => {
    if (vlanMode === 'Multiple VLANs' && !tagged.some((t) => t !== untagged))
      throw new Error('Pick at least one tagged network other than the untagged one.');
    await api.internet.setPortVlans(port, vlanMode, untagged, tagged);
  }, [['ports']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${port.label} networks`}
      sub="Which networks a device plugged into this port joins."
      onSave={async () => {
        await save.mutateAsync(undefined);
        toast(`${port.label} saved`);
      }}
    >
      <SelectField
        label="Port carries"
        value={vlanMode}
        options={[
          ['Standard', 'One network'],
          ['Multiple VLANs', 'Several networks (trunk)'],
        ]}
        onChange={setVlanMode}
      />
      <SelectField
        label="Untagged network"
        value={untagged}
        options={networks}
        onChange={setUntagged}
        hint="Devices that don’t tag their traffic land here."
      />
      {vlanMode === 'Multiple VLANs' ? (
        <ChipPicker legend="Tagged networks" options={networks.filter(([id]) => id !== untagged)} value={tagged} onChange={setTagged} />
      ) : null}
    </Sheet>
  );
}

/* ======================= DHCP ======================= */

const left = (seconds: number | null, since: number) => {
  if (seconds === null) return 'Never expires';
  const s = Math.max(0, seconds - Math.floor((Date.now() - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
};

export function DhcpPage() {
  return (
    <AdvancedGate title="DHCP and leases">
      <DhcpBody />
    </AdvancedGate>
  );
}

function DhcpBody() {
  const { toast } = useFeedback();
  const clients = useClients().data ?? [];
  const query = useQuery({
    queryKey: ['dhcp'],
    queryFn: async () => {
      const [leases, reservations, networks] = await Promise.all([api.openwrt.leases(), api.networks.reservations(), api.networks.list()]);
      return { leases, reservations, networks, at: Date.now() };
    },
    refetchInterval: 30_000,
  });
  // the countdowns tick between refreshes
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const reserve = useWrite(
    async (rows: { mac: string; ip: string; hostname: string }[]) => {
      const networks = query.data?.networks ?? [];
      const list = rows.map((l) => {
        const net = networks.find((n) => inSubnet(l.ip, n.ip, n.netmask));
        if (!net) throw new Error(`${l.ip} isn’t in any of your networks.`);
        return { mac: l.mac, ip: l.ip, name: l.hostname, network: net.id };
      });
      await api.networks.reserveAll(list);
    },
    [['dhcp'], ['reservations']],
  );

  return (
    <Loaded query={query} title="DHCP and leases">
      {({ leases, reservations, networks, at }) => {
        const name = (l: { mac: string; hostname: string }) =>
          clients.find((c) => c.mac === l.mac)?.name || l.hostname || leases.hints[l.mac]?.name || 'Unnamed device';
        const isReserved = (mac: string) => reservations.some((r) => r.mac === mac);
        const v4 = [...leases.v4].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
        const run = async (rows: typeof v4) => {
          const todo = rows.filter((l) => !isReserved(l.mac)).map((l) => ({ ...l, hostname: name(l) }));
          try {
            await reserve.mutateAsync(todo);
            toast(`Reserved ${plural(todo.length, 'address', 'addresses')}`);
          } catch (err) {
            toast(errorMessage(err));
          }
        };
        return (
          <>
            <PageHeader
              title="DHCP and leases"
              sub={`${plural(v4.length, 'active IPv4 lease')}${leases.v6.length ? `, ${leases.v6.length} IPv6` : ''}. Devices with an address set on the device itself don’t take a lease.`}
              actions={
                <Button icon={<IconRefresh size={16} />} onClick={() => query.refetch()}>
                  Refresh
                </Button>
              }
            />
            <Panel>
              {v4.length ? (
                <DataTable
                  label="IPv4 leases"
                  rows={v4}
                  rowKey={(l) => l.mac}
                  bulk={[{ label: 'Reserve these addresses', run, when: (rows) => rows.some((l) => !isReserved(l.mac)) }]}
                  columns={[
                    { key: 'dev', header: 'Device', phone: 'title', cell: (l) => <span className="name">{name(l)}</span> },
                    { key: 'ip', header: 'IP address', phone: 'sub', cell: (l) => <span className="mono">{l.ip}</span> },
                    { key: 'mac', header: 'MAC', cell: (l) => <span className="mono muted">{l.mac}</span> },
                    { key: 'net', header: 'Network', cell: (l) => networks.find((n) => inSubnet(l.ip, n.ip, n.netmask))?.label ?? '' },
                    { key: 'ends', header: 'Lease ends in', cell: (l) => <span className="num">{left(l.expires, at)}</span> },
                    {
                      key: 'res',
                      header: '',
                      align: 'end',
                      phone: 'end',
                      cell: (l) =>
                        isReserved(l.mac) ? (
                          <Chip tone="brand">Reserved</Chip>
                        ) : (
                          <Button variant="ghost" onClick={() => run([l])}>
                            Reserve
                          </Button>
                        ),
                    },
                  ]}
                />
              ) : (
                <Empty>No active leases.</Empty>
              )}
            </Panel>
            {leases.v6.length ? (
              <Panel className="section" title="IPv6 leases">
                <DataTable
                  label="IPv6 leases"
                  rows={leases.v6}
                  rowKey={(l) => l.duid + l.ip}
                  columns={[
                    {
                      key: 'dev',
                      header: 'Device',
                      phone: 'title',
                      cell: (l) => <span className="name">{l.hostname || 'Unnamed device'}</span>,
                    },
                    { key: 'ip', header: 'Address', phone: 'sub', cell: (l) => <span className="mono">{l.ip}</span> },
                    { key: 'duid', header: 'DUID', cell: (l) => <span className="mono muted">{l.duid}</span> },
                    { key: 'ends', header: 'Ends in', align: 'end', phone: 'end', cell: (l) => left(l.expires, at) },
                  ]}
                />
              </Panel>
            ) : null}
          </>
        );
      }}
    </Loaded>
  );
}

/* ======================= Routing ======================= */

const IFACE_LABEL: Record<string, string> = {
  lan: 'Main LAN',
  wan: 'Ethernet 1 (WAN)',
  wwan: 'Repeater',
  guest: 'Guest',
  iot: 'IoT',
  secondwan: 'Ethernet 2',
  tethering: 'Tethering',
  tailscale0: 'Tailscale',
};
const ifaceLabel = (n: string) => IFACE_LABEL[n] ?? n;

export function RoutesPage() {
  return (
    <AdvancedGate title="Routing">
      <RoutesBody />
    </AdvancedGate>
  );
}

function RoutesBody() {
  const { toast, confirm } = useFeedback();
  const query = useQuery({
    queryKey: ['routes'],
    queryFn: async () => ({ ...(await api.openwrt.routes()), ifaces: await api.openwrt.interfaces() }),
  });
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<StaticRoute | 'new' | null>(null);
  const remove = useWrite((list: StaticRoute[]) => api.openwrt.removeRoutes(list), [['routes']]);

  async function removeRoutes(list: StaticRoute[]) {
    const what = list.length === 1 ? `the route to ${list[0]?.target}` : plural(list.length, 'route');
    if (
      !(await confirm({ title: `Delete ${what}?`, body: 'Traffic for those networks goes back to the default route.', confirm: 'Delete' }))
    )
      return;
    try {
      await remove.mutateAsync(list);
      toast(`Deleted ${what}`);
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  return (
    <Loaded query={query} title="Routing">
      {({ statics, table, ifaces }) => {
        const devIface = (dev?: string) => ifaces.find((i) => i.device === dev)?.name;
        const tables = new Set(table.map((r) => r.table ?? 'main'));
        const rows = table.filter((r) => all || !r.table || r.table === 'main' || r.table === 'default');
        return (
          <>
            <PageHeader
              title="Routing"
              sub="Static routes apply with automatic rollback."
              actions={
                <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                  New route
                </Button>
              }
            />
            <Panel title="Static routes" note="Send traffic for a network through a specific gateway or interface">
              {statics.length ? (
                <DataTable
                  label="Static routes"
                  rows={statics}
                  rowKey={(r) => r.id}
                  onRowClick={setEditing}
                  rowClass={(r) => (r.enabled ? undefined : 'off')}
                  bulk={[{ label: 'Delete', danger: true, run: removeRoutes }]}
                  columns={[
                    { key: 'dst', header: 'Destination', phone: 'title', cell: (r) => <span className="name mono">{r.target}</span> },
                    { key: 'gw', header: 'Gateway', phone: 'sub', cell: (r) => <span className="mono">{r.gateway || 'On link'}</span> },
                    { key: 'if', header: 'Interface', cell: (r) => ifaceLabel(r.interface) },
                    { key: 'metric', header: 'Metric', cell: (r) => <span className="num">{r.metric || '0'}</span> },
                    stateColumn(),
                  ]}
                />
              ) : (
                <Empty>No static routes. The router reaches everything through its default route.</Empty>
              )}
            </Panel>
            <Panel
              className="section"
              title="Routing table"
              actions={
                <label className="ctx-check">
                  <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
                  Show all {tables.size} tables
                </label>
              }
            >
              <DataTable
                label="Routing table"
                rows={rows}
                rowKey={(r) => `${r.table ?? 'main'} ${r.dst} ${r.dev ?? ''} ${r.gateway ?? ''}`}
                columns={[
                  {
                    key: 'dst',
                    header: 'Destination',
                    phone: 'title',
                    cell: (r) => <span className="name mono">{r.dst === 'default' ? 'Default (internet)' : r.dst}</span>,
                  },
                  {
                    key: 'via',
                    header: 'Via',
                    phone: 'sub',
                    cell: (r) => <span className="mono">{r.gateway ?? (r.scope === 'link' ? 'On link' : '—')}</span>,
                  },
                  { key: 'if', header: 'Interface', cell: (r) => ifaceLabel(devIface(r.dev) ?? r.dev ?? '') },
                  { key: 'table', header: 'Table', cell: (r) => r.table ?? 'main' },
                  {
                    key: 'metric',
                    header: 'Metric',
                    align: 'end',
                    phone: 'end',
                    cell: (r) => <span className="num">{r.metric ?? ''}</span>,
                  },
                ]}
              />
            </Panel>
            {editing ? (
              <RouteSheet
                key={editing === 'new' ? 'new' : editing.id}
                route={editing === 'new' ? null : editing}
                ifaces={ifaces}
                onClose={() => setEditing(null)}
                onDelete={(r) => {
                  setEditing(null);
                  removeRoutes([r]);
                }}
              />
            ) : null}
          </>
        );
      }}
    </Loaded>
  );
}

function RouteSheet({
  route,
  ifaces,
  onClose,
  onDelete,
}: {
  route: StaticRoute | null;
  ifaces: NetInterface[];
  onClose: () => void;
  onDelete: (r: StaticRoute) => void;
}) {
  const { toast } = useFeedback();
  const [target, setTarget] = useState(route?.target ?? '');
  const [gateway, setGateway] = useState(route?.gateway ?? '');
  const [iface, setIface] = useState(route?.interface ?? 'lan');
  const [metric, setMetric] = useState(route?.metric ?? '');
  const save = useWrite(async () => {
    const [ip = '', prefix = '32'] = target.trim().split('/');
    if (!isIpv4(ip) || !(Number(prefix) >= 0 && Number(prefix) <= 32)) throw new Error('Destination must look like 192.168.50.0/24.');
    if (gateway && !isIpv4(gateway)) throw new Error('Gateway must be an IPv4 address.');
    if (metric && !/^\d+$/.test(metric)) throw new Error('Metric is a whole number.');
    await api.openwrt.saveRoute(
      { target: `${ip}/${prefix}`, gateway, interface: iface, metric },
      prefixToMask(Number(prefix)),
      route ?? undefined,
    );
  }, [['routes']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={route ? `Route to ${route.target}` : 'New static route'}
      sub="Applies with automatic rollback, so a wrong route can’t cut you off for good."
      save={route ? 'Save and apply' : 'Add route'}
      danger={route ? { label: 'Delete route', onClick: () => onDelete(route) } : undefined}
      onSave={async () => {
        await save.mutateAsync(undefined);
        toast(route ? `Saved route to ${target}` : `Added route to ${target}`);
      }}
    >
      <TextField label="Destination network" mono value={target} onChange={setTarget} placeholder="192.168.50.0/24" />
      <TextField
        label="Gateway"
        mono
        inputMode="decimal"
        value={gateway}
        onChange={setGateway}
        placeholder="On link"
        hint="The next router on the path. Empty for a directly attached network."
      />
      <Row2>
        <SelectField
          label="Interface"
          value={iface}
          options={ifaces.map((i) => [i.name, `${ifaceLabel(i.name)}${i.up ? '' : ' (down)'}`] as const)}
          onChange={setIface}
        />
        <TextField label="Metric" inputMode="numeric" value={metric} onChange={setMetric} placeholder="0" />
      </Row2>
    </Sheet>
  );
}

/* ======================= Multi-WAN ======================= */

export function MultiWanPage() {
  const query = useQuery({ queryKey: ['multiwan'], queryFn: api.internet.multiWan, refetchInterval: 15_000 });
  return (
    <Loaded query={query} title="Multi-WAN">
      {(mw) => (
        <>
          <PageHeader title="Multi-WAN" sub="How the router uses its uplinks when more than one is connected." />
          <Stack>
            <MultiWanForm mw={mw} />
            {mw.sensitivity === null ? null : <SensitivityForm value={mw.sensitivity} />}
          </Stack>
        </>
      )}
    </Loaded>
  );
}

function MultiWanForm({ mw }: { mw: MultiWan }) {
  const form = useForm({ mode: mw.mode, order: mw.uplinks.map((u) => ({ id: u.id, weight: String(u.weight) })) });
  const save = useWrite(
    () =>
      api.internet.setMultiWan(
        form.values.mode,
        form.values.order.map((u) => ({ id: u.id, weight: Number(u.weight) || 0 })),
      ),
    [['multiwan']],
  );
  const v = form.values;
  const move = (i: number, d: number) => {
    const next = [...v.order];
    const [a, b] = [next[i], next[i + d]];
    if (!a || !b) return;
    next[i] = b;
    next[i + d] = a;
    form.set('order', next);
  };
  return (
    <SettingsForm
      title="Mode"
      form={form}
      onSave={async () => {
        if (v.mode === 1 && v.order.filter((u) => Number(u.weight) > 0).length < 2)
          throw new Error('Load balancing needs at least two uplinks with a weight above 0.');
        await save.mutateAsync(undefined);
        return 'Multi-WAN saved. Uplinks re-check within about 10 seconds.';
      }}
    >
      <SelectField
        label="Use uplinks"
        value={v.mode}
        options={[
          [0, 'Failover: one at a time, in this order'],
          [1, 'Load balance: share traffic by weight'],
        ]}
        onChange={(m) => form.set('mode', m)}
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Uplink</th>
              <th>Internet</th>
              <th>Health check</th>
              <th className="r">{v.mode === 1 ? 'Weight' : 'Order'}</th>
            </tr>
          </thead>
          <tbody>
            {v.order.map((o, i) => {
              const u = mw.uplinks.find((x) => x.id === o.id);
              return (
                <tr key={o.id}>
                  <td className="name ph-title">{uplinkName(o.id)}</td>
                  <td className="ph-sub">
                    <ToneText tone={u?.online ? 'ok' : 'off'}>{u?.online ? 'Online' : 'Offline'}</ToneText>
                  </td>
                  <td className="ph-hide">
                    {u?.healthCheck ? `Pings ${u.pingTargets.slice(0, 2).join(', ')}` : <ToneText tone="off">Off</ToneText>}
                  </td>
                  <td className="r ph-end">
                    {v.mode === 1 ? (
                      <span className="input inline-input">
                        <span className="box">
                          <input
                            value={o.weight}
                            inputMode="numeric"
                            aria-label={`Weight for ${uplinkName(o.id)}`}
                            onChange={(e) =>
                              form.set(
                                'order',
                                v.order.map((x) => (x.id === o.id ? { ...x, weight: e.target.value } : x)),
                              )
                            }
                          />
                        </span>
                      </span>
                    ) : (
                      <span className="order-btns">
                        <span className="num muted">{i + 1}</span>
                        <IconButton label={`Move ${uplinkName(o.id)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                          <IconChevronUp size={16} />
                        </IconButton>
                        <IconButton label={`Move ${uplinkName(o.id)} down`} disabled={i === v.order.length - 1} onClick={() => move(i, 1)}>
                          <IconChevronDown size={16} />
                        </IconButton>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SettingsForm>
  );
}

function SensitivityForm({ value }: { value: number }) {
  const form = useForm({ val: value });
  const save = useWrite(() => api.internet.setSensitivity(form.values.val), [['multiwan']]);
  return (
    <SettingsForm
      title="Switch-over speed"
      form={form}
      onSave={async () => {
        await save.mutateAsync(undefined);
        return 'Switch-over speed saved';
      }}
    >
      <SelectField
        label="How fast to switch when an uplink fails"
        value={form.values.val}
        options={[
          [1, 'Very slow, fewest false alarms'],
          [2, 'Slow'],
          [3, 'Medium'],
          [4, 'Fast'],
          [5, 'Very fast'],
        ]}
        onChange={(x) => form.set('val', x)}
      />
    </SettingsForm>
  );
}

/* ======================= Mesh ======================= */

export function MeshPage() {
  const { toast, confirm } = useFeedback();
  const query = useQuery({ queryKey: ['mesh'], queryFn: api.networkExtras.mesh.config.get });
  const toggle = useWrite(
    (on: boolean) => api.networkExtras.mesh.config.set(on ? { enabled: true, mode: 'controller' } : { enabled: false }),
    [['mesh']],
  );
  const [adding, setAdding] = useState(false);
  return (
    <Loaded query={query} title="Mesh">
      {(m) => (
        <>
          <PageHeader title="Mesh" sub="Other GL.iNet routers extend your WiFi under one name." />
          <Panel
            title={m.enabled ? `Mesh is on, this router is the ${m.mode}` : 'Mesh is off'}
            actions={m.enabled ? <Chip tone="ok">On</Chip> : null}
          >
            <Note>
              {m.enabled
                ? 'Reset a GL.iNet router to factory settings, place it within reach, then scan for it.'
                : 'Turn mesh on, then add nodes from a scan.'}
            </Note>
            <div className="row-actions start">
              <Button
                variant={m.enabled ? 'danger' : 'strong'}
                busy={toggle.isPending}
                onClick={async () => {
                  const on = !m.enabled;
                  if (
                    !(await confirm({
                      title: on ? 'Turn mesh on?' : 'Turn mesh off?',
                      body: on
                        ? 'WiFi restarts briefly so the mesh backhaul can start. This router becomes the mesh controller.'
                        : 'Mesh nodes disconnect and stop extending your WiFi.',
                      confirm: on ? 'Turn on' : 'Turn off',
                      danger: !on,
                    }))
                  )
                    return;
                  try {
                    await toggle.mutateAsync(on);
                    toast(`Mesh ${on ? 'on' : 'off'}`);
                  } catch (err) {
                    toast(`Couldn’t change mesh: ${errorMessage(err)}`);
                  }
                }}
              >
                {m.enabled ? 'Turn mesh off' : 'Turn mesh on'}
              </Button>
              {m.enabled ? <Button onClick={() => setAdding(true)}>Add nodes</Button> : null}
            </div>
          </Panel>
          {adding ? <MeshScan onClose={() => setAdding(false)} /> : null}
        </>
      )}
    </Loaded>
  );
}

const SCAN_WINDOW_MS = 60_000;

function scanMessage(status: string | undefined, found: number, error: unknown) {
  if (error) return `Couldn’t start the scan: ${errorMessage(error)}`;
  if (status === undefined) return 'Reset a GL.iNet router, place it nearby, then scan.';
  if (status === 'failed') return 'The scan failed. Try again in a moment.';
  if (status === 'scanning') return `Scanning for nodes…${found ? ` ${found} found` : ''}`;
  return found ? 'Scan finished.' : 'No nodes found. Check the node is reset and close by, then scan again.';
}

function MeshScan({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const [picked, setPicked] = useState<string[]>([]);
  const [since, setSince] = useState<number | null>(null);
  const start = useWrite(() => api.networkExtras.mesh.scan(), [['mesh-scan']]);
  const scan = useQuery({
    queryKey: ['mesh-scan', since],
    queryFn: api.networkExtras.mesh.scanStatus,
    enabled: since !== null,
    refetchInterval: (q) => (q.state.data?.status === 'scanning' && q.state.dataUpdatedAt - (since ?? 0) < SCAN_WINDOW_MS ? 3000 : false),
  });
  const nodes = scan.data?.nodes ?? [];
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add mesh nodes"
      sub="Nodes must be GL.iNet routers reset to factory settings and powered on nearby."
      save="Add selected"
      onSave={async () => {
        if (!picked.length) throw new Error('Pick at least one node.');
        await api.networkExtras.mesh.add(picked);
        toast(`Added ${plural(picked.length, 'node')}. They finish setting up in a few minutes.`);
      }}
    >
      <Note>{scanMessage(since === null ? undefined : (scan.data?.status ?? 'scanning'), nodes.length, start.error)}</Note>
      <div className="row-actions start">
        <Button
          busy={start.isPending}
          onClick={() =>
            start.mutateAsync(undefined).then(
              () => setSince(Date.now()),
              () => undefined,
            )
          }
        >
          {since === null ? 'Scan for nodes' : 'Scan again'}
        </Button>
      </div>
      {nodes.length ? (
        <ChipPicker
          legend="Found"
          options={nodes.map((n) => [n.mac, `${n.model} · ${n.mac}${n.signal === null ? '' : ` · ${n.signal} dBm`}`] as const)}
          value={picked}
          onChange={setPicked}
        />
      ) : null}
    </Sheet>
  );
}
