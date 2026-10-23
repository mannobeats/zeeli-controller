import {
  BAND_RADIO,
  checkOwnWifi,
  type JoinableNetwork,
  OWN_BANDS,
  type OwnBand,
  type OwnWifi,
  type OwnWifiInput,
  type WifiEntry,
  type WifiOptions,
  type WifiSchedule,
} from '../domain/wifi-networks.ts';
import type { Handler } from './handlers.ts';
import type { MockState } from './seed.ts';

const LIMIT = 17;

interface Demo {
  own: OwnWifi[];
  passwords: Map<string, string>;
  /** Saved but not applied yet. */
  pending: boolean;
  seq: number;
}

const OPTIONS: WifiOptions = {
  fastRoaming: false,
  rrm: true,
  bssTransition: true,
  maxClients: null,
  multicastToUnicast: false,
  dtim: null,
};

const own = (id: string, ssid: string, bands: OwnBand[], network: string, extra: Partial<OwnWifi> = {}): OwnWifi => ({
  id,
  owner: 'zeeli',
  role: null,
  ssid,
  bands,
  network,
  security: 'sae-mixed',
  hidden: false,
  isolate: false,
  disabled: false,
  hasKey: true,
  mlo: false,
  scheduledOff: false,
  options: OPTIONS,
  schedule: null,
  ...extra,
});

const fw = (id: string, role: string, ssid: string, band: OwnBand, network: string, extra: Partial<WifiEntry> = {}): WifiEntry => ({
  id,
  owner: 'firmware',
  role,
  ssid,
  bands: [band],
  network,
  security: 'sae-mixed',
  hidden: false,
  isolate: role !== 'main',
  disabled: false,
  hasKey: true,
  ...extra,
});

/** The router's own slots, as the agent lists them (the console edits these through GL's API). */
const FIRMWARE: WifiEntry[] = [
  fw('wifi2g', 'main', 'Zeeli Home', '2g', 'main'),
  fw('wifi5g', 'main', 'Zeeli Home', '5g', 'main'),
  fw('wifi6g', 'main', 'Zeeli Home 6', '6g', 'main', { security: 'sae' }),
  fw('guest2g', 'guest', 'Zeeli Guest', '2g', 'guest', { disabled: true }),
  fw('guest5g', 'guest', 'Zeeli Guest', '5g', 'guest'),
  fw('iot2g', 'iot', 'Zeeli Things', '2g', 'iot', { security: 'psk2' }),
];
/** The MLO links and the mesh backhaul take slots too. */
const HIDDEN_SLOTS: Record<OwnBand, number> = { '2g': 2, '5g': 3, '6g': 2 };

function seedDemo(): Demo {
  return {
    own: [
      own('kids01', 'Kids', ['5g'], 'Kids', {
        isolate: true,
        schedule: { enabled: true, days: ['sun', 'mon', 'tue', 'wed', 'thu'], off: '21:00', on: '07:00' },
      }),
      own('shop01', 'Workshop', ['2g', '5g'], 'Lab', { security: 'psk2', hidden: true, options: { ...OPTIONS, maxClients: 12 } }),
    ],
    passwords: new Map([
      ['kids01', 'dino-nuggets-42'],
      ['shop01', 'solder and code'],
    ]),
    pending: false,
    seq: 1,
  };
}

const demo = (s: MockState): Demo => {
  const found = s.extra.get('zeeli-wifi') as Demo | undefined;
  if (found) return found;
  const fresh = seedDemo();
  s.extra.set('zeeli-wifi', fresh);
  return fresh;
};

/** Networks one can join: the demo's subnets, under the names the networks page uses. */
const joinable = (s: MockState): JoinableNetwork[] =>
  s.subnets.map((n) => ({
    id: n.display_name,
    iface: n.display_name === 'main' ? 'lan' : n.display_name,
    device: `br-${n.display_name}`,
    disabled: !n.enabled,
  }));

const bandsUsed = (d: Demo, band: OwnBand, skip?: string) =>
  FIRMWARE.filter((n) => n.bands[0] === band).length +
  HIDDEN_SLOTS[band] +
  d.own.filter((n) => n.id !== skip && n.bands.includes(band)).length;

/** The agent's checks for a whole network; `self` is the one being edited. */
function problem(s: MockState, d: Demo, input: OwnWifiInput, self?: string): string | null {
  const bad = checkOwnWifi(input);
  if (bad) return bad;
  const net = joinable(s).find((n) => n.id === input.network || n.iface === input.network);
  if (!net) return 'That network doesn’t exist on the router.';
  if (net.disabled) return `The ${net.id} network is switched off. Turn it on first.`;
  for (const band of input.bands) {
    if (bandsUsed(d, band, self) >= LIMIT) return `The ${BAND_RADIO[band]} radio is full: it holds ${LIMIT} networks.`;
    const clash = [...FIRMWARE, ...d.own.filter((n) => n.id !== self)].some((n) => n.bands.includes(band) && n.ssid === input.ssid);
    if (clash) return `Another network on ${BAND_RADIO[band]} is already called “${input.ssid}”.`;
  }
  return null;
}

/** The agent stores 0 as "not set" and lists it as null. */
const withOptions = (...parts: (Partial<WifiOptions> | undefined)[]): WifiOptions => {
  const o = Object.assign({}, OPTIONS, ...parts) as WifiOptions;
  return { ...o, maxClients: o.maxClients || null, dtim: o.dtim || null };
};

const find = (d: Demo, id: unknown) => d.own.find((n) => n.id === id);
const missing = { error: 'That network doesn’t exist, or it belongs to the router’s own settings.' };

/** `zeeli.wifi` on the demo router. */
export const agentWifi: Record<string, Handler> = {
  'zeeli:wifi.list': (s) => {
    const d = demo(s);
    return {
      networks: [...FIRMWARE, ...d.own],
      radios: OWN_BANDS.map((band, i) => ({ device: `wifi${i}`, band, disabled: false, used: bandsUsed(d, band), limit: LIMIT })),
      lanNetworks: joinable(s),
      mlo: { supported: true, bands: [...OWN_BANDS], reason: null },
      internal: [],
      pending: d.pending,
    };
  },
  'zeeli:wifi.reveal': (s, a) => {
    const d = demo(s);
    return find(d, a.id) ? { password: d.passwords.get(String(a.id)) ?? '' } : missing;
  },
  'zeeli:wifi.create': (s, a) => {
    const d = demo(s);
    const input = { ...a, security: a.security ?? (a.mlo ? 'sae' : 'sae-mixed') } as unknown as OwnWifiInput;
    const bad = problem(s, d, input);
    if (bad) return { error: bad };
    const id = `net${String(++d.seq).padStart(2, '0')}${Math.random().toString(36).slice(2, 4)}`;
    d.own.push(
      own(id, input.ssid, [...input.bands].sort(), input.network, {
        mlo: Boolean(input.mlo),
        security: input.security,
        hidden: Boolean(input.hidden),
        isolate: Boolean(input.isolate),
        options: withOptions(input.options),
        schedule: input.schedule ?? null,
      }),
    );
    d.passwords.set(id, input.password);
    d.pending = true;
    return { pending: true, id };
  },
  'zeeli:wifi.update': (s, a) => {
    const d = demo(s);
    const n = find(d, a.id);
    if (!n) return missing;
    const next = { ...n, ...(a as Partial<OwnWifi>), options: withOptions(n.options, a.options as Partial<WifiOptions> | undefined) };
    if (n.mlo && next.network !== n.network)
      return { error: 'A multi-link network can’t move to another network. Delete it and make it again there.' };
    if (n.mlo && [...next.bands].sort().join() !== [...n.bands].sort().join())
      return { error: 'A multi-link network can’t change its bands. Delete it and make it again with the bands you want.' };
    const password = typeof a.password === 'string' ? a.password : (d.passwords.get(n.id) ?? '');
    const bad = problem(s, d, { ...next, password, schedule: n.schedule }, n.id);
    if (bad) return { error: bad };
    Object.assign(n, {
      ssid: next.ssid,
      bands: [...next.bands].sort(),
      network: next.network,
      security: next.security,
      hidden: next.hidden,
      isolate: next.isolate,
      options: next.options,
    });
    d.passwords.set(n.id, password);
    d.pending = true;
    return { pending: true, id: n.id };
  },
  'zeeli:wifi.delete': (s, a) => {
    const d = demo(s);
    if (!find(d, a.id)) return missing;
    d.own = d.own.filter((n) => n.id !== a.id);
    d.pending = true;
    return { pending: true };
  },
  'zeeli:wifi.set_enabled': (s, a) => {
    const n = find(demo(s), a.id);
    if (!n) return missing;
    Object.assign(n, { disabled: !a.enabled, scheduledOff: false });
    demo(s).pending = true;
    return { pending: true };
  },
  'zeeli:wifi.apply': (s) => {
    demo(s).pending = false;
    return { applied: true };
  },
  'zeeli:wifi.set_schedule': (s, a) => {
    const n = find(demo(s), a.id);
    if (!n) return missing;
    n.schedule = { enabled: a.enabled !== false, days: a.days as WifiSchedule['days'], off: String(a.off), on: String(a.on) };
    return { schedule: n.schedule };
  },
  'zeeli:wifi.clear_schedule': (s, a) => {
    const n = find(demo(s), a.id);
    if (!n) return missing;
    Object.assign(n, { schedule: null, scheduledOff: false });
    return { pending: false };
  },
};
