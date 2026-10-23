import type { Handler } from './handlers.ts';
import type { MockState } from './seed.ts';

/**
 * `zeeli.groups` and `zeeli.policies` on the demo router. The state lives in `state.extra`
 * like the real agent keeps it in /etc/config/zeeli: writes change what reads return, a
 * pause ends when its time passes, and an active speed limit shows up on the client.
 */

type Args = Record<string, unknown>;

interface G {
  id: string;
  name: string;
  kind: 'person' | 'devices';
  members: string[];
}
interface P {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  who: { type: string; id: string }[];
  what: { kind: string; sites?: string[]; network?: string };
  when: { kind: string; days?: number[]; from?: string; to?: string };
  until: number | null;
  action: { kind: string; down?: number; up?: number };
  tag: string;
}

/** The demo router's UTC offset, which `system.get_status` reports as -0400. */
const TZ_MINUTES = -240;
const ZONES = ['lan', 'guest', 'iot', 'vlan20'];
const MAC = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const LIMITS = { groups: 64, members: 256, policies: 128, who: 32, sites: 50 };
const KIB_PER_MBPS = 1e6 / 8 / 1024;

const now = () => Math.floor(Date.now() / 1000);
const fail = (error: string) => ({ error });
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const clone = <T>(v: T): T => structuredClone(v);

interface Store {
  groups: G[];
  policies: P[];
  next: number;
  /** MACs whose speed limit a policy set, so it can be taken off again. */
  limited: Set<string>;
}

const macOf = (s: MockState, hostname: string) => s.clients.find((c) => c.name === hostname)?.mac ?? '';

function seedStore(s: MockState): Store {
  const kids = ['Maya-iPhone', 'Leo-iPad', 'Leo-Switch'].map((n) => macOf(s, n));
  const cameras = ['Front-Door-Cam', 'Garage-Cam'].map((n) => macOf(s, n));
  const tv = macOf(s, 'Living-Room-TV');
  const base = { enabled: true, until: null, tag: '' };
  return {
    groups: [
      { id: 'a1b2c3', name: 'Kids', kind: 'person', members: kids },
      { id: 'd4e5f6', name: 'Cameras', kind: 'devices', members: cameras },
    ],
    policies: [
      {
        ...base,
        id: '100001',
        name: 'Bedtime',
        order: 10,
        who: [{ type: 'group', id: 'a1b2c3' }],
        what: { kind: 'internet' },
        when: { kind: 'schedule', days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '07:00' },
        action: { kind: 'block' },
      },
      {
        ...base,
        id: '100002',
        name: 'No TikTok',
        order: 20,
        who: [{ type: 'group', id: 'a1b2c3' }],
        what: { kind: 'sites', sites: ['tiktok.com', 'tiktokv.com'] },
        when: { kind: 'always' },
        action: { kind: 'block' },
      },
      {
        ...base,
        id: '100003',
        name: 'Living-Room-TV paused',
        order: 30,
        who: [{ type: 'client', id: tv }],
        what: { kind: 'internet' },
        when: { kind: 'always' },
        action: { kind: 'block' },
        until: now() + 42 * 60,
        tag: `pause:${tv}`,
      },
    ],
    next: 0x100004,
    limited: new Set(),
  };
}

const store = (s: MockState): Store => {
  if (!s.extra.has('policies')) s.extra.set('policies', seedStore(s));
  return s.extra.get('policies') as Store;
};

/* ---------- when does a policy apply ---------- */

const minutes = (t: string | undefined) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Monday 1 … Sunday 7 and minutes since midnight, in the router's time. */
function localClock(ts: number) {
  const d = new Date((ts + TZ_MINUTES * 60) * 1000);
  return { wday: d.getUTCDay() || 7, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

function inWindow(w: P['when'], ts: number) {
  if (w.kind !== 'schedule') return true;
  const { wday, minutes: m } = localClock(ts);
  const from = minutes(w.from) ?? 0;
  const to = minutes(w.to) ?? 0;
  const on = (d: number) => (w.days ?? []).includes(d);
  if (from === to) return on(wday);
  if (from < to) return on(wday) && m >= from && m < to;
  return (on(wday) && m >= from) || (on(wday === 1 ? 7 : wday - 1) && m < to);
}

const isActive = (p: P, ts: number) => p.enabled && (p.until === null || ts < p.until) && inWindow(p.when, ts);

/* ---------- applying: expiry and speed limits ---------- */

const membersOf = (st: Store, p: P) =>
  p.who.flatMap((w) =>
    w.type === 'client' ? [w.id.toUpperCase()] : w.type === 'group' ? (st.groups.find((g) => g.id === w.id)?.members ?? []) : [],
  );

/** The limit each device is under right now: the first active limit policy to name it. */
function wantedLimits(st: Store, t: number) {
  const want = new Map<string, P['action']>();
  for (const p of [...st.policies].sort((a, b) => a.order - b.order)) {
    if (p.action.kind !== 'limit' || !isActive(p, t)) continue;
    for (const mac of membersOf(st, p)) if (!want.has(mac)) want.set(mac, p.action);
  }
  return want;
}

/** Drop what has ended, and set or clear the speed limits that are active. */
function apply(s: MockState) {
  const st = store(s);
  const t = now();
  st.policies = st.policies.filter((p) => p.until === null || p.until > t);
  const want = wantedLimits(st, t);
  for (const c of s.clients) {
    const a = want.get(c.mac);
    if (a) {
      Object.assign(c, { limit_rx: Math.round((a.down ?? 0) * KIB_PER_MBPS), limit_tx: Math.round((a.up ?? 0) * KIB_PER_MBPS) });
      st.limited.add(c.mac);
    } else if (st.limited.delete(c.mac)) {
      Object.assign(c, { limit_rx: 0, limit_tx: 0 });
    }
  }
}

/* ---------- checking input, with the agent's messages ---------- */

type Checked<T> = { value: T } | { error: string };

const printable = (s: string) => [...s].every((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127);

function checkName(v: unknown, what: string) {
  const n = str(v).trim();
  return n && printable(n) && n.length <= 40 ? null : `Give the ${what} a name.`;
}

function checkMacs(v: unknown): { macs: string[] } | { error: string } {
  if (!Array.isArray(v)) return fail('Members must be a list of MAC addresses.');
  for (const m of v) if (!MAC.test(str(m))) return fail(`“${m}” isn’t a MAC address.`);
  return { macs: [...new Set(v.map((m) => String(m).toUpperCase()))] };
}

function checkWho(st: Store, raw: unknown): Checked<P['who']> {
  const list = raw as { type: string; id: string }[];
  if (!Array.isArray(list) || !list.length) return fail('Choose who the policy is for.');
  if (list.length > LIMITS.who) return fail(`A policy can name up to ${LIMITS.who} devices, groups or networks.`);
  const who: P['who'] = [];
  for (const w of list) {
    const id = w.type === 'client' ? str(w.id).toUpperCase() : str(w.id);
    const problem =
      (w.type === 'client' && !MAC.test(id) && `“${w.id}” isn’t a MAC address.`) ||
      (w.type === 'group' && !st.groups.some((g) => g.id === id) && 'One of the groups in this policy doesn’t exist.') ||
      (w.type === 'network' && !ZONES.includes(id) && `The firewall has no network called ${id}.`) ||
      (!['client', 'group', 'network'].includes(w.type) && `“${w.type}” isn’t something a policy can be for.`);
    if (problem) return fail(problem);
    if (!who.some((x) => x.type === w.type && x.id === id)) who.push({ type: w.type, id });
  }
  return { value: who };
}

function checkWhat(raw: P['what']): Checked<P['what']> {
  if (raw.kind === 'sites') {
    const sites = [...new Set((raw.sites ?? []).map((d) => String(d).trim().toLowerCase()))];
    if (!sites.length) return fail('Add at least one site.');
    if (sites.length > LIMITS.sites) return fail(`A policy can name up to ${LIMITS.sites} sites.`);
    const bad = sites.find((d) => !DOMAIN.test(d));
    return bad
      ? fail(`“${bad}” isn’t a site. Use just the domain, like tiktok.com. Subdomains are included.`)
      : { value: { kind: 'sites', sites } };
  }
  if (raw.kind === 'network') {
    const network = str(raw.network);
    return ZONES.includes(network) ? { value: { kind: 'network', network } } : fail(`The firewall has no network called ${raw.network}.`);
  }
  return ['internet', 'everything'].includes(raw.kind) ? { value: { kind: raw.kind } } : fail('Choose what the policy covers.');
}

function checkWhen(raw: P['when']): Checked<P['when']> {
  if (raw.kind === 'always') return { value: { kind: 'always' } };
  if (raw.kind !== 'schedule') return fail('Choose when the policy applies.');
  const days = [...new Set(raw.days ?? [])].sort();
  if (!days.length) return fail('Choose at least one day for the schedule.');
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return fail('Days run from 1 (Monday) to 7 (Sunday).');
  if (minutes(raw.from) === null || minutes(raw.to) === null) return fail('Times look like 22:00.');
  return { value: { kind: 'schedule', days, from: raw.from, to: raw.to } };
}

function checkAction(raw: P['action'], what: P['what'], who: P['who']): Checked<P['action']> {
  if (!['block', 'allow', 'limit'].includes(raw.kind)) return fail('Choose what the policy does.');
  if (raw.kind !== 'limit') return { value: { kind: raw.kind } };
  const down = raw.down ?? 0;
  const up = raw.up ?? 0;
  if ([down, up].some((v) => typeof v !== 'number' || v < 0 || v > 10_000)) return fail('A speed limit is between 0 and 10000 Mbps.');
  if (!down && !up) return fail('Enter a download or an upload limit.');
  if (!['internet', 'everything'].includes(what.kind))
    return fail('A speed limit covers all of a device’s traffic, not one site or network.');
  if (who.some((w) => w.type === 'network')) return fail('A speed limit is set per device, so it can’t be for a whole network.');
  return { value: { kind: 'limit', down, up } };
}

function checkUntil(raw: unknown, base: number | null): Checked<number | null> {
  if (raw === undefined) return { value: base };
  const u = Number(raw);
  if (!Number.isFinite(u) || u < 0) return fail('That end time isn’t valid.');
  const until = u === 0 ? null : u;
  return until !== null && until !== base && until <= now() ? fail('That time has already passed.') : { value: until };
}

function buildPolicy(st: Store, a: Args, base: P): P | { error: string } {
  const name = checkName(a.name ?? base.name, 'policy');
  if (name) return fail(name);
  const who = checkWho(st, a.who ?? base.who);
  if ('error' in who) return who;
  const what = checkWhat((a.what ?? base.what) as P['what']);
  if ('error' in what) return what;
  const when = checkWhen((a.when ?? base.when) as P['when']);
  if ('error' in when) return when;
  const action = checkAction((a.action ?? base.action) as P['action'], what.value, who.value);
  if ('error' in action) return action;
  const until = checkUntil(a.until, base.until);
  if ('error' in until) return until;
  return {
    id: base.id,
    name: str(a.name ?? base.name).trim(),
    enabled: typeof a.enabled === 'boolean' ? a.enabled : base.enabled,
    order: base.order,
    who: who.value,
    what: what.value,
    when: when.value,
    until: until.value,
    action: action.value,
    tag: str(a.tag ?? base.tag),
  };
}

const view = (p: P, t: number) => ({ ...clone(p), active: isActive(p, t) });
const nextId = (st: Store) => (st.next++).toString(16).padStart(6, '0');
const sorted = (st: Store) => [...st.policies].sort((a, b) => a.order - b.order);
const blank: Omit<P, 'id' | 'order'> = {
  name: '',
  enabled: true,
  who: [],
  what: { kind: 'internet' },
  when: { kind: 'always' },
  until: null,
  action: { kind: 'block' },
  tag: '',
};
const topOrder = (st: Store) => st.policies.reduce((n, p) => Math.max(n, p.order), 0) + 10;

/* ---------- groups ---------- */

const groupProblem = (st: Store, g: G) => {
  const bad = checkName(g.name, 'group');
  if (bad) return bad;
  if (g.kind !== 'person' && g.kind !== 'devices') return 'A group is for a person or for a set of devices.';
  if (g.members.length > LIMITS.members) return `A group can hold up to ${LIMITS.members} devices.`;
  if (st.groups.some((o) => o.id !== g.id && o.name.toLowerCase() === g.name.toLowerCase()))
    return `There is already a group called ${g.name}.`;
  return null;
};

const findGroup = (st: Store, id: unknown) => st.groups.find((g) => g.id === id);

const groupHandlers: Record<string, Handler> = {
  'zeeli:groups.list': (s) => ({ groups: clone(store(s).groups) }),
  'zeeli:groups.create': (s, a) => {
    const st = store(s);
    if (st.groups.length >= LIMITS.groups) return fail(`You can have up to ${LIMITS.groups} groups.`);
    const members = checkMacs(a.members ?? []);
    if ('error' in members) return members;
    const g: G = { id: nextId(st), name: str(a.name).trim(), kind: (a.kind as G['kind']) ?? 'devices', members: members.macs };
    const bad = groupProblem(st, g);
    if (bad) return fail(bad);
    st.groups.push(g);
    return { group: clone(g), applied: 'none', warnings: [] };
  },
  'zeeli:groups.update': (s, a) => {
    const st = store(s);
    const g = findGroup(st, a.id);
    if (!g) return fail('That group doesn’t exist.');
    const next = { ...g };
    if (a.name !== undefined) next.name = str(a.name).trim();
    if (a.kind !== undefined) next.kind = a.kind as G['kind'];
    if (a.members !== undefined) {
      const members = checkMacs(a.members);
      if ('error' in members) return members;
      next.members = members.macs;
    }
    const bad = groupProblem(st, next);
    if (bad) return fail(bad);
    Object.assign(g, next);
    apply(s);
    return { group: clone(g), applied: 'none', warnings: [] };
  },
  'zeeli:groups.delete': (s, a) => {
    const st = store(s);
    if (!findGroup(st, a.id)) return fail('That group doesn’t exist.');
    let affected = 0;
    for (const p of st.policies) {
      const who = p.who.filter((w) => !(w.type === 'group' && w.id === a.id));
      if (who.length === p.who.length) continue;
      p.who = who;
      p.enabled = p.enabled && who.length > 0;
      affected++;
    }
    st.groups = st.groups.filter((g) => g.id !== a.id);
    apply(s);
    return { affected, applied: 'none', warnings: [] };
  },
  'zeeli:groups.add_members': (s, a) => changeMembers(s, a, true),
  'zeeli:groups.remove_members': (s, a) => changeMembers(s, a, false),
};

function changeMembers(s: MockState, a: Args, adding: boolean) {
  const st = store(s);
  const g = findGroup(st, a.id);
  if (!g) return fail('That group doesn’t exist.');
  const macs = checkMacs(a.macs);
  if ('error' in macs) return macs;
  const members = adding ? [...new Set([...g.members, ...macs.macs])] : g.members.filter((m) => !macs.macs.includes(m));
  if (members.length > LIMITS.members) return fail(`A group can hold up to ${LIMITS.members} devices.`);
  g.members = members;
  apply(s);
  return { group: clone(g), applied: 'none', warnings: [] };
}

/* ---------- policies ---------- */

const policyHandlers: Record<string, Handler> = {
  'zeeli:policies.list': (s) => {
    apply(s);
    const t = now();
    return { policies: sorted(store(s)).map((p) => view(p, t)), now: t, warnings: [] };
  },
  'zeeli:policies.create': (s, a) => {
    const st = store(s);
    if (st.policies.length >= LIMITS.policies) return fail(`You can have up to ${LIMITS.policies} policies.`);
    const p = buildPolicy(st, a, { ...clone(blank), id: nextId(st), order: topOrder(st) });
    if ('error' in p) return p;
    st.policies.push(p);
    apply(s);
    return { policy: view(p, now()), applied: 'reload', warnings: [] };
  },
  'zeeli:policies.update': (s, a) => {
    const st = store(s);
    const base = st.policies.find((p) => p.id === a.id);
    if (!base) return fail('That policy doesn’t exist.');
    const p = buildPolicy(st, a, base);
    if ('error' in p) return p;
    Object.assign(base, p);
    apply(s);
    return { policy: view(base, now()), applied: 'live', warnings: [] };
  },
  'zeeli:policies.delete': (s, a) => {
    const st = store(s);
    if (!st.policies.some((p) => p.id === a.id)) return fail('That policy doesn’t exist.');
    st.policies = st.policies.filter((p) => p.id !== a.id);
    apply(s);
    return { applied: 'reload', warnings: [] };
  },
  'zeeli:policies.reorder': (s, a) => {
    const st = store(s);
    const ids = a.ids;
    if (!Array.isArray(ids)) return fail('Send the policies in the order you want.');
    if (new Set(ids).size !== ids.length || ids.some((id) => !st.policies.some((p) => p.id === id)))
      return fail('That order names a policy twice or one that doesn’t exist.');
    const order = [...ids.map((id) => st.policies.find((p) => p.id === id) as P), ...sorted(st).filter((p) => !ids.includes(p.id))];
    order.forEach((p, i) => {
      p.order = (i + 1) * 10;
    });
    return { applied: 'reload', warnings: [] };
  },
  'zeeli:policies.pause': (s, a) => {
    const st = store(s);
    const m = a.minutes;
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 10_080) return fail('A pause lasts from 1 minute to 7 days.');
    const tag = str(a.tag);
    if (tag) st.policies = st.policies.filter((p) => p.tag !== tag);
    const p = buildPolicy(
      st,
      {
        name: str(a.name) || 'Paused',
        who: a.who,
        what: { kind: str(a.what) || 'internet' },
        when: { kind: 'always' },
        action: { kind: 'block' },
        until: now() + m * 60,
        tag,
      },
      { ...clone(blank), id: nextId(st), order: topOrder(st) },
    );
    if ('error' in p) return p;
    st.policies.push(p);
    return { policy: view(p, now()), applied: 'reload', warnings: [] };
  },
  'zeeli:policies.apply': (s) => {
    apply(s);
    return { applied: 'none', warnings: [] };
  },
  'zeeli:policies.status': (s) => {
    apply(s);
    const t = now();
    return {
      included: true,
      file: true,
      inSync: true,
      loaded: true,
      active: store(s)
        .policies.filter((p) => isActive(p, t))
        .map((p) => p.id),
      limits: [],
      appliedLimits: [...store(s).limited],
      warnings: [],
      now: t,
    };
  },
};

/** `zeeli.groups` and `zeeli.policies` on the demo router. */
export const agentPolicies: Record<string, Handler> = { ...groupHandlers, ...policyHandlers };
