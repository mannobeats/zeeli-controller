import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  inSubnet,
  isIpv4,
  isMac,
  maskToPrefix,
  type Network,
  type NetworkInput,
  type Reservation,
  type WanAccess,
} from '@zeeli/router-api';
import { useState } from 'react';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Row2, SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Empty, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { formValues, type NetworkFormValues, toNetworkInput } from './form.ts';

const ACCESS: [WanAccess, string][] = [
  [0, 'Internet and upstream network'],
  [1, 'Internet only, block upstream network'],
  [2, 'No internet, local only'],
];
const LEASES: [string, string][] = [
  ['1h', '1 hour'],
  ['6h', '6 hours'],
  ['12h', '12 hours'],
  ['24h', '1 day'],
  ['48h', '2 days'],
  ['168h', '1 week'],
];

export default function NetworksPage() {
  const query = useQuery({
    queryKey: ['networks-page'],
    queryFn: async () => ({ networks: await api.networks.list(), reservations: await api.networks.reservations() }),
  });
  const clients = useClients().data ?? [];
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<Network | 'new' | null>(null);
  const [reserving, setReserving] = useState<Reservation | 'new' | null>(null);
  const unreserve = useWrite((list: Reservation[]) => api.networks.unreserveAll(list), [['networks-page'], ['reservations']]);
  const reserve = useWrite((list: Reservation[]) => api.networks.reserveAll(list), [['networks-page'], ['reservations']]);

  const nameFor = (mac: string) => clients.find((c) => c.mac === mac)?.name ?? mac;

  async function removeReservations(list: Reservation[]) {
    const what = list.length === 1 ? `the reservation for ${list[0]?.name || list[0]?.mac}` : plural(list.length, 'reservation');
    if (
      !(await confirm({
        title: `Remove ${what}?`,
        body: 'The addresses go back into the DHCP pool. Devices may get different addresses next time they connect.',
        confirm: 'Remove',
      }))
    )
      return;
    try {
      await unreserve.mutateAsync(list);
      toast(`Removed ${what}`, () => reserve.mutateAsync(list));
    } catch (err) {
      toast(`Couldn’t remove: ${errorMessage(err)}`);
    }
  }

  return (
    <Loaded query={query} title="Networks and VLANs">
      {({ networks, reservations }) => (
        <>
          <PageHeader
            title="Networks and VLANs"
            actions={
              <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                New network
              </Button>
            }
          />
          <Panel>
            <DataTable
              label="Networks"
              rows={networks}
              rowKey={(n) => n.id}
              onRowClick={setEditing}
              columns={[
                { key: 'name', header: 'Network', phone: 'title', cell: (n) => <span className="name">{n.label}</span> },
                {
                  key: 'gw',
                  header: 'Gateway',
                  phone: 'sub',
                  cell: (n) => <span className="mono">{`${n.ip}/${maskToPrefix(n.netmask)}`}</span>,
                },
                { key: 'vlan', header: 'VLAN', cell: (n) => <span className="num">{n.vlanId ?? '—'}</span> },
                {
                  key: 'dhcp',
                  header: 'DHCP range',
                  cell: (n) => <span className="mono">{n.dhcp ? `${n.dhcpStart} – ${n.dhcpEnd.split('.').pop()}` : 'DHCP off'}</span>,
                },
                {
                  key: 'on',
                  header: 'Active on',
                  cell: (n) =>
                    n.ports
                      .filter((p) => p.up)
                      .map((p) => p.name)
                      .join(', ') || <span className="muted">Nothing connected</span>,
                },
                {
                  key: 'state',
                  header: 'State',
                  align: 'end',
                  phone: 'end',
                  cell: (n) => <span className={n.enabled ? 'state-on' : 'state-off'}>{n.enabled ? 'On' : 'Off'}</span>,
                },
              ]}
            />
          </Panel>
          <Panel
            className="section"
            title="Reserved IP addresses"
            actions={
              <Button icon={<IconPlus size={16} />} onClick={() => setReserving('new')}>
                Reserve an IP
              </Button>
            }
          >
            {reservations.length ? (
              <DataTable
                label="Reserved IP addresses"
                rows={reservations}
                rowKey={(r) => r.mac}
                onRowClick={setReserving}
                bulk={[{ label: 'Remove', danger: true, run: removeReservations }]}
                columns={[
                  { key: 'dev', header: 'Device', phone: 'title', cell: (r) => <span className="name">{r.name || nameFor(r.mac)}</span> },
                  { key: 'ip', header: 'IP address', phone: 'sub', cell: (r) => <span className="mono">{r.ip}</span> },
                  { key: 'mac', header: 'MAC', cell: (r) => <span className="mono muted">{r.mac}</span> },
                  {
                    key: 'net',
                    header: 'Network',
                    phone: 'end',
                    cell: (r) => networks.find((n) => n.id === r.network)?.label ?? r.network,
                  },
                ]}
              />
            ) : (
              <Empty>No reserved addresses. Reserve one so a device always gets the same IP.</Empty>
            )}
          </Panel>
          <NetworkSheet network={editing} onClose={() => setEditing(null)} />
          <ReservationSheet
            reservation={reserving}
            networks={networks}
            reserved={reservations}
            onClose={() => setReserving(null)}
            onRemove={(r) => {
              setReserving(null);
              removeReservations([r]);
            }}
          />
        </>
      )}
    </Loaded>
  );
}

function NetworkSheet({ network, onClose }: { network: Network | 'new' | null; onClose: () => void }) {
  if (network === null) return null;
  const n = network === 'new' ? null : network;
  return <NetworkForm key={n?.id ?? 'new'} network={n} onDone={onClose} />;
}

function sheetSub(network: Network | null) {
  if (!network) return 'A separate subnet on its own VLAN';
  return network.id === 'main' ? 'Your main network. Changing its IP moves the router’s own address.' : undefined;
}

function NetworkForm({ network, onDone }: { network: Network | null; onDone: () => void }) {
  const { toast, confirm } = useFeedback();
  const main = network?.id === 'main';
  const fixed = network?.fixed ?? false;
  const [v, setV] = useState(() => formValues(network));
  const set =
    <K extends keyof NetworkFormValues>(k: K) =>
    (value: NetworkFormValues[K]) =>
      setV((x) => ({ ...x, [k]: value }));
  const save = useWrite((input: NetworkInput) => api.networks.save(input, network ?? undefined), [['networks-page'], ['networks']]);
  const remove = useWrite(() => api.networks.remove(network?.id ?? ''), [['networks-page'], ['networks']]);

  async function submit() {
    const input = toNetworkInput(v, network);
    if (main && network && v.ip !== network.ip) {
      const ok = await confirm({
        title: 'Move the router to a new address?',
        body: `The router moves from ${network.ip} to ${v.ip}. Devices reconnect, and you’ll open this console at the new address.`,
        confirm: 'Change address',
        danger: false,
      });
      if (!ok) return false;
    }
    await save.mutateAsync(input);
    toast(network ? `Saved ${input.label || network.label}` : `Created ${input.label}`);
    onDone();
  }

  async function deleteNetwork() {
    if (!network) return;
    if (
      !(await confirm({
        title: `Delete ${network.label}?`,
        body: 'Devices on it lose their connection, and its VLAN stops working on every port.',
        confirm: 'Delete network',
      }))
    )
      return;
    try {
      await remove.mutateAsync(undefined);
      toast(`Deleted ${network.label}`);
      onDone();
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onDone()}
      title={network ? network.label : 'New network'}
      sub={sheetSub(network)}
      save={network ? 'Save' : 'Create network'}
      danger={network && !fixed ? { label: 'Delete network', onClick: deleteNetwork } : undefined}
      onSave={submit}
    >
      {fixed ? null : <TextField label="Name" value={v.label} onChange={set('label')} placeholder="Cameras" required />}
      {fixed && !main ? <SwitchRow label="Network on" checked={v.enabled} onChange={set('enabled')} /> : null}
      <Row2>
        <TextField label="Gateway IP" mono inputMode="decimal" value={v.ip} onChange={set('ip')} placeholder="10.0.20.1" />
        <TextField label="Netmask" mono inputMode="decimal" value={v.netmask} onChange={set('netmask')} />
      </Row2>
      {main ? null : (
        <>
          <TextField
            label="VLAN ID"
            inputMode="numeric"
            value={v.vlanId}
            onChange={set('vlanId')}
            hint="2 to 4094. Tag this ID on switch ports to carry the network."
          />
          <SelectField label="Internet access" value={v.wanAccess} options={ACCESS} onChange={set('wanAccess')} />
        </>
      )}
      <SwitchRow
        label="Isolate clients"
        hint="Devices on this network can’t reach each other"
        checked={v.isolate}
        onChange={set('isolate')}
      />
      <DhcpFields v={v} set={set} />
    </Sheet>
  );
}

function DhcpFields({
  v,
  set,
}: {
  v: NetworkFormValues;
  set: <K extends keyof NetworkFormValues>(k: K) => (value: NetworkFormValues[K]) => void;
}) {
  const leases = LEASES.some(([k]) => k === v.leaseTime) ? LEASES : ([[v.leaseTime, v.leaseTime], ...LEASES] as [string, string][]);
  return (
    <>
      <h3>DHCP</h3>
      <SwitchRow label="Hand out addresses" checked={v.dhcp} onChange={set('dhcp')} />
      <Row2>
        <TextField label="First address" mono inputMode="decimal" value={v.dhcpStart} onChange={set('dhcpStart')} />
        <TextField label="Last address" mono inputMode="decimal" value={v.dhcpEnd} onChange={set('dhcpEnd')} />
      </Row2>
      <SelectField label="Lease time" value={v.leaseTime} options={leases} onChange={set('leaseTime')} />
      <Row2>
        <TextField label="DNS server 1" mono inputMode="decimal" value={v.dns1} onChange={set('dns1')} placeholder="Router" />
        <TextField label="DNS server 2" mono inputMode="decimal" value={v.dns2} onChange={set('dns2')} placeholder="None" />
      </Row2>
    </>
  );
}

interface ReservationProps {
  reservation: Reservation | 'new' | null;
  networks: Network[];
  reserved: Reservation[];
  onClose: () => void;
  onRemove: (r: Reservation) => void;
}

function ReservationSheet(props: ReservationProps) {
  if (props.reservation === null) return null;
  return <ReservationForm key={props.reservation === 'new' ? 'new' : props.reservation.mac} {...props} />;
}

function ReservationForm({ reservation, networks, reserved, onClose, onRemove }: ReservationProps) {
  const r = reservation === 'new' ? null : reservation;
  const clients = useClients().data ?? [];
  const [form, setForm] = useState({ mac: r?.mac ?? '', ip: r?.ip ?? '', name: r?.name ?? '' });
  const save = useWrite(async () => {
    const mac = form.mac.trim().toUpperCase();
    if (!isMac(mac)) throw new Error('MAC address should look like AA:BB:CC:DD:EE:FF.');
    if (!isIpv4(form.ip)) throw new Error('Enter a valid IP address.');
    // keep the network the router already filed this under unless the IP moved
    const net = r && form.ip === r.ip ? r.network : networks.find((n) => inSubnet(form.ip, n.ip, n.netmask))?.id;
    if (!net) throw new Error('That IP isn’t in any of your networks.');
    await api.networks.reserve({ mac, ip: form.ip, name: form.name, network: net }, Boolean(r));
  }, [['networks-page'], ['reservations']]);
  const known = clients.filter((c) => !reserved.some((x) => x.mac === c.mac));
  const { toast } = useFeedback();

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={r ? `Reserved for ${r.name || r.mac}` : 'Reserve an IP address'}
      sub="The device always gets this address from DHCP"
      save={r ? 'Save' : 'Reserve'}
      danger={r ? { label: 'Remove reservation', onClick: () => onRemove(r) } : undefined}
      onSave={async () => {
        await save.mutateAsync(undefined);
        toast(`Reserved ${form.ip} for ${form.name || form.mac}`);
      }}
    >
      {r ? null : (
        <SelectField
          label="Device"
          value=""
          options={[
            ['', 'Enter a MAC address'],
            ...known.sort((a, b) => Number(b.online) - Number(a.online)).map((c) => [c.mac, `${c.name} (${c.ip})`] as const),
          ]}
          onChange={(mac) => {
            const c = known.find((x) => x.mac === mac);
            if (c) setForm({ mac: c.mac, ip: c.ip, name: c.name });
          }}
        />
      )}
      <TextField
        label="MAC address"
        mono
        value={form.mac}
        onChange={(mac) => setForm((f) => ({ ...f, mac }))}
        placeholder="AA:BB:CC:DD:EE:FF"
      />
      <TextField label="IP address" mono inputMode="decimal" value={form.ip} onChange={(ip) => setForm((f) => ({ ...f, ip }))} />
      <TextField label="Name" value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} placeholder="Optional" />
    </Sheet>
  );
}
