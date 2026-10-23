import { cidrOf, hostCount, type Network, type NetworkInput, prefixToMask, type Reservation, type WanAccess } from '@zeeli/router-api';
import { type ReactNode, useMemo, useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { useFeedback } from '../../ui/feedback.tsx';
import { Row2, Segmented, SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { DNS_NAMES, type DnsChoice, formValues, type NetworkFormValues, toNetworkInput } from './form.ts';
import { NextSteps } from './NextSteps.tsx';
import {
  type Auto,
  addressFamily,
  autofill,
  blocking,
  type ConflictField,
  type Conflicts,
  conflicts,
  type Env,
  PRESETS,
  type PresetId,
  planText,
  prefixOf,
  SIZES,
  sizeText,
  TAILSCALE,
  uniqueName,
} from './suggest.ts';
import { useTaken } from './useTaken.ts';

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
const DNS_OPTIONS = (Object.keys(DNS_NAMES) as DnsChoice[]).map((k) => [k, DNS_NAMES[k]] as const);

interface Props {
  network: Network | 'new' | null;
  networks: Network[];
  reservations: Reservation[];
  onClose: () => void;
}

export function NetworkSheet({ network, ...rest }: Props) {
  if (network === null) return null;
  const n = network === 'new' ? null : network;
  return <NetworkForm key={n?.id ?? 'new'} network={n} {...rest} />;
}

function sheetSub(network: Network | null) {
  if (!network) return 'A separate subnet on its own VLAN';
  return network.id === 'main' ? 'Your main network. Changing its IP moves the router’s own address.' : undefined;
}

/** What the form shows and changes. Fields still on auto are filled from the others, never stored. */
interface Ctl {
  v: NetworkFormValues;
  found: Conflicts;
  isNew: boolean;
  main: boolean;
  /** Change fields, and say which auto-filled ones the person has now taken over. */
  edit: (patch: Partial<NetworkFormValues>, taken?: Partial<Auto>) => void;
}

const dnsLabel = (v: NetworkFormValues) =>
  v.dnsChoice === 'router' ? '' : v.dnsChoice === 'custom' ? 'custom DNS' : `DNS from ${DNS_NAMES[v.dnsChoice].split(' (')[0]}`;

function useNetworkForm({ network, networks, reservations }: Pick<Props, 'networks' | 'reservations'> & { network: Network | null }) {
  const taken = useTaken(networks).data;
  const env = useMemo<Env>(() => {
    const own = networks.map((n) => ({ label: n.label, cidr: cidrOf(n.ip, n.netmask) }));
    const vlans = new Set(taken ? taken.vlans.keys() : networks.flatMap((n) => n.vlanId ?? []));
    return { family: addressFamily(networks), usedVlans: vlans, taken: [...own, ...(taken?.taken ?? [TAILSCALE])] };
  }, [networks, taken]);
  const [preset, setPreset] = useState<PresetId>('home');
  const [stored, setStored] = useState(() => {
    const p = PRESETS[0];
    return network
      ? formValues(network)
      : {
          ...formValues(null),
          label: uniqueName(
            p?.label ?? '',
            networks.map((n) => n.label),
          ),
        };
  });
  const [auto, setAuto] = useState<Auto>({ ip: !network, vlan: !network, range: !network, name: !network });
  const v = autofill(stored, auto, env);
  const edit: Ctl['edit'] = (patch, takenOver) => {
    setStored({ ...v, ...patch });
    if (takenOver) setAuto((a) => ({ ...a, ...takenOver }));
  };
  const found = conflicts(v, {
    networks,
    taken: taken?.taken ?? [TAILSCALE],
    vlans: taken?.vlans ?? new Map(networks.flatMap((n) => (n.vlanId ? [[n.vlanId, n.label] as const] : []))),
    reservations,
    editing: network,
  });
  function pickPreset(id: PresetId) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    const label = auto.name
      ? uniqueName(
          p.label,
          networks.map((n) => n.label),
        )
      : v.label;
    setStored({ ...v, label, wanAccess: p.wanAccess, isolate: p.isolate, leaseTime: p.leaseTime });
  }
  return { v, found, edit, preset, pickPreset };
}

function NetworkForm({ network, networks, reservations, onClose }: Omit<Props, 'network'> & { network: Network | null }) {
  const { toast, confirm } = useFeedback();
  const main = network?.id === 'main';
  const fixed = network?.fixed ?? false;
  const { v, found, edit, preset, pickPreset } = useNetworkForm({ network, networks, reservations });
  const [created, setCreated] = useState<string | null>(null);
  const save = useWrite((input: NetworkInput) => api.networks.save(input, network ?? undefined), [['networks-page'], ['networks']]);
  const remove = useWrite(() => api.networks.remove(network?.id ?? ''), [['networks-page'], ['networks']]);

  async function submit() {
    const input = toNetworkInput(v, network);
    const problem = network ? undefined : blocking(found);
    if (problem) throw new Error(problem);
    const ok = network ? await confirmMove(main ? network : null) : await confirmPlan();
    if (!ok) return false;
    await save.mutateAsync(input);
    toast(network ? `Saved ${input.label || network.label}` : `Created ${input.label}`);
    if (network) return;
    setCreated(input.label);
    return false;
  }

  const confirmPlan = () =>
    confirm({
      title: `Create ${v.label.trim()}?`,
      body: planText({ ...v, dnsText: dnsLabel(v) }),
      confirm: 'Create network',
      danger: false,
    });

  const confirmMove = async (from: Network | null) =>
    !from ||
    v.ip === from.ip ||
    (await confirm({
      title: 'Move the router to a new address?',
      body: `The router moves from ${from.ip} to ${v.ip}. Devices reconnect, and you’ll open this console at the new address.`,
      confirm: 'Change address',
      danger: false,
    }));

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
      onClose();
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  if (created) return <NextSteps name={created} onClose={onClose} />;
  const c: Ctl = { v, found, edit, isNew: !network, main };
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={network ? network.label : 'New network'}
      sub={sheetSub(network)}
      save={network ? 'Save' : 'Create network'}
      danger={network && !fixed ? { label: 'Delete network', onClick: deleteNetwork } : undefined}
      onSave={submit}
    >
      {network ? null : <PresetPicker preset={preset} onPick={pickPreset} />}
      {fixed ? null : (
        <TextField
          label="Name"
          value={v.label}
          onChange={(label) => edit({ label }, { name: false })}
          placeholder="Cameras"
          required
          hint={<Problem text={found.name} />}
        />
      )}
      {fixed && !main ? <SwitchRow label="Network on" checked={v.enabled} onChange={(enabled) => edit({ enabled })} /> : null}
      <SubnetFields c={c} />
      <details className="adv" open={Boolean(network)}>
        <summary>Advanced</summary>
        <div className="adv-body">
          <AccessFields c={c} />
          <DhcpFields c={c} />
          <DnsFields c={c} />
        </div>
      </details>
    </Sheet>
  );
}

function Problem({ text }: { text: string | undefined }) {
  return text ? <span className="form-error">{text}</span> : null;
}

const hintOr = (text: string | undefined, fallback: ReactNode) => (text ? <Problem text={text} /> : fallback);

function PresetPicker({ preset, onPick }: { preset: PresetId; onPick: (id: PresetId) => void }) {
  const p = PRESETS.find((x) => x.id === preset);
  return (
    <>
      <Segmented label="Purpose" value={preset} options={PRESETS.map((x) => [x.id, x.label] as const)} onChange={onPick} />
      <p className="page-note">
        {p?.hint}
        {preset === 'kids' ? (
          <>
            {' '}
            <a href="#adguard">AdGuard → Devices</a>
          </>
        ) : null}
      </p>
    </>
  );
}

function SubnetFields({ c }: { c: Ctl }) {
  const { v, found, edit, main } = c;
  const prefix = prefixOf(v.netmask);
  const sizes: number[] = SIZES.includes(prefix as (typeof SIZES)[number]) ? [...SIZES] : [prefix, ...SIZES].sort((a, b) => a - b);
  return (
    <>
      <Row2>
        <TextField
          label="Gateway IP"
          mono
          inputMode="decimal"
          value={v.ip}
          onChange={(ip) => edit({ ip }, { ip: false })}
          placeholder="10.0.20.1"
          hint={hintOr(found.subnet ?? found.gateway, undefined)}
        />
        <SelectField
          label="Size"
          value={prefix}
          options={sizes.map((p) => [p, sizeText(p, hostCount(p))] as const)}
          onChange={(p) => edit({ netmask: prefixToMask(p) })}
        />
      </Row2>
      {main ? null : (
        <TextField
          label="VLAN ID"
          inputMode="numeric"
          value={v.vlanId}
          onChange={(vlanId) => edit({ vlanId }, { vlan: false })}
          hint={hintOr(found.vlan, '2 to 4094. Tag this ID on switch ports to carry the network.')}
        />
      )}
    </>
  );
}

function AccessFields({ c }: { c: Ctl }) {
  const { v, edit, main } = c;
  return (
    <>
      {main ? null : (
        <SelectField label="Internet access" value={v.wanAccess} options={ACCESS} onChange={(wanAccess) => edit({ wanAccess })} />
      )}
      <SwitchRow
        label="Isolate clients"
        hint="Devices on this network can’t reach each other"
        checked={v.isolate}
        onChange={(isolate) => edit({ isolate })}
      />
    </>
  );
}

function DhcpFields({ c }: { c: Ctl }) {
  const { v, found, edit } = c;
  const leases = LEASES.some(([k]) => k === v.leaseTime) ? LEASES : ([[v.leaseTime, v.leaseTime], ...LEASES] as [string, string][]);
  const range = (k: ConflictField) => hintOr(found[k], undefined);
  return (
    <>
      <h3>DHCP</h3>
      <SwitchRow label="Hand out addresses" checked={v.dhcp} onChange={(dhcp) => edit({ dhcp })} />
      <Row2>
        <TextField
          label="First address"
          mono
          inputMode="decimal"
          value={v.dhcpStart}
          onChange={(dhcpStart) => edit({ dhcpStart }, { range: false })}
        />
        <TextField
          label="Last address"
          mono
          inputMode="decimal"
          value={v.dhcpEnd}
          onChange={(dhcpEnd) => edit({ dhcpEnd }, { range: false })}
        />
      </Row2>
      {range('range')}
      {range('reserved')}
      <SelectField label="Lease time" value={v.leaseTime} options={leases} onChange={(leaseTime) => edit({ leaseTime })} />
    </>
  );
}

function DnsFields({ c }: { c: Ctl }) {
  const { v, edit } = c;
  return (
    <>
      <SelectField label="DNS" value={v.dnsChoice} options={DNS_OPTIONS} onChange={(dnsChoice) => edit({ dnsChoice })} />
      {v.dnsChoice === 'custom' ? (
        <Row2>
          <TextField
            label="DNS server 1"
            mono
            inputMode="decimal"
            value={v.dns1}
            onChange={(dns1) => edit({ dns1 })}
            placeholder="Router"
          />
          <TextField label="DNS server 2" mono inputMode="decimal" value={v.dns2} onChange={(dns2) => edit({ dns2 })} placeholder="None" />
        </Row2>
      ) : null}
    </>
  );
}
