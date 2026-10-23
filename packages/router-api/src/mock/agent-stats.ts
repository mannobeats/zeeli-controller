import type { Handler } from './handlers.ts';
import type { MockState } from './seed.ts';

/*
 * `zeeli.stats` on the demo router. Nothing is stored: every series is computed on request
 * from a small model of the household (who is home when, evening peaks, weekends) and a few
 * fixed incidents, so a chart always ends at "now" and looks like a week of real use.
 */

const HOUR = 3600;
const DAY = 86_400;
const RANGES = {
  '24h': { step: 300, n: 288 },
  '30d': { step: HOUR, n: 720 },
  '12m': { step: DAY, n: 365 },
} as const;
type Range = keyof typeof RANGES;
const isRange = (v: unknown): v is Range => typeof v === 'string' && v in RANGES;

const EVENT_KINDS = ['device.new', 'device.joined', 'device.left', 'wan.down', 'wan.up', 'wan.failover', 'temp.high'];
const DEFAULT_ALERTS = ['device.new', 'wan.down', 'wan.up', 'wan.failover', 'temp.high'];

/** Same numbers every time for the same inputs. */
function noise(key: string, n: number) {
  let h = 2166136261;
  for (const c of `${key}:${n}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

interface Person {
  /** Local hours the device is on the network. */
  windows: [number, number][];
  /** The hour of its busiest time, and how much busier than its quiet baseline. */
  peak: number;
  /** Upload as a share of download. */
  up: number;
  /** Days ago it first appeared and last disappeared; 0 for still here. */
  first?: number;
  last?: number;
}
const ALWAYS: [number, number][] = [[0, 24]];
const PROFILES: Record<string, Person> = {
  'Studio-Mac': { windows: [[8, 23]], peak: 14, up: 0.18 },
  'nas-01': { windows: ALWAYS, peak: 3, up: 0.45 },
  'homelab-proxmox': { windows: ALWAYS, peak: 4, up: 0.3 },
  'ci-runner': { windows: ALWAYS, peak: 11, up: 0.3 },
  'Living-Room-TV': { windows: [[17, 24]], peak: 20.5, up: 0.03 },
  'Maya-iPhone': {
    windows: [
      [6.5, 8.5],
      [17, 23.5],
    ],
    peak: 21,
    up: 0.12,
  },
  'Leo-iPad': { windows: [[15.5, 21]], peak: 18, up: 0.06 },
  'Leo-Switch': { windows: [[16, 20.5]], peak: 18.5, up: 0.05 },
  'Office-Laptop': { windows: [[8.5, 17.5]], peak: 11, up: 0.2 },
  'Kitchen-Speaker': { windows: [[7, 22]], peak: 8, up: 0.05 },
  Thermostat: { windows: ALWAYS, peak: 12, up: 0.5 },
  'Front-Door-Cam': { windows: ALWAYS, peak: 17, up: 8 },
  'Garage-Cam': { windows: ALWAYS, peak: 17, up: 8, last: 2 },
  Printer: { windows: [[10, 11]], peak: 10, up: 0.2, last: 9 },
  'Guest-Phone': {
    windows: [
      [18, 24],
      [0, 1],
    ],
    peak: 21,
    up: 0.1,
    first: 1.1,
  },
  'Old-Kindle': { windows: [[20, 22]], peak: 21, up: 0.1, last: 60 },
  Watch: { windows: [[6, 23]], peak: 8, up: 0.3 },
  'Backup-Pi': { windows: ALWAYS, peak: 2, up: 0.9 },
};

const hourOf = (t: number) => {
  const d = new Date(t * 1000);
  return d.getHours() + d.getMinutes() / 60;
};
const weekend = (t: number) => [0, 6].includes(new Date(t * 1000).getDay());
/** Distance round the clock, so a 3am peak also lifts 2am and 4am but not 3pm. */
const near = (h: number, peak: number) => {
  const d = Math.abs(h - peak);
  return Math.min(d, 24 - d);
};
const shape = (h: number, peak: number) => 0.18 + 0.82 * Math.exp(-(near(h, peak) ** 2) / (2 * 2.6 * 2.6));

interface Incident {
  start: number;
  seconds: number;
}

/** What the demo remembers: when it started (the incidents hang off that) and what people changed. */
interface Memory {
  base: number;
  outages: Incident[];
  events: MockEvent[];
  acked: Set<number>;
  alertKinds: string[];
  target: string;
  tempHigh: number;
}
interface MockEvent {
  id: number;
  t: number;
  kind: string;
  subject: string;
  name: string;
  value: number | null;
  alert: boolean;
}

function memory(s: MockState): Memory {
  const found = s.extra.get('agent-stats') as Memory | undefined;
  if (found) return found;
  const base = Math.floor(Date.now() / 1000);
  const outages = [
    { start: base - 3 * HOUR - 1200, seconds: 240 },
    { start: base - 9 * DAY - 5 * HOUR, seconds: 35 * 60 },
    { start: base - 47 * DAY - 2 * HOUR, seconds: 2 * HOUR },
  ];
  const fresh: Memory = {
    base,
    outages,
    events: history(s, base, outages),
    acked: new Set(),
    alertKinds: [...DEFAULT_ALERTS],
    target: '1.1.1.1',
    tempHigh: 85,
  };
  s.extra.set('agent-stats', fresh);
  return fresh;
}

const macs = (s: MockState) => s.clients.map((c) => c.mac.toUpperCase());
const profileOf = (s: MockState, mac: string) => {
  const c = s.clients.find((x) => x.mac.toUpperCase() === mac);
  return c ? { client: c, person: PROFILES[c.name] } : null;
};

/** Is the device on the network at time `t`, and how fast is it going if so? Bytes per second down, or null. */
function rateAt(s: MockState, m: Memory, mac: string, t: number): number | null {
  const p = profileOf(s, mac);
  if (!p?.person) return null;
  const { person, client } = p;
  const days = (m.base - t) / DAY;
  if ((person.first && days > person.first) || (person.last && days < person.last)) return null;
  const h = hourOf(t);
  if (!person.windows.some(([a, b]) => h >= a && h < b)) return null;
  const busy = shape(h, person.peak) * (weekend(t) ? 1.35 : 1);
  // the seeded rates are peaks of a busy minute; an average day moves a fraction of that
  return Math.max(60, client.rx * 0.12 * busy * (0.6 + 0.8 * noise(mac, Math.floor(t / 300))));
}

const inOutage = (m: Memory, t: number) => m.outages.some((o) => t >= o.start && t < o.start + o.seconds);
const overlaps = (m: Memory, from: number, to: number) => m.outages.some((o) => o.start < to && o.start + o.seconds > from);

/**
 * The main uplink has no sample in a bucket an outage touched, so a short outage shows on the hourly and
 * five-minute charts; on a daily bar only if it covered the middle of the day. The second uplink has a sample
 * in every bucket an outage touched.
 */
const uplinkUp = (m: Memory, id: string, t0: number, step: number) =>
  id === 'wan' ? !(overlaps(m, t0, t0 + step) && (step <= HOUR || inOutage(m, t0 + step / 2))) : overlaps(m, t0, t0 + step);

/** Bytes in the bucket from `t0`, from a handful of sample moments across it; null if nobody was there. */
function bucket(rate: (t: number) => number | null, t0: number, step: number, upRatio: number) {
  const k = Math.min(24, Math.max(1, Math.ceil(step / HOUR)));
  const seen: number[] = [];
  for (let j = 0; j < k; j++) {
    const r = rate(t0 + ((j + 0.5) * step) / k);
    if (r !== null) seen.push(r);
  }
  if (!seen.length) return null;
  const down = Math.round((seen.reduce((a, b) => a + b, 0) / seen.length) * step * (seen.length / k));
  return { down, up: Math.round(down * upRatio) };
}

const span = (range: Range, now: number) => {
  const { step, n } = RANGES[range];
  // buckets sit on the clock, the last one still filling
  const end = Math.floor(now / step) * step + step;
  return { step, n, start: end - n * step };
};

const NETWORKS: Record<string, (ip: string) => boolean> = {
  lan: (ip) => ip.startsWith('192.168.8.'),
  guest: (ip) => ip.startsWith('192.168.9.'),
  iot: (ip) => ip.startsWith('192.168.10.'),
  vlan20: (ip) => ip.startsWith('10.20.'),
};
const WANS = ['wan', 'wwan'];

type Bytes = { down: number; up: number };

/** How one thing's bytes in a bucket are worked out, or null for something that has no history. */
function pointFor(s: MockState, m: Memory, kind: string, id: string, step: number): ((t0: number) => Bytes | null) | null {
  const upShare = (mac: string) => profileOf(s, mac)?.person?.up ?? 0.15;
  const device = (mac: string, t0: number) => bucket((t) => rateAt(s, m, mac, t), t0, step, upShare(mac));
  const sum = (list: string[], t0: number) =>
    list.reduce(
      (a, mac) => {
        const b = device(mac, t0);
        return { down: a.down + (b?.down ?? 0), up: a.up + (b?.up ?? 0) };
      },
      { down: 0, up: 0 },
    );
  if (kind === 'client') return profileOf(s, id)?.person ? (t0) => device(id, t0) : null;
  const match = NETWORKS[id];
  if (kind === 'network' && match) {
    const list = s.clients.filter((c) => match(c.ip)).map((c) => c.mac.toUpperCase());
    return (t0) => sum(list, t0);
  }
  if (kind === 'wan' && WANS.includes(id)) {
    // the internet side carries a bit less than the devices add up to, and the second uplink only while the first is out
    return (t0) => {
      if (!uplinkUp(m, id, t0, step)) return null;
      const b = sum(macs(s), t0);
      return { down: Math.round(b.down * 0.94), up: Math.round(b.up * 0.97) };
    };
  }
  return null;
}

function trafficSeries(s: MockState, m: Memory, kind: string, id: string, range: Range, now: number) {
  const w = span(range, now);
  const point = pointFor(s, m, kind, id, w.step);
  if (!point) return null;
  const points = Array.from({ length: w.n }, (_, i) => point(w.start + i * w.step));
  const totals = points.reduce<Bytes>((a, p) => ({ down: a.down + (p?.down ?? 0), up: a.up + (p?.up ?? 0) }), { down: 0, up: 0 });
  return { start: w.start, step: w.step, fields: ['down', 'up'], points: points.map((p) => (p ? [p.down, p.up] : null)), totals };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x: number, places = 1) => Math.round(x * 10 ** places) / 10 ** places;

/** The average of a quantity across a bucket's sample moments; null if it was never measured. */
function averaged(t0: number, step: number, at: (t: number) => number | null) {
  const k = Math.min(24, Math.max(1, Math.ceil(step / HOUR)));
  const seen: number[] = [];
  for (let j = 0; j < k; j++) {
    const v = at(t0 + ((j + 0.5) * step) / k);
    if (v !== null) seen.push(v);
  }
  return seen.length ? mean(seen) : null;
}

/** A row where nothing was measured is a gap, as the agent returns it. */
const gap = (row: (number | null)[]) => (row.every((v) => v === null) ? null : row);

const evening = (t: number) => shape(hourOf(t), 20.5);

function systemSeries(range: Range, now: number) {
  const w = span(range, now);
  const points = Array.from({ length: w.n }, (_, i) => {
    const t0 = w.start + i * w.step;
    const load = (t: number) => evening(t) * (weekend(t) ? 1.3 : 1);
    const cpu = averaged(t0, w.step, (t) => 4 + 16 * load(t) + 5 * noise('cpu', Math.floor(t / 300)));
    const mem = averaged(t0, w.step, (t) => 38 + 2.5 * Math.sin(t / 40_000) + 1.2 * noise('mem', Math.floor(t / 3600)));
    const temp = averaged(t0, w.step, (t) => 49 + 0.45 * (4 + 16 * load(t)) + 2.5 * noise('temp', Math.floor(t / 600)));
    return [cpu === null ? null : round(cpu), mem === null ? null : round(mem), temp === null ? null : round(temp)];
  });
  return { start: w.start, step: w.step, fields: ['cpu', 'mem', 'temp'], points };
}

function healthSeries(m: Memory, id: string, range: Range, now: number) {
  if (!WANS.includes(id)) return null;
  const w = span(range, now);
  const points = Array.from({ length: w.n }, (_, i) => {
    const t0 = w.start + i * w.step;
    const col = (f: (t: number) => number) => {
      const v = uplinkUp(m, id, t0, w.step) ? averaged(t0, w.step, f) : null;
      return v === null ? null : round(v, 2);
    };
    const rush = (t: number) => evening(t);
    const lossy = (t: number) => (noise('loss', Math.floor(t / 300)) > 0.93 ? 1 + 3 * noise('lossy', Math.floor(t / 300)) : 0);
    return gap([
      col((t) => (id === 'wan' ? 1.8 : 6) + 0.5 * noise('gw', Math.floor(t / 300)) + 0.9 * rush(t)),
      col((t) => (noise('gwloss', Math.floor(t / 300)) > 0.985 ? 1 : 0)),
      col(
        (t) =>
          (id === 'wan' ? 18 : 52) + 3 * noise('net', Math.floor(t / 300)) + 20 * rush(t) ** 2 * (0.6 + noise('peak', Math.floor(t / 900))),
      ),
      col((t) => lossy(t) * rush(t)),
    ]);
  });
  return { start: w.start, step: w.step, fields: ['gatewayMs', 'gatewayLoss', 'internetMs', 'internetLoss'], points };
}

type EventDraft = Omit<MockEvent, 'id'>;

/** The hours a device is home on the day `d` days ago; none if it hadn't arrived yet, is gone, or never leaves. */
const homeHours = (p: Person | undefined, d: number): [number, number][] =>
  p && p.windows !== ALWAYS && !(p.last && d < p.last) && !(p.first && d + 0.5 > p.first) ? p.windows : [];

/** One stay: a join near the start of the window and a leave near its end (none for a window that runs to midnight). */
function stay(c: MockState['clients'][number], midnight: number, [from, to]: [number, number], base: number): EventDraft[] {
  const event = (t: number, kind: string) => ({ t, kind, subject: c.mac.toUpperCase(), name: c.name, value: null, alert: false });
  const out = [event(midnight + from * HOUR + Math.round(noise(c.mac, midnight + from) * 900), 'device.joined')];
  if (to < 24) out.push(event(midnight + to * HOUR - Math.round(noise(c.mac, midnight + to) * 900), 'device.left'));
  return out.filter((e) => e.t < base);
}

/** Each device with set hours joins and leaves once a day, for a week back. */
function comingAndGoing(s: MockState, base: number): EventDraft[] {
  const today = new Date(base * 1000);
  today.setHours(0, 0, 0, 0);
  return [6, 5, 4, 3, 2, 1, 0].flatMap((d) =>
    s.clients.flatMap((c) => homeHours(PROFILES[c.name], d).flatMap((w) => stay(c, today.getTime() / 1000 - d * DAY, w, base))),
  );
}

/** A week of coming and going, a new device, a short outage and a hot afternoon. */
function history(s: MockState, base: number, outages: Incident[]): MockEvent[] {
  const out = comingAndGoing(s, base);
  const add = (t: number, kind: string, subject: string, name = '', value: number | null = null) =>
    out.push({ t, kind, subject, name, value, alert: DEFAULT_ALERTS.includes(kind) });
  const guest = s.clients.find((c) => c.name === 'Guest-Phone');
  if (guest) {
    add(base - 27 * HOUR, 'device.new', guest.mac.toUpperCase(), guest.name);
    add(base - 27 * HOUR + 20, 'device.joined', guest.mac.toUpperCase(), guest.name);
  }
  for (const o of outages) {
    add(o.start, 'wan.down', 'wan');
    add(o.start + 3, 'wan.failover', 'wwan', 'wan');
    add(o.start + o.seconds, 'wan.up', 'wan');
    add(o.start + o.seconds + 3, 'wan.failover', 'wan', 'wwan');
  }
  add(base - 6 * DAY - 2 * HOUR, 'temp.high', 'router', '', 86);
  return out
    .filter((e) => e.t < base)
    .sort((a, b) => a.t - b.t)
    .map((e, i) => ({ ...e, id: i + 1 }));
}

const total = (r: { down: number; up: number }) => r.down + r.up;

const unread = (m: Memory) => m.events.filter((e) => e.alert && !m.acked.has(e.id)).reverse();
const alertReply = (m: Memory) => ({ alerts: unread(m), unread: unread(m).length, on: m.alertKinds, available: EVENT_KINDS });

export const agentStats: Record<string, Handler> = {
  'zeeli:stats.series': (s, a) => {
    const m = memory(s);
    if (typeof a.kind !== 'string' || !['wan', 'network', 'client', 'system', 'health'].includes(a.kind))
      return { error: 'Choose wan, network, client, system or health.' };
    if (!isRange(a.range)) return { error: 'Choose 24h, 30d or 12m.' };
    const id = String(a.id ?? '');
    const now = Math.floor(Date.now() / 1000);
    const found =
      a.kind === 'system'
        ? id === 'router' && systemSeries(a.range, now)
        : a.kind === 'health'
          ? healthSeries(m, id, a.range, now)
          : trafficSeries(s, m, a.kind, a.kind === 'client' ? id.toUpperCase() : id, a.range, now);
    if (!found) return { error: `There is no history for ${id.slice(0, 40)} yet.` };
    return { kind: a.kind, id, range: a.range, ...found };
  },

  'zeeli:stats.top': (s, a) => {
    const m = memory(s);
    const range = a.range;
    if (!isRange(range)) return { error: 'Choose 24h, 30d or 12m.' };
    const limit = Number(a.limit) || 10;
    const now = Math.floor(Date.now() / 1000);
    const rank = (kind: string, ids: string[]) =>
      ids
        .flatMap((id) => {
          const series = trafficSeries(s, m, kind, id, range, now);
          return series && total(series.totals) > 0 ? [{ id, ...series.totals }] : [];
        })
        .sort((x, y) => total(y) - total(x))
        .slice(0, limit);
    return {
      range,
      asOf: now - 240,
      clients: rank('client', macs(s)),
      networks: rank('network', Object.keys(NETWORKS)),
      wans: rank('wan', WANS),
    };
  },

  'zeeli:stats.events': (s, a) => {
    const m = memory(s);
    const since = Number(a.since) || 0;
    const kinds = Array.isArray(a.kinds) ? (a.kinds as string[]) : [];
    const limit = Math.min(500, Number(a.limit) || 100);
    const subject = typeof a.subject === 'string' ? a.subject.toUpperCase() : '';
    const events = [...m.events]
      .reverse()
      .filter(
        (e) => (!since || e.t > since) && (!kinds.length || kinds.includes(e.kind)) && (!subject || e.subject.toUpperCase() === subject),
      )
      .slice(0, limit);
    return { events };
  },

  'zeeli:stats.alerts': (s, a) => {
    const m = memory(s);
    if (a.save === true) {
      const kinds = Array.isArray(a.kinds) ? (a.kinds as string[]) : [];
      if (kinds.some((k) => !EVENT_KINDS.includes(k))) return { error: 'Unknown alert kind.' };
      m.alertKinds = EVENT_KINDS.filter((k) => kinds.includes(k));
    }
    if (a.all === true) for (const e of m.events) m.acked.add(e.id);
    if (Array.isArray(a.ack)) for (const id of a.ack as string[]) m.acked.add(Number(id));
    return alertReply(m);
  },

  'zeeli:stats.settings': (s, a) => {
    const m = memory(s);
    if (a.save === true) {
      if (typeof a.target === 'string') m.target = a.target;
      if (a.tempHigh) m.tempHigh = Number(a.tempHigh);
    }
    return { target: m.target, tempHigh: m.tempHigh };
  },

  'zeeli:stats.status': (s) => {
    const m = memory(s);
    const now = Math.floor(Date.now() / 1000);
    return {
      running: true,
      lastSample: now - (now % 60) + 3,
      took: 118,
      devices: s.clients.length,
      storage: { bytes: 2_950_000 + s.clients.length * 50_600, files: s.clients.length + 8 },
      saved: { at: now - (now % 900) },
      durable: true,
      since: m.base,
    };
  },
};
