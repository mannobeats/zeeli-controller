// Demo answers for the agent's backup, firewall and ports areas, and for GL's mesh node
// methods (mesh is off on the router these shapes were studied on). Invented values only.
import type { AgentForwarding, AgentRule, AgentZone, PortProfile, PortsStatus, Snapshot, SnapshotChange } from '../domain/safety.ts';
import type { Handler } from './handlers.ts';
import { keep } from './more-handlers.ts';
import type { MockState } from './seed.ts';

type Args = Record<string, unknown>;

const err = (error: string) => ({ error });
const now = () => Math.floor(Date.now() / 1000);
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const copy = <T>(v: T): T => structuredClone(v);

/* ---------- firewall ---------- */

interface Fw {
  zones: AgentZone[];
  forwardings: AgentForwarding[];
  rules: AgentRule[];
}
let seq = 100;

const zone = (
  name: string,
  input: AgentZone['input'],
  forward: AgentZone['forward'],
  networks: string[],
  extra: Partial<AgentZone> = {},
): AgentZone => ({
  name,
  input,
  output: 'ACCEPT',
  forward,
  masquerade: false,
  mssClamp: false,
  networks,
  owner: 'default',
  editable: true,
  ...extra,
});

const rule = (name: string, src: string, dest: string, fields: Partial<AgentRule> = {}): AgentRule => ({
  id: `cfg${(seq++).toString(16)}92bd`,
  index: 0,
  name,
  src,
  dest,
  proto: 'tcp udp',
  destPort: '',
  srcIp: '',
  destIp: '',
  target: 'ACCEPT',
  family: '',
  enabled: true,
  owner: 'custom',
  editable: true,
  ...fields,
});

const renumber = (rules: AgentRule[]) => {
  for (const [i, r] of rules.entries()) r.index = i;
};

function seedFw(): Fw {
  const rules = [
    rule('Allow-DHCP-Renew', 'wan', '', { proto: 'udp', destPort: '68', family: 'ipv4', owner: 'default' }),
    rule('Allow-Ping', 'wan', '', { proto: 'icmp', family: 'ipv4', owner: 'default' }),
    rule('Keep cameras off the internet', 'iot', 'wan', { proto: 'all', srcIp: '192.168.10.52', target: 'REJECT' }),
    rule('Allow-Tailscale', 'wan', '', { proto: 'udp', destPort: '41641', owner: 'service', editable: false }),
    rule('Block guests from the printer', 'guest', 'lan', { proto: 'all', destIp: '192.168.8.60', target: 'DROP' }),
    rule('Plex from the TV', 'lan', 'lan', { proto: 'tcp', destPort: '32400', destIp: '192.168.8.10' }),
  ];
  renumber(rules);
  return {
    zones: [
      zone('lan', 'ACCEPT', 'ACCEPT', ['lan']),
      zone('wan', 'DROP', 'REJECT', ['wan', 'wan6', 'secondwan'], { masquerade: true, mssClamp: true }),
      zone('guest', 'REJECT', 'REJECT', ['guest']),
      zone('iot', 'REJECT', 'REJECT', ['iot']),
      zone('tailscale0', 'ACCEPT', 'ACCEPT', [], { masquerade: true, mssClamp: true, owner: 'service', editable: false }),
    ],
    forwardings: [
      { id: 'cfgf1', src: 'lan', dest: 'wan', enabled: true, owner: 'default', editable: true },
      { id: 'cfgf2', src: 'guest', dest: 'wan', enabled: true, owner: 'default', editable: true },
      { id: 'cfgf3', src: 'iot', dest: 'wan', enabled: true, owner: 'default', editable: true },
      { id: 'lan_tailscale', src: 'lan', dest: 'tailscale0', enabled: true, owner: 'service', editable: false },
    ],
    rules,
  };
}

const fw = (s: MockState) => keep(s, 'safety-fw', seedFw);

/* ---------- snapshots ---------- */

interface Snap extends Snapshot {
  fw: Fw;
  /** Other settings files that differ from now, which the demo doesn't model. */
  others: SnapshotChange[];
}
const KEEP = 10;
const RELOADS: Record<string, string | null> = {
  network: 'network',
  wireless: 'network',
  dhcp: 'dnsmasq',
  firewall: 'firewall',
  system: 'system',
  dropbear: 'dropbear',
  zeeli: null,
};
const RELOAD_ORDER = ['network', 'dnsmasq', 'firewall', 'system', 'dropbear'];

function seedSnaps(): Snap[] {
  const old = seedFw();
  const before = copy(old);
  before.rules = before.rules.filter((r) => r.name !== 'Block guests from the printer' && r.name !== 'Plex from the TV');
  renumber(before.rules);
  const holiday = copy(old);
  const iot = holiday.zones.find((z) => z.name === 'iot');
  if (iot) iot.forward = 'ACCEPT';
  const t = now();
  const configs = ['dhcp', 'firewall', 'glconfig', 'network', 'system', 'wireless', 'zeeli'];
  return [
    { id: `s${t - 3 * 3600}`, time: t - 3 * 3600, reason: 'Before adding a firewall rule', size: 458_112, configs, fw: before, others: [] },
    {
      id: `s${t - 2 * 86_400}`,
      time: t - 2 * 86_400,
      reason: 'Before the holiday',
      size: 455_640,
      configs,
      fw: holiday,
      others: [
        { name: 'dhcp', change: 'changed', sections: [{ section: 'host nas-01', change: 'added', options: ['ip', 'mac', 'name'] }] },
      ],
    },
    {
      id: `s${t - 9 * 86_400}`,
      time: t - 9 * 86_400,
      reason: 'Before restoring a backup file',
      size: 449_880,
      configs: [...configs, 'kmwan'],
      fw: copy(old),
      others: [{ name: 'kmwan', change: 'changed', sections: [{ section: 'interface wan', change: 'changed', options: ['metric'] }] }],
    },
  ];
}
const snaps = (s: MockState) => keep(s, 'safety-snaps', seedSnaps);

const ruleKey = (r: AgentRule) => r.name;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The firewall file's difference between a copy and the live state, as the agent reports it (option names only). */
function fwDiff(old: Fw, cur: Fw): SnapshotChange | null {
  const sections: SnapshotChange['sections'] = [];
  const compare = <T extends object>(kind: string, a: T[], b: T[], key: (x: T) => string) => {
    for (const x of b) {
      const y = a.find((z) => key(z) === key(x));
      if (!y) sections.push({ section: `${kind} ${key(x)}`, change: 'added', options: [] });
      else {
        const opts = Object.keys(x).filter(
          (k) => !['id', 'index'].includes(k) && !same((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]),
        );
        if (opts.length) sections.push({ section: `${kind} ${key(x)}`, change: 'changed', options: opts.sort() });
      }
    }
    for (const y of a)
      if (!b.some((z) => key(z) === key(y))) sections.push({ section: `${kind} ${key(y)}`, change: 'removed', options: [] });
  };
  compare('zone', old.zones, cur.zones, (z) => z.name);
  compare('forwarding', old.forwardings, cur.forwardings, (f) => `${f.src}>${f.dest}`);
  compare('rule', old.rules, cur.rules, ruleKey);
  return sections.length ? { name: 'firewall', change: 'changed', sections } : null;
}

function changes(s: MockState, snap: Snap): SnapshotChange[] {
  const d = fwDiff(snap.fw, fw(s));
  return [...(d ? [d] : []), ...snap.others];
}

function snapshot(s: MockState, reason: string): Snap {
  const list = snaps(s);
  const t = now();
  const id = `s${t}-${list.length}-${hex(2)}`;
  const snap: Snap = {
    id,
    time: t,
    reason,
    size: 457_900,
    configs: ['dhcp', 'firewall', 'glconfig', 'network', 'system', 'wireless', 'zeeli'],
    fw: copy(fw(s)),
    others: [],
  };
  list.unshift(snap);
  list.splice(KEEP);
  return snap;
}

const strip = ({ fw: _f, others: _o, ...snap }: Snap): Snapshot => snap;

function restoreSnap(s: MockState, snap: Snap) {
  const diffs = changes(s, snap);
  if (!diffs.length)
    return { restored: [], reloaded: [], rebootNeeded: false, summary: 'The router already matches this snapshot.', undo: null };
  const undo = snapshot(s, `Before restoring the snapshot from ${snap.reason}`);
  const names = diffs.map((d) => d.name).sort();
  const wanted = new Set(names.map((n) => RELOADS[n]).filter((x): x is string => Boolean(x)));
  const reloaded = RELOAD_ORDER.filter((x) => wanted.has(x));
  const restart = names.filter((n) => !(n in RELOADS));
  const state = fw(s);
  Object.assign(state, copy(snap.fw));
  snap.others = [];
  let summary = `Restored ${names.join(', ')}.`;
  if (reloaded.length) summary += ` Reloaded ${reloaded.join(', ')} so the change is live now.`;
  if (restart.length)
    summary += ` ${restart.join(', ')} ${restart.length === 1 ? 'is' : 'are'} only read when the router starts, so restart it for that to take effect.`;
  return { restored: names, reloaded, rebootNeeded: restart.length > 0, summary, undo: undo.id };
}

/* ---------- confirm or roll back ---------- */

interface Pending {
  before: Fw;
  what: string;
}
const pending = (s: MockState) => keep(s, 'safety-pending', () => new Map<string, Pending>());
const finished = (s: MockState) => keep(s, 'safety-finished', () => new Map<string, { state: string; message: string }>());

/** Run a firewall write the way the agent does: snapshot, change, and hand back a token to confirm. */
function write(s: MockState, what: string, change: (f: Fw) => { error: string } | Record<string, unknown>) {
  if (pending(s).size) return err('A change is still waiting to be confirmed. Confirm or undo it first.');
  const f = fw(s);
  const staged = copy(f);
  const result = change(staged);
  if ('error' in result) return result;
  snapshot(s, `Before ${what}`);
  Object.assign(f, staged);
  renumber(f.rules);
  const token = hex(16);
  pending(s).set(token, { before: copy(snaps(s)[0]?.fw ?? f), what });
  return { ...result, token, seconds: 30, expires: now() + 30 };
}

const POLICIES = ['ACCEPT', 'REJECT', 'DROP'];
const validPorts = (v: string) =>
  v === '' || v.split(' ').every((p) => /^\d{1,5}(-\d{1,5})?$/.test(p) && p.split('-').every((n) => Number(n) >= 1 && Number(n) <= 65_535));
const validIp = (v: string) => v === '' || /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]{3,39})(\/\d{1,3})?$/i.test(v);

type Check = { arg: keyof AgentRule; ok: (v: string, zones: string[]) => boolean; msg: (v: string) => string };
const ZONE = (v: string, zones: string[]) => v === '' || v === '*' || zones.includes(v);
const RULE_CHECKS: Check[] = [
  { arg: 'name', ok: (v) => v.trim() !== '' && v.trim().length <= 64, msg: () => 'Give the rule a name of up to 64 characters.' },
  { arg: 'src', ok: ZONE, msg: (v) => `There’s no zone called ${v}.` },
  { arg: 'dest', ok: ZONE, msg: (v) => `There’s no zone called ${v}.` },
  {
    arg: 'proto',
    ok: (v) => ['tcp udp', 'tcp', 'udp', 'icmp', 'all'].includes(v),
    msg: () => 'The protocol must be TCP, UDP, both, ICMP or any.',
  },
  { arg: 'target', ok: (v) => POLICIES.includes(v), msg: () => 'The action must be allow, reject or drop.' },
  { arg: 'family', ok: (v) => ['', 'ipv4', 'ipv6'].includes(v), msg: () => 'The IP version must be IPv4, IPv6 or both.' },
  { arg: 'destPort', ok: validPorts, msg: () => 'Ports must be 1 to 65535: 443, 8000-8010 or 80 443.' },
  { arg: 'srcIp', ok: validIp, msg: () => 'The from address must be an IP address or network.' },
  { arg: 'destIp', ok: validIp, msg: () => 'The to address must be an IP address or network.' },
];

function checkRule(f: Fw, a: Args, base: Partial<AgentRule>): { error: string } | Partial<AgentRule> {
  const out: Record<string, unknown> = {};
  const zones = f.zones.map((z) => z.name);
  for (const c of RULE_CHECKS) {
    if (a[c.arg] === undefined) continue;
    const v = text(a[c.arg]);
    if (!c.ok(v, zones)) return err(c.msg(v));
    out[c.arg] = c.arg === 'name' ? v.trim() : v;
  }
  if (a.enabled !== undefined) out.enabled = Boolean(a.enabled);
  const merged = { ...base, ...out } as Partial<AgentRule>;
  if (merged.destPort && !/tcp|udp/.test(merged.proto ?? 'tcp udp')) return err('Ports only apply to TCP or UDP.');
  return out as Partial<AgentRule>;
}

function findRule(f: Fw, a: Args) {
  const r = f.rules.find((x) => x.id === a.id);
  if (!r) return err('That rule is gone. Reload the list.');
  if (!r.editable) return err('Rules made by router services are changed from that service.');
  if (a.current !== undefined && r.name !== a.current) return err('The firewall changed since you loaded it. Reload the list.');
  return r;
}

const NETWORKS = ['lan', 'wan', 'wan6', 'secondwan', 'wwan', 'guest', 'iot'];

function networkProblem(f: Fw, zone: AgentZone, n: string) {
  if (!NETWORKS.includes(n)) return `There’s no network called ${n}.`;
  const other = f.zones.find((x) => x.name !== zone.name && x.networks.includes(n));
  return other ? `${n} is already in the ${other.name} zone. Take it out of there first.` : undefined;
}

const firewall: Record<string, Handler> = {
  'zeeli:firewall.networks': (s) => ({
    networks: NETWORKS.map((name) => ({ name, zone: fw(s).zones.find((z) => z.networks.includes(name))?.name ?? null })),
  }),
  'zeeli:firewall.zones': (s) => ({ zones: fw(s).zones }),
  'zeeli:firewall.forwardings': (s) => ({ forwardings: fw(s).forwardings }),
  'zeeli:firewall.rules': (s) => ({ rules: fw(s).rules }),

  'zeeli:firewall.zone_update': (s, a) =>
    write(s, 'changing a firewall zone', (f) => {
      const z = f.zones.find((x) => x.name === a.name);
      if (!z) return err(`There’s no zone called ${a.name}.`);
      if (!z.editable) return err('Zones made by router services are changed from that service.');
      for (const k of ['input', 'output', 'forward'] as const)
        if (a[k] !== undefined) {
          if (!POLICIES.includes(text(a[k]))) return err('A zone’s traffic must be allowed, rejected or dropped.');
          z[k] = text(a[k]) as AgentZone['input'];
        }
      if (a.masquerade !== undefined) z.masquerade = Boolean(a.masquerade);
      if (a.mssClamp !== undefined) z.mssClamp = Boolean(a.mssClamp);
      if (!Array.isArray(a.networks)) return {};
      const nets = [...new Set(a.networks as string[])];
      const bad = nets.map((n) => networkProblem(f, z, n)).find(Boolean);
      if (bad) return err(bad);
      z.networks = nets;
      return {};
    }),

  'zeeli:firewall.forwarding_add': (s, a) =>
    write(s, 'adding a zone forwarding', (f) => {
      const names = f.zones.map((z) => z.name);
      if (!names.includes(text(a.src)) || !names.includes(text(a.dest))) return err('Pick two zones that exist.');
      if (a.src === a.dest) return err('A forwarding connects two different zones.');
      if (f.forwardings.some((x) => x.src === a.src && x.dest === a.dest)) return err('Those zones are already connected.');
      const id = `cfg${(seq++).toString(16)}`;
      f.forwardings.push({ id, src: text(a.src), dest: text(a.dest), enabled: true, owner: 'custom', editable: true });
      return { id };
    }),
  'zeeli:firewall.forwarding_remove': (s, a) =>
    write(s, 'removing a zone forwarding', (f) => {
      const x = f.forwardings.find((y) => y.id === a.id);
      if (!x) return err('That forwarding is gone. Reload the list.');
      if (!x.editable) return err('Forwardings made by router services are changed from that service.');
      f.forwardings = f.forwardings.filter((y) => y !== x);
      return {};
    }),

  'zeeli:firewall.rule_add': (s, a) =>
    write(s, 'adding a firewall rule', (f) => {
      if (a.name === undefined) return err('Give the rule a name of up to 64 characters.');
      const v = checkRule(f, { proto: 'tcp udp', src: '*', target: 'ACCEPT', enabled: true, ...a }, {});
      if ('error' in v) return v;
      const r = rule(v.name ?? '', v.src ?? '*', v.dest ?? '', v);
      f.rules.push(r);
      return { id: r.id };
    }),
  'zeeli:firewall.rule_update': (s, a) =>
    write(s, 'changing a firewall rule', (f) => {
      const r = findRule(f, a);
      if ('error' in r) return r;
      const v = checkRule(f, a, r);
      if ('error' in v) return v;
      Object.assign(r, v);
      return {};
    }),
  'zeeli:firewall.rule_enable': (s, a) =>
    write(s, `turning a firewall rule ${a.enabled ? 'on' : 'off'}`, (f) => {
      const r = findRule(f, a);
      if ('error' in r) return r;
      r.enabled = Boolean(a.enabled);
      return {};
    }),
  'zeeli:firewall.rule_delete': (s, a) =>
    write(s, 'deleting a firewall rule', (f) => {
      const r = findRule(f, a);
      if ('error' in r) return r;
      f.rules = f.rules.filter((x) => x !== r);
      return {};
    }),
  'zeeli:firewall.rule_move': (s, a) => {
    const to = Number(a.to);
    if (!Number.isInteger(to) || to < 0) return err('Pick where the rule goes.');
    const r0 = findRule(fw(s), a);
    if ('error' in r0) return r0;
    if (fw(s).rules.indexOf(r0) === Math.min(to, fw(s).rules.length - 1)) return { moved: false };
    return write(s, 'moving a firewall rule', (f) => {
      const r = findRule(f, a);
      if ('error' in r) return r;
      f.rules = f.rules.filter((x) => x !== r);
      f.rules.splice(Math.min(to, f.rules.length), 0, r);
      return { moved: true };
    });
  },

  'zeeli:firewall.confirm': (s, a) => {
    const token = text(a.token);
    if (!/^[0-9a-f]{16}$/.test(token)) return err('That isn’t a change token.');
    if (pending(s).delete(token)) {
      finished(s).set(token, { state: 'confirmed', message: 'Change kept.' });
      return { state: 'confirmed', message: 'Change kept.' };
    }
    return finished(s).get(token) ?? { state: 'unknown', message: 'The router has no record of that change.' };
  },
  'zeeli:firewall.revert': (s, a) => {
    const token = text(a.token);
    const p = pending(s).get(token);
    if (!p) return finished(s).get(token) ?? { state: 'unknown', message: 'The router has no record of that change.' };
    pending(s).delete(token);
    Object.assign(fw(s), copy(p.before));
    const done = { state: 'rolledBack', message: `The router undid ${p.what} because it wasn’t confirmed in time.` };
    finished(s).set(token, done);
    return done;
  },
  'zeeli:firewall.status': (s, a) => {
    const token = text(a.token);
    return pending(s).has(token)
      ? { state: 'pending', seconds: 30 }
      : (finished(s).get(token) ?? { state: 'unknown', message: 'The router has no record of that change.' });
  },
};

/* ---------- backup ---------- */

const ID = /^s\d+(-[0-9a-z]+)*$/;
const FILE_TOKEN = 'd3adb33f'.repeat(8);

const backup: Record<string, Handler> = {
  'zeeli:backup.list': (s) => ({ snapshots: snaps(s).map(strip), keep: KEEP }),
  'zeeli:backup.create': (s, a) => {
    const reason = text(a.reason).trim();
    if (!reason || reason.length > 80) return err('Say why you’re taking it, in up to 80 characters.');
    return strip(snapshot(s, reason));
  },
  'zeeli:backup.delete': (s, a) => {
    if (!ID.test(text(a.id))) return err('That isn’t a snapshot.');
    const list = snaps(s);
    const i = list.findIndex((x) => x.id === a.id);
    if (i < 0) return err('That snapshot is already gone.');
    list.splice(i, 1);
    return { id: a.id };
  },
  'zeeli:backup.restore': (s, a) => {
    if (!ID.test(text(a.id))) return err('That isn’t a snapshot.');
    const snap = snaps(s).find((x) => x.id === a.id);
    return snap ? restoreSnap(s, snap) : err('That snapshot is gone.');
  },
  'zeeli:backup.diff': (s, a) => {
    if (!ID.test(text(a.id))) return err('That isn’t a snapshot.');
    const snap = snaps(s).find((x) => x.id === a.id);
    return snap ? { files: changes(s, snap) } : err('That snapshot is gone.');
  },

  'zeeli:backup.download': () => ({ path: `/tmp/zeeli/backup-${now()}.tar.gz`, filename: `backup-${now()}.tar.gz`, size: 31_244 }),
  'zeeli:backup.prepare': (s) => {
    s.extra.set('safety-upload', true);
    return { path: '/tmp/zeeli/restore.tar.gz', maxBytes: 8_388_608 };
  },
  'zeeli:backup.inspect': (s) =>
    s.extra.get('safety-upload') ? { token: FILE_TOKEN, bytes: 31_244, files: 91, configs: 54 } : err('No backup file has been sent yet.'),
  'zeeli:backup.restore_file': (s, a) => {
    if (!s.extra.get('safety-upload')) return err('No backup file has been sent yet.');
    if (a.token !== FILE_TOKEN) return err('That isn’t the file you were shown. Choose it again.');
    s.extra.delete('safety-upload');
    return { restored: 91, rebootRequired: true, undo: snapshot(s, 'Before restoring a backup file').id };
  },
  'zeeli:backup.discard': (s) => {
    s.extra.delete('safety-upload');
    return {};
  },
};

/* ---------- ports ---------- */

const status = (s: MockState): PortsStatus => {
  // two cables in the switch: the chip can't say which port a device is behind, like the real one
  const wired = s.clients.filter((c) => c.online && c.type === 2).map((c) => ({ mac: c.mac }));
  return {
    ports: [
      { name: 'wan', label: 'WAN', role: 'wan', kind: 'direct', link: true, speedMbps: 2500, duplex: 'full', devices: [] },
      { name: 'secondwan', label: 'LAN1', role: 'lan', kind: 'switch', link: true, speedMbps: 1000, duplex: 'full', devices: [] },
      { name: 'lan2', label: 'LAN2', role: 'lan', kind: 'switch', link: false, speedMbps: null, duplex: null, devices: [] },
      { name: 'lan3', label: 'LAN3', role: 'lan', kind: 'switch', link: false, speedMbps: null, duplex: null, devices: [] },
      { name: 'lan4', label: 'LAN4', role: 'lan', kind: 'switch', link: true, speedMbps: 1000, duplex: 'full', devices: [] },
    ],
    unattributed: wired,
  };
};

const profiles = (s: MockState) =>
  keep<PortProfile[]>(s, 'safety-profiles', () => [
    { id: 'zeeli_pp_3f9a01', name: 'Camera port', untagged: 'iot', tagged: [] },
    { id: 'zeeli_pp_8c2e74', name: 'Lab trunk', untagged: 'main', tagged: ['guest', 'iot'] },
  ]);

const ports: Record<string, Handler> = {
  'zeeli:ports.status': (s) => status(s),
  'zeeli:ports.profiles': (s) => ({ profiles: [...profiles(s)].sort((a, b) => a.name.localeCompare(b.name)) }),
  'zeeli:ports.profile_save': (s, a) => {
    const name = text(a.name).trim();
    const untagged = text(a.untagged);
    const tagged = [...new Set(Array.isArray(a.tagged) ? (a.tagged as string[]) : [])].filter((n) => n !== untagged);
    if (!name || name.length > 32) return err('Give the profile a name of up to 32 characters.');
    if (!untagged) return err('Pick the network this profile carries untagged.');
    const list = profiles(s);
    if (list.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== a.id))
      return err(`A profile called ${name} already exists.`);
    const existing = a.id === undefined ? undefined : list.find((p) => p.id === a.id);
    if (a.id !== undefined && !existing) return err('That profile is gone. Reload the list.');
    const profile = existing ?? { id: `zeeli_pp_${hex(6)}`, name, untagged, tagged };
    Object.assign(profile, { name, untagged, tagged });
    if (!existing) list.push(profile);
    return { profile };
  },
  'zeeli:ports.profile_delete': (s, a) => {
    const list = profiles(s);
    const i = list.findIndex((p) => p.id === a.id);
    if (i < 0) return err('That profile is already gone.');
    list.splice(i, 1);
    return { id: a.id };
  },
};

/* ---------- mesh nodes (GL's own methods) ---------- */

interface DemoNode {
  mac: string;
  node_name: string;
  model: string;
  ip: string;
  role: 'controller' | 'agent';
  backhaul: { type: string; band?: string; signal?: number };
  clients: number;
  uptime: number;
}

const meshNodes = (s: MockState) =>
  keep<DemoNode[]>(s, 'safety-mesh', () => [
    {
      mac: '02:5E:E1:00:00:01',
      node_name: 'Zeeli-Demo',
      model: 'GL-BE9300',
      ip: '192.168.8.1',
      role: 'controller',
      backhaul: { type: '' },
      clients: 9,
      uptime: 1_632_263,
    },
    {
      mac: '02:5E:E1:77:10:01',
      node_name: 'Upstairs',
      model: 'GL-MT6000',
      ip: '192.168.8.2',
      role: 'agent',
      backhaul: { type: 'WiFi', band: '5G', signal: -57 },
      clients: 6,
      uptime: 259_200,
    },
    {
      mac: '02:5E:E1:77:10:02',
      node_name: 'Garage',
      model: 'GL-BE3600',
      ip: '192.168.8.3',
      role: 'agent',
      backhaul: { type: 'Ethernet' },
      clients: 3,
      uptime: 86_400,
    },
  ]);

const macs = (a: Args) => (Array.isArray(a.maclist) ? (a.maclist as string[]).map((m) => m.toUpperCase()) : []);

const mesh: Record<string, Handler> = {
  'mesh.get_topology': (s) => ({ nodes: meshNodes(s) }),
  'mesh.remove_nodes': (s, a) => {
    s.extra.set(
      'safety-mesh',
      meshNodes(s).filter((n) => n.role === 'controller' || !macs(a).includes(n.mac)),
    );
    return {};
  },
  'mesh.reboot_nodes': (s, a) => {
    for (const n of meshNodes(s)) if (n.role === 'agent' && macs(a).includes(n.mac)) n.uptime = 12;
    return {};
  },
  'mesh.set_node_name': (s, a) => {
    const n = meshNodes(s).find((x) => x.mac === text(a.mac).toUpperCase());
    if (n) n.node_name = text(a.node_name);
    return {};
  },
};

export const agentSafety: Record<string, Handler> = { ...firewall, ...backup, ...ports, ...mesh };
