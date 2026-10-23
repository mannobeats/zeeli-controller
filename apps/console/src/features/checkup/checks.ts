import {
  type AdguardState,
  type Cidr,
  type Client,
  cidrOf,
  cidrText,
  inSubnet,
  type Network,
  overlaps,
  parseCidr,
  type RemoteAccess,
  type Reservation,
  type WifiEntry,
} from '@zeeli/router-api';

export type Severity = 'problem' | 'warning' | 'tip';

type WifiPatch = { isolate?: true; security?: 'sae-mixed' };

/** A change the checkup can make for you, once you confirm. */
export type Fix =
  | { type: 'wifi'; ids: string[]; patch: WifiPatch }
  | { type: 'remote'; key: 'enable_ssh' | 'enable_https' | 'enable_ping' };

export type Action =
  | { kind: 'fix'; label: string; confirm: string; done: string; fix: Fix }
  | { kind: 'open'; label: string; page: string };

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  why: string;
  action: Action;
}

/** Everything the checks read. `null` means the router couldn't say, and the checks that need it are skipped. */
export interface CheckupData {
  networks: Network[] | null;
  reservations: Reservation[] | null;
  clients: Client[] | null;
  /** Only with the Zeeli agent. */
  wifi: WifiEntry[] | null;
  /** The upstream network, when the WAN has a fixed address. */
  wan: Cidr | null;
  vpn: { label: string; cidr: Cidr }[];
  remote: RemoteAccess | null;
  adguard: AdguardState | null;
  /** The newer router firmware version, if there is one. */
  firmware: string | null;
}

const RANK: Record<Severity, number> = { problem: 0, warning: 1, tip: 2 };
const TAILSCALE = parseCidr('100.64.0.0/10') as Cidr;
const UPSTREAM = 'the upstream network';

const open = (page: string, label: string): Action => ({ kind: 'open', page, label });
const openNetworks = open('networks', 'Open Networks');
const num = (ip: string) => ip.split('.').reduce((x, o) => x * 256 + Number(o), 0);
const names = (list: string[]) => (list.length < 3 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
const addresses = (n: number) => `${n} reserved ${n === 1 ? 'address' : 'addresses'}`;
const isIot = (n: Network) => n.id === 'iot' || /iot|camera|cctv|thing/i.test(n.label);
const isGuest = (s: string) => /guest/i.test(s);
const inPool = (n: Network, ip: string) => num(ip) >= num(n.dhcpStart) && num(ip) <= num(n.dhcpEnd);

function iotReach(networks: Network[]): Finding[] {
  return networks
    .filter((n) => n.enabled && isIot(n) && n.wanAccess === 0)
    .map((n) => ({
      id: `iot-reach:${n.id}`,
      severity: 'problem',
      title: `${n.label} isn’t kept apart from your other networks`,
      why: 'A camera or smart plug that gets hacked there could reach the computers on your main network.',
      action: openNetworks,
    }));
}

function guestNetworks(networks: Network[]): Finding[] {
  return networks
    .filter((n) => n.enabled && (n.id === 'guest' || isGuest(n.label)) && !n.isolate)
    .map((n) => ({
      id: `guest-isolate:${n.id}`,
      severity: 'warning',
      title: `Guests on ${n.label} can see each other`,
      why: 'Without client isolation, one guest’s device can reach every other guest’s device.',
      action: openNetworks,
    }));
}

interface Group {
  key: string;
  ssid: string;
  own: boolean;
  ids: string[];
}

/** The per-band entries of one network (same name) as one row. */
function groups(list: WifiEntry[]): Group[] {
  const by = new Map<string, Group>();
  for (const w of list) {
    const key = `${w.owner}:${w.ssid}`;
    const g = by.get(key) ?? { key, ssid: w.ssid, own: w.owner === 'zeeli', ids: [] };
    g.ids.push(w.id);
    by.set(key, g);
  }
  return [...by.values()];
}

const fixWifi = (g: Group, patch: WifiPatch, confirm: string, label: string, done: string): Action =>
  g.own ? { kind: 'fix', label, confirm, done, fix: { type: 'wifi', ids: g.ids, patch } } : open('wifi', 'Open WiFi');

function guestWifi(wifi: WifiEntry[]): Finding[] {
  const bare = wifi.filter((w) => !w.disabled && !w.isolate && (w.role === 'guest' || isGuest(w.network) || isGuest(w.ssid)));
  return groups(bare).map((g) => ({
    id: `guest-wifi:${g.key}`,
    severity: 'warning',
    title: `Guest WiFi “${g.ssid}” has no client isolation`,
    why: 'Guests can see and reach each other’s phones and laptops.',
    action: fixWifi(g, { isolate: true }, `Isolate the devices on “${g.ssid}” from each other?`, 'Isolate guests', 'Guests are isolated'),
  }));
}

function wifiSecurity(wifi: WifiEntry[]): Finding[] {
  const on = wifi.filter((w) => !w.disabled);
  const noKey = groups(on.filter((w) => w.security === 'none' || !w.hasKey)).map(
    (g): Finding => ({
      id: `wifi-open:${g.key}`,
      severity: 'problem',
      title: `WiFi “${g.ssid}” has no password`,
      why: 'Anyone in range can join it and see what is on it.',
      action: open('wifi', 'Open WiFi'),
    }),
  );
  const old = groups(on.filter((w) => w.hasKey && /^psk/.test(w.security))).map(
    (g): Finding => ({
      id: `wifi-wpa2:${g.key}`,
      severity: 'tip',
      title: `WiFi “${g.ssid}” could use WPA3`,
      why: 'WPA2-only is easier to crack. WPA2/WPA3 keeps older devices working too.',
      action: fixWifi(g, { security: 'sae-mixed' }, `Let “${g.ssid}” use WPA2/WPA3?`, 'Allow WPA3', 'WPA3 is allowed'),
    }),
  );
  return [...noKey, ...old];
}

function overlapFindings(data: CheckupData, networks: Network[]): Finding[] {
  const mine = networks.filter((n) => n.enabled).map((n) => ({ label: n.label, cidr: cidrOf(n.ip, n.netmask), net: true }));
  const outside = [
    ...(data.wan ? [{ label: UPSTREAM, cidr: data.wan, net: false }] : []),
    ...data.vpn.map((v) => ({ ...v, net: false })),
    { label: 'Tailscale', cidr: TAILSCALE, net: false },
  ];
  const out: Finding[] = [];
  mine.forEach((a, i) => {
    for (const b of [...mine.slice(i + 1), ...outside].filter((x) => overlaps(a.cidr, x.cidr)))
      out.push({
        id: `overlap:${a.label}:${b.label}`,
        severity: b.net || b.label === UPSTREAM ? 'problem' : 'warning',
        title: `${a.label} overlaps ${b.label}`,
        why: `${cidrText(a.cidr)} and ${cidrText(b.cidr)} share addresses, so traffic can go to the wrong place.`,
        action: openNetworks,
      });
  });
  return out;
}

const poolFinding = (n: Network, severity: Severity, title: string, why: string): Finding => ({
  id: `pool:${n.id}`,
  severity,
  title,
  why,
  action: openNetworks,
});

function pools(networks: Network[], clients: Client[], reservations: Reservation[]): Finding[] {
  const out: Finding[] = [];
  for (const n of networks.filter((x) => x.enabled && x.dhcp)) {
    const size = num(n.dhcpEnd) - num(n.dhcpStart) + 1;
    if (!(size > 0)) continue;
    const reserved = new Set(reservations.filter((r) => r.network === n.id).map((r) => r.ip));
    const devices = clients.filter((c) => c.ip && inSubnet(c.ip, n.ip, n.netmask) && !reserved.has(c.ip)).length;
    if (devices > size)
      out.push(
        poolFinding(
          n,
          'problem',
          `${n.label} has more devices than addresses`,
          `${devices} devices were seen, but its DHCP pool holds only ${size}.`,
        ),
      );
    else if (devices > size * 0.8)
      out.push(
        poolFinding(
          n,
          'warning',
          `${n.label} is almost out of addresses`,
          `${devices} of ${size} DHCP addresses are in use. New devices soon won’t get one.`,
        ),
      );
  }
  return out;
}

function reservationFindings(networks: Network[], reservations: Reservation[]): Finding[] {
  const out: Finding[] = [];
  for (const n of networks) {
    const mine = reservations.filter((r) => r.network === n.id);
    const outside = mine.filter((r) => !inSubnet(r.ip, n.ip, n.netmask));
    const pooled = mine.filter((r) => n.dhcp && inSubnet(r.ip, n.ip, n.netmask) && inPool(n, r.ip));
    if (outside.length)
      out.push({
        id: `reserve-outside:${n.id}`,
        severity: 'warning',
        title: `${addresses(outside.length)} on ${n.label} can’t work`,
        why: `${names(outside.map((r) => r.name || r.ip))} ${outside.length === 1 ? 'is' : 'are'} outside the network, so the device can never use ${outside.length === 1 ? 'it' : 'them'}.`,
        action: open('dhcp', 'Open DHCP'),
      });
    if (pooled.length)
      out.push({
        id: `reserve-pool:${n.id}`,
        severity: 'tip',
        title: `${addresses(pooled.length)} on ${n.label} sit inside the DHCP pool`,
        why: 'The router may hand such an address to another device first. Keep reservations outside the pool.',
        action: open('dhcp', 'Open DHCP'),
      });
  }
  return out;
}

/** Needs the agent's WiFi list: without it a network may be on a WiFi network we can't see. */
function unreachable(networks: Network[], wifi: WifiEntry[]): Finding[] {
  return networks
    .filter((n) => n.enabled && n.id !== 'main' && !n.ports.length && !wifi.some((w) => !w.disabled && w.network === n.id))
    .map((n) => ({
      id: `no-carrier:${n.id}`,
      severity: 'warning',
      title: `${n.label} isn’t on any WiFi or port`,
      why: 'Nothing can join it. Put it on a WiFi network or an Ethernet port, or turn it off.',
      action: openNetworks,
    }));
}

function remoteFindings(r: RemoteAccess): Finding[] {
  // a list of allowed addresses already narrows who can try
  if (r.enable_whitelist) return [];
  const risk = (
    key: 'enable_ssh' | 'enable_https' | 'enable_ping',
    severity: Severity,
    title: string,
    why: string,
    label: string,
    done: string,
  ): Finding => ({
    id: `remote:${key}`,
    severity,
    title,
    why,
    action: {
      kind: 'fix',
      label,
      confirm: `${label}? It stops working from outside your home until you turn it back on.`,
      done,
      fix: { type: 'remote', key },
    },
  });
  const out: Finding[] = [];
  if (r.enable_ssh)
    out.push(
      risk(
        'enable_ssh',
        'problem',
        'SSH is open to the internet',
        'Anyone online can try to sign in to the router.',
        'Turn off remote SSH',
        'Remote SSH is off',
      ),
    );
  if (r.enable_https)
    out.push(
      risk(
        'enable_https',
        'warning',
        'The admin page is open to the internet',
        'Anyone online can reach the router’s sign-in page.',
        'Turn off remote admin',
        'Remote admin is off',
      ),
    );
  if (r.enable_ping)
    out.push(
      risk(
        'enable_ping',
        'tip',
        'The router answers pings from the internet',
        'That makes it easier to find. A minor risk.',
        'Stop answering pings',
        'Pings from the internet are ignored',
      ),
    );
  return out;
}

const adguardScope = (a: AdguardState | null): Finding[] =>
  a?.enabled && !a.dns_enabled
    ? [
        {
          id: 'adguard-scope',
          severity: 'tip',
          title: 'AdGuard Home only filters some devices',
          why: '“Handle DNS for every device” is off, so only devices pointed at it by hand are filtered.',
          action: open('adguard', 'Open AdGuard Home'),
        },
      ]
    : [];

const firmwareUpdate = (v: string | null): Finding[] =>
  v
    ? [
        {
          id: 'firmware',
          severity: 'warning',
          title: `Router firmware ${v} is available`,
          why: 'Updates carry security fixes.',
          action: open('firmware', 'Open Firmware'),
        },
      ]
    : [];

/** All the findings, most serious first, and the checks that couldn't run for lack of data. */
export function runCheckup(data: CheckupData): { findings: Finding[]; skipped: string[] } {
  const { networks, reservations, clients, wifi, remote } = data;
  const skipped: string[] = [];
  const have = (v: unknown, what: string) => {
    if (!v) skipped.push(what);
    return Boolean(v);
  };
  const out: Finding[] = [];
  if (have(networks, 'Network isolation, overlaps and DHCP')) {
    const n = networks as Network[];
    out.push(...iotReach(n), ...guestNetworks(n), ...overlapFindings(data, n));
    if (have(reservations, 'Reserved addresses')) out.push(...reservationFindings(n, reservations as Reservation[]));
    if (have(clients, 'DHCP pool size')) out.push(...pools(n, clients as Client[], reservations ?? []));
    if (have(wifi, 'Networks on no WiFi or port')) out.push(...unreachable(n, wifi as WifiEntry[]));
  }
  if (have(wifi, 'WiFi security and guest WiFi isolation'))
    out.push(...guestWifi(wifi as WifiEntry[]), ...wifiSecurity(wifi as WifiEntry[]));
  if (have(remote, 'Remote access')) out.push(...remoteFindings(remote as RemoteAccess));
  out.push(...adguardScope(data.adguard), ...firmwareUpdate(data.firmware));
  return { findings: out.sort((a, b) => RANK[a.severity] - RANK[b.severity]), skipped: [...new Set(skipped)] };
}

/** "3 problems, 2 warnings", or an empty string when there is nothing. */
export function summary(list: Finding[]): string {
  const count = (s: Severity, one: string, many = `${one}s`) => {
    const c = list.filter((f) => f.severity === s).length;
    return c ? [`${c} ${c === 1 ? one : many}`] : [];
  };
  return [...count('problem', 'problem'), ...count('warning', 'warning'), ...count('tip', 'tip')].join(', ');
}
