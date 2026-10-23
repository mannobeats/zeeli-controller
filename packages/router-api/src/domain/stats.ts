import { isRouterError } from '../errors.ts';
import type { Transport } from '../transport/types.ts';
import type { Network } from './networks.ts';

/** The agent keeps minutes for a day, hours for a month and days for a year. */
export const HISTORY_RANGES = { '24h': 'Past 24 hours', '30d': 'Past 30 days', '12m': 'Past 12 months' } as const;
export type HistoryRange = keyof typeof HISTORY_RANGES;

export type TrafficKind = 'wan' | 'network' | 'client';

/** A series: `points[i]` covers the `step` seconds from `start + i * step`. A null point has no sample. */
export interface Series<P> {
  start: number;
  step: number;
  points: (P | null)[];
}
/** Bytes in the interval: down is to the device (or from the internet), up is from it. */
export interface TrafficPoint {
  down: number;
  up: number;
}
export interface TrafficSeries extends Series<TrafficPoint> {
  totals: TrafficPoint;
}
/** Percent, and degrees Celsius. */
export interface SystemPoint {
  cpu: number | null;
  memory: number | null;
  temp: number | null;
}
/** Milliseconds, and percent of pings lost. */
export interface HealthPoint {
  gatewayMs: number | null;
  gatewayLoss: number | null;
  internetMs: number | null;
  internetLoss: number | null;
}

export interface UsageTotal {
  id: string;
  down: number;
  up: number;
}
export interface TopUsage {
  clients: UsageTotal[];
  networks: UsageTotal[];
  wans: UsageTotal[];
  /** When the agent last added the ranges up. */
  asOf: Date | null;
}

export const EVENT_KINDS = {
  'device.new': 'A new device joins',
  'device.joined': 'A device connects',
  'device.left': 'A device disconnects',
  'wan.down': 'An uplink goes down',
  'wan.up': 'An uplink comes back',
  'wan.failover': 'The router switches uplink',
  'temp.high': 'The router runs hot',
} as const;
export type HistoryEventKind = keyof typeof EVENT_KINDS;

export interface HistoryEvent {
  id: number;
  time: Date;
  kind: HistoryEventKind;
  /** The device MAC, uplink or network the event is about. */
  subject: string;
  /** The device’s name at the time, or the uplink it switched from. */
  name: string;
  /** Degrees, for a heat alert. */
  value: number | null;
  alert: boolean;
}

export interface AlertState {
  alerts: HistoryEvent[];
  unread: number;
  /** The kinds that raise alerts. */
  on: HistoryEventKind[];
}

export interface HistoryStatus {
  running: boolean;
  lastSample: Date | null;
  devices: number;
  storageBytes: number;
  /** When the history was last copied to flash; null if it never was or the router has no place for it. */
  savedAt: Date | null;
  durable: boolean;
}

export interface HistorySettings {
  /** The address pinged to measure internet health. */
  target: string;
  /** The temperature, in °C, that raises a heat alert. */
  tempHigh: number;
}

interface RawSeries {
  start: number;
  step: number;
  fields: string[];
  points: (number[] | null)[];
  totals?: TrafficPoint;
}
interface RawEvent {
  id: number;
  t: number;
  kind: HistoryEventKind;
  subject: string;
  name?: string;
  value?: number | null;
  alert: boolean;
}

const toEvent = (e: RawEvent): HistoryEvent => ({
  id: e.id,
  time: new Date(e.t * 1000),
  kind: e.kind,
  subject: e.subject,
  name: e.name ?? '',
  value: e.value ?? null,
  alert: e.alert,
});

const NO_HISTORY = /^There is no history/;

const FIXED_IDS: Record<string, string> = { main: 'lan', guest: 'guest', iot: 'iot' };
/** The id the agent uses for a console network: the firmware calls the main one `main`, the agent `lan`. */
export const historyNetworkId = (n: Pick<Network, 'id' | 'vlanId'>) => FIXED_IDS[n.id] ?? (n.vlanId ? `vlan${n.vlanId}` : n.id);

/**
 * History the Zeeli agent keeps on the router: every device, network and uplink for 24 hours,
 * 30 days and 12 months, plus events and alerts. Each call fails with `RouterError('failed')`
 * on a router whose agent is too old to have it; `status()` is the way to find out first.
 */
export const stats = (t: Transport) => {
  async function series(kind: string, id: string, range: HistoryRange): Promise<RawSeries | null> {
    try {
      return await t.zeeli<RawSeries>('stats', 'series', { kind, id, range });
    } catch (err) {
      if (isRouterError(err) && err.kind === 'failed' && NO_HISTORY.test(err.message)) return null;
      throw err;
    }
  }
  /** Rows of numbers to objects named by the agent's field list. */
  const named = <P>(raw: RawSeries): Series<P> => ({
    start: raw.start,
    step: raw.step,
    points: raw.points.map((row) => (row ? (Object.fromEntries(raw.fields.map((f, i) => [f, row[i] ?? null])) as P) : null)),
  });

  const alertState = (r: { alerts: RawEvent[]; unread: number; on: HistoryEventKind[] }): AlertState => ({
    alerts: r.alerts.map(toEvent),
    unread: r.unread,
    on: r.on,
  });
  const settingsOf = (r: HistorySettings) => ({ target: r.target, tempHigh: r.tempHigh });

  return {
    /** The collector’s state, or null when this router’s agent has no history yet. */
    async status(): Promise<HistoryStatus | null> {
      try {
        const r = await t.zeeli<{
          running: boolean;
          lastSample: number | null;
          devices: number;
          storage: { bytes: number };
          saved: { at: number } | null;
          durable: boolean;
        }>('stats', 'status');
        return {
          running: r.running,
          lastSample: r.lastSample ? new Date(r.lastSample * 1000) : null,
          devices: r.devices,
          storageBytes: r.storage.bytes,
          savedAt: r.saved ? new Date(r.saved.at * 1000) : null,
          durable: r.durable,
        };
      } catch (err) {
        if (isRouterError(err) && err.kind === 'failed') return null;
        throw err;
      }
    },

    /** Bytes for a device (MAC), a network (see `historyNetworkId`) or an uplink. Null if it has no history yet. */
    async traffic(kind: TrafficKind, id: string, range: HistoryRange): Promise<TrafficSeries | null> {
      const raw = await series(kind, id, range);
      return raw ? { ...named<TrafficPoint>(raw), totals: raw.totals ?? { down: 0, up: 0 } } : null;
    },
    /** CPU, memory and temperature of the router. */
    async system(range: HistoryRange): Promise<Series<SystemPoint> | null> {
      const raw = await series('system', 'router', range);
      if (!raw) return null;
      const s = named<Record<string, number | null>>(raw);
      return { ...s, points: s.points.map((p) => (p ? { cpu: p.cpu ?? null, memory: p.mem ?? null, temp: p.temp ?? null } : null)) };
    },
    /** Latency and loss to an uplink’s gateway and to the internet. */
    async health(uplink: string, range: HistoryRange): Promise<Series<HealthPoint> | null> {
      const raw = await series('health', uplink, range);
      return raw ? named<HealthPoint>(raw) : null;
    },

    /** The busiest devices, networks and uplinks in a range, as of the agent’s last summary. */
    async top(range: HistoryRange, limit = 10): Promise<TopUsage> {
      const r = await t.zeeli<{ clients?: UsageTotal[]; networks?: UsageTotal[]; wans?: UsageTotal[]; asOf: number | null }>(
        'stats',
        'top',
        {
          range,
          limit: String(limit),
        },
      );
      return { clients: r.clients ?? [], networks: r.networks ?? [], wans: r.wans ?? [], asOf: r.asOf ? new Date(r.asOf * 1000) : null };
    },

    /** What happened, newest first. `since` is a time; only later events come back. `subject` is one device (MAC) or uplink. */
    async events(options: { since?: Date; limit?: number; kinds?: HistoryEventKind[]; subject?: string } = {}): Promise<HistoryEvent[]> {
      const r = await t.zeeli<{ events: RawEvent[] }>('stats', 'events', {
        since: String(options.since ? Math.floor(options.since.getTime() / 1000) : 0),
        limit: String(options.limit ?? 100),
        kinds: options.kinds ?? [],
        subject: options.subject ?? '',
      });
      return r.events.map(toEvent);
    },

    /** Unread alerts, newest first, and the kinds that raise them. */
    async alerts(): Promise<AlertState> {
      return alertState(await t.zeeli('stats', 'alerts'));
    },
    async acknowledge(ids: number[]): Promise<AlertState> {
      return alertState(await t.zeeli('stats', 'alerts', { ack: ids.map(String) }));
    },
    async acknowledgeAll(): Promise<AlertState> {
      return alertState(await t.zeeli('stats', 'alerts', { all: true }));
    },
    async setAlertKinds(kinds: HistoryEventKind[]): Promise<AlertState> {
      return alertState(await t.zeeli('stats', 'alerts', { save: true, kinds }));
    },

    async settings(): Promise<HistorySettings> {
      return settingsOf(await t.zeeli('stats', 'settings'));
    },
    async saveSettings(values: HistorySettings): Promise<HistorySettings> {
      return settingsOf(await t.zeeli('stats', 'settings', { save: true, target: values.target, tempHigh: String(values.tempHigh) }));
    },
  };
};
