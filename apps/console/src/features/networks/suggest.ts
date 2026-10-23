import {
  type Cidr,
  cidrOf,
  cidrText,
  inSubnet,
  ipToInt,
  isIpv4,
  lastHost,
  maskToPrefix,
  type Network,
  nthAddress,
  overlaps,
  parseCidr,
  type Reservation,
  type WanAccess,
} from '@zeeli/router-api';

/** An address range something else already uses, with what to call it in a message. */
export interface Taken {
  label: string;
  cidr: Cidr;
}

/** Tailscale hands out addresses from here, whatever the router's own networks are. */
export const TAILSCALE: Taken = { label: 'Tailscale', cidr: { network: '100.64.0.0', prefix: 10 } };

/** Subnet sizes in the picker. */
export const SIZES = [22, 23, 24, 25, 26, 27] as const;
export const sizeText = (prefix: number, hosts: number) => `/${prefix} · up to ${hosts} devices`;

export type PresetId = 'home' | 'guest' | 'iot' | 'cameras' | 'kids' | 'lab';
export interface Preset {
  id: PresetId;
  label: string;
  hint: string;
  wanAccess: WanAccess;
  isolate: boolean;
  leaseTime: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'home',
    label: 'Home',
    hint: 'Trusted devices. Internet and the upstream network.',
    wanAccess: 0,
    isolate: false,
    leaseTime: '12h',
  },
  {
    id: 'guest',
    label: 'Guest',
    hint: 'Visitors. Internet only, devices can’t reach each other.',
    wanAccess: 1,
    isolate: true,
    leaseTime: '1h',
  },
  {
    id: 'iot',
    label: 'IoT',
    hint: 'Smart-home gear. Internet only, kept off your upstream network.',
    wanAccess: 1,
    isolate: false,
    leaseTime: '24h',
  },
  {
    id: 'cameras',
    label: 'Cameras',
    hint: 'Internet only, kept off your upstream network.',
    wanAccess: 1,
    isolate: false,
    leaseTime: '24h',
  },
  {
    id: 'kids',
    label: 'Kids',
    hint: 'Internet only. Set content filtering per group in AdGuard.',
    wanAccess: 1,
    isolate: false,
    leaseTime: '12h',
  },
  { id: 'lab', label: 'Lab', hint: 'Tinkering. Full access.', wanAccess: 0, isolate: false, leaseTime: '12h' },
];

/** The family a new network's addresses come from: 10.0.N.1 when the router lives in 10.x, else 192.168.N.1. */
export const addressFamily = (networks: Pick<Network, 'ip'>[]) => (networks.some((n) => n.ip.startsWith('10.')) ? '10.0' : '192.168');

/** The first number from `from` that `ok` accepts, or null. */
const firstFree = (from: number, to: number, ok: (n: number) => boolean) => {
  for (let n = from; n <= to; n++) if (ok(n)) return n;
  return null;
};

export interface Suggestion {
  vlanId: number;
  ip: string;
}

/** VLAN N goes with {family}.N.1: the first N whose VLAN ID and subnet nobody uses. */
export function suggest(family: string, prefix: number, usedVlans: ReadonlySet<number>, taken: Taken[], from = 10): Suggestion | null {
  const subnetFree = (n: number) => !taken.some((t) => overlaps(cidrOf(`${family}.${n}.1`, prefix), t.cidr));
  const n =
    firstFree(from, 254, (x) => !usedVlans.has(x) && subnetFree(x)) ?? firstFree(2, from - 1, (x) => !usedVlans.has(x) && subnetFree(x));
  return n === null ? null : { vlanId: n, ip: `${family}.${n}.1` };
}

/** "Guest", or "Guest 2" when taken. */
export function uniqueName(base: string, names: string[]) {
  const lower = names.map((n) => n.toLowerCase());
  const free = (n: string) => !lower.includes(n.toLowerCase());
  return free(base) ? base : (Array.from({ length: 98 }, (_, i) => `${base} ${i + 2}`).find(free) ?? base);
}

/** First and last address to hand out: the .6 through the last host, like UniFi. Null when the gateway isn't an address. */
export function defaultRange(ip: string, prefix: number): { start: string; end: string } | null {
  if (!isIpv4(ip) || prefix > 29) return null;
  const c = cidrOf(ip, prefix);
  return { start: nthAddress(c, 6), end: lastHost(c) };
}

export interface FormFacts {
  label: string;
  ip: string;
  netmask: string;
  vlanId: string;
  dhcp: boolean;
  dhcpStart: string;
  dhcpEnd: string;
}

export interface Facts {
  networks: Network[];
  /** WAN, VPN servers and Tailscale. */
  taken: Taken[];
  /** VLAN ID -> who uses it, from port profiles' networks as well. */
  vlans: Map<number, string>;
  reservations: Reservation[];
  /** The network being edited, which doesn't conflict with itself. */
  editing: Network | null;
}

export type ConflictField = 'name' | 'vlan' | 'subnet' | 'gateway' | 'range' | 'reserved';
export type Conflicts = Partial<Record<ConflictField, string>>;

function subnetConflict(v: FormFacts, others: Taken[]) {
  const cidr = cidrOf(v.ip, v.netmask);
  const hit = others.find((o) => overlaps(cidr, o.cidr));
  return hit ? `${cidrText(cidr)} overlaps ${hit.label} (${cidrText(hit.cidr)}).` : undefined;
}

function gatewayConflict(v: FormFacts) {
  const c = cidrOf(v.ip, v.netmask);
  const prefix = maskToPrefix(v.netmask);
  if (prefix >= 31) return undefined;
  if (v.ip === c.network) return 'The gateway can’t be the network’s first address.';
  return v.ip === nthAddress(c, 2 ** (32 - prefix) - 1) ? 'The gateway can’t be the broadcast address.' : undefined;
}

function rangeConflict(v: FormFacts) {
  if (!(v.dhcp && isIpv4(v.dhcpStart) && isIpv4(v.dhcpEnd))) return undefined;
  if (!(inSubnet(v.dhcpStart, v.ip, v.netmask) && inSubnet(v.dhcpEnd, v.ip, v.netmask)))
    return `The range has to stay inside ${cidrText(cidrOf(v.ip, v.netmask))}.`;
  if (ipToInt(v.dhcpStart) > ipToInt(v.dhcpEnd)) return 'The first address comes after the last one.';
  const gw = ipToInt(v.ip);
  return gw >= ipToInt(v.dhcpStart) && gw <= ipToInt(v.dhcpEnd) ? 'The range includes the gateway address.' : undefined;
}

function reservedConflict(v: FormFacts, reservations: Reservation[]) {
  if (!(v.dhcp && isIpv4(v.dhcpStart) && isIpv4(v.dhcpEnd))) return undefined;
  const inside = reservations.filter(
    (r) => inSubnet(r.ip, v.ip, v.netmask) && ipToInt(r.ip) >= ipToInt(v.dhcpStart) && ipToInt(r.ip) <= ipToInt(v.dhcpEnd),
  );
  return inside.length ? `Reserved addresses sit in this range: ${inside.map((r) => r.ip).join(', ')}.` : undefined;
}

/** What's wrong with the form as typed, per field. Empty when it's fine. */
export function conflicts(v: FormFacts, facts: Facts): Conflicts {
  const out: Conflicts = {};
  const self = facts.editing?.id;
  const nameClash = facts.networks.some((n) => n.id !== self && n.label.trim().toLowerCase() === v.label.trim().toLowerCase());
  if (v.label.trim() && nameClash) out.name = 'Another network already has this name.';
  const vlan = Number(v.vlanId);
  const user = v.vlanId && facts.vlans.get(vlan);
  const mine = self !== undefined && facts.networks.find((n) => n.vlanId === vlan)?.id === self;
  if (user && !mine) out.vlan = `VLAN ${vlan} is already used by ${user}.`;
  if (isIpv4(v.ip) && isIpv4(v.netmask)) {
    const others: Taken[] = [
      ...facts.networks.filter((n) => n.id !== self).map((n) => ({ label: n.label, cidr: cidrOf(n.ip, n.netmask) })),
      ...facts.taken,
    ];
    const more: [ConflictField, string | undefined][] = [
      ['subnet', subnetConflict(v, others)],
      ['gateway', gatewayConflict(v)],
      ['range', rangeConflict(v)],
      ['reserved', reservedConflict(v, facts.reservations)],
    ];
    for (const [k, text] of more) if (text) out[k] = text;
  }
  return out;
}

/** Everything except a reservation notice stops a new network. */
export const blocking = (c: Conflicts) => Object.entries(c).find(([k]) => k !== 'reserved')?.[1];

/** Cidr text for a router-side address that may or may not carry a prefix: a bare address counts as its /24. */
export function takenFrom(label: string, value: string | undefined, bareAs = 24): Taken | null {
  const c = value ? parseCidr(value) : null;
  if (!c) return null;
  return { label, cidr: value?.includes('/') ? c : cidrOf(c.network, bareAs) };
}

/** An OpenVPN server's subnet and mask. */
export const takenFromMask = (label: string, subnet: string | undefined, mask: string | undefined): Taken | null =>
  subnet && mask && isIpv4(subnet) && isIpv4(mask) ? { label, cidr: cidrOf(subnet, maskToPrefix(mask)) } : null;

const ACCESS_TEXT: Record<WanAccess, string> = {
  0: 'internet and the upstream network',
  1: 'internet only',
  2: 'local only, no internet',
};

export interface PlanFacts extends FormFacts {
  isolate: boolean;
  wanAccess: WanAccess;
  dnsText: string;
}

function rangeText(v: FormFacts) {
  if (!v.dhcp) return 'with DHCP off';
  const [a, b] = [v.dhcpStart.split('.'), v.dhcpEnd.split('.')];
  const short = a.slice(0, 3).join('.') === b.slice(0, 3).join('.');
  return `with addresses ${short ? `.${a[3]}–.${b[3]}` : `${v.dhcpStart}–${v.dhcpEnd}`} handed out`;
}

/** "Creates VLAN 30, 10.0.30.0/24 with addresses .6–.254 handed out, isolated, internet only." */
export function planText(v: PlanFacts): string {
  const subnet = cidrText(cidrOf(v.ip, v.netmask));
  const parts = [
    `Creates VLAN ${v.vlanId}, ${subnet} ${rangeText(v)}`,
    ...(v.isolate ? ['isolated'] : []),
    ACCESS_TEXT[v.wanAccess],
    ...(v.dnsText ? [v.dnsText] : []),
  ];
  return `${parts.join(', ')}.`;
}

/** The prefix of a mask, tolerating the blank one a half-typed form has. */
export const prefixOf = (netmask: string) => (isIpv4(netmask) ? maskToPrefix(netmask) : 24);

/** Which of the address fields the person hasn't touched, so the form may still fill them. */
export interface Auto {
  /** Gateway IP. */
  ip: boolean;
  vlan: boolean;
  /** DHCP first and last address. */
  range: boolean;
  name: boolean;
}

export interface AddressFields {
  ip: string;
  netmask: string;
  vlanId: string;
  dhcpStart: string;
  dhcpEnd: string;
}

export interface Env {
  family: string;
  usedVlans: ReadonlySet<number>;
  taken: Taken[];
}

/** Fill the fields still on auto from the ones the person set: VLAN and gateway from what's free, then the DHCP range from those. */
export function autofill<T extends AddressFields>(v: T, auto: Auto, env: Env): T {
  const out = { ...v };
  const vlan = Number(v.vlanId);
  if (auto.ip && auto.vlan) {
    const s = suggest(env.family, prefixOf(v.netmask), env.usedVlans, env.taken);
    if (s) Object.assign(out, { vlanId: String(s.vlanId), ip: s.ip });
  } else if (auto.ip && Number.isInteger(vlan) && vlan >= 2 && vlan <= 254) {
    out.ip = `${env.family}.${vlan}.1`;
  }
  const range = auto.range ? defaultRange(out.ip, prefixOf(out.netmask)) : null;
  if (range) Object.assign(out, { dhcpStart: range.start, dhcpEnd: range.end });
  return out;
}
