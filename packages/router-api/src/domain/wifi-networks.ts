import type { Transport } from '../transport/types.ts';

export const OWN_BANDS = ['2g', '5g', '6g'] as const;
export type OwnBand = (typeof OWN_BANDS)[number];

/** What a network made here can use: WPA3, WPA2/WPA3 or WPA2. 6 GHz takes WPA3 only. */
export const OWN_SECURITY = ['sae', 'sae-mixed', 'psk2'] as const;
export type OwnSecurity = (typeof OWN_SECURITY)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Per-network radio options; `null` means the radio's own default. */
export interface WifiOptions {
  /** 802.11r: devices move between bands and routers without dropping. */
  fastRoaming: boolean;
  /** 802.11k: tells devices about better radios to move to. */
  rrm: boolean;
  /** 802.11v: the router can ask a device to move. */
  bssTransition: boolean;
  maxClients: number | null;
  multicastToUnicast: boolean;
  /** Beacons between wake-ups for sleeping devices, 1 to 10. */
  dtim: number | null;
}

export interface WifiSchedule {
  enabled: boolean;
  days: Weekday[];
  /** Local router time, `22:00`. The window may run past midnight. */
  off: string;
  on: string;
}

/** One access point the agent knows, or a group of them for a network made here. */
export interface WifiEntry {
  /** A network made here: its short id. The router's own: the UCI section name. */
  id: string;
  owner: 'zeeli' | 'firmware';
  /** For the router's own: main, guest, iot, mlo, mlo-guest or other. */
  role: string | null;
  ssid: string;
  bands: string[];
  /** The networks page's name for the network it joins: `main`, `guest` or a custom name. */
  network: string;
  security: string;
  hidden: boolean;
  isolate: boolean;
  disabled: boolean;
  hasKey: boolean;
}

/** A network made here. */
export interface OwnWifi extends WifiEntry {
  owner: 'zeeli';
  bands: OwnBand[];
  security: OwnSecurity;
  /** One multi-link (Wi-Fi 7) network across its bands, rather than one network per band. */
  mlo: boolean;
  /** Held off by its schedule right now. */
  scheduledOff: boolean;
  options: WifiOptions;
  schedule: WifiSchedule | null;
}

export interface RadioSlots {
  device: string;
  band: OwnBand;
  disabled: boolean;
  used: number;
  limit: number;
}

/** A network a WiFi network can join: one with a bridge. */
export interface JoinableNetwork {
  id: string;
  iface: string;
  device: string;
  disabled: boolean;
}

/** Whether the router can make another multi-link network. `reason` says why not, for the person. */
export interface MloSupport {
  supported: boolean;
  /** The bands the firmware lets a multi-link network join. */
  bands: OwnBand[];
  reason: string | null;
}

export interface WifiOverview {
  networks: WifiEntry[];
  radios: RadioSlots[];
  mlo: MloSupport;
  /** A multi-link network was deleted and stays on the air until the router restarts. WiFi can’t be applied until then. */
  restartNeeded: boolean;
  /** The names of the networks waiting for that restart. */
  restartFor: string[];
  lanNetworks: JoinableNetwork[];
  /** Changes saved on the router but not yet loaded into the radios. */
  pending: boolean;
}

export interface OwnWifiInput {
  ssid: string;
  password: string;
  bands: OwnBand[];
  network: string;
  security: OwnSecurity;
  hidden: boolean;
  isolate: boolean;
  options: Partial<WifiOptions>;
  schedule?: WifiSchedule | null;
  /** One multi-link network over two or more bands. Needs WPA3; can’t be changed once made, and goes only at a restart. */
  mlo?: boolean;
}

export const isOwn = (n: WifiEntry): n is OwnWifi => n.owner === 'zeeli';

export const BAND_RADIO: Record<OwnBand, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' };

/**
 * The agent's limits, so a form can say no before asking, in the agent's own words: SSIDs are
 * bytes, keys are printable ASCII. Leave `password` out to skip it (an edit that keeps the key).
 */
export function checkOwnWifi(input: Pick<OwnWifiInput, 'ssid' | 'bands' | 'security' | 'mlo'> & { password?: string }): string | null {
  const bytes = new TextEncoder().encode(input.ssid).length;
  if (bytes < 1 || bytes > 32) return 'The network name must be 1 to 32 bytes.';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that's exactly what is being refused
  if (/[\x00-\x1f\x7f]/.test(input.ssid)) return 'The network name can’t contain control characters.';
  const pw = input.password;
  if (pw !== undefined && (pw.length < 8 || pw.length > 63)) return 'The password must be 8 to 63 characters.';
  if (pw !== undefined && !/^[\x20-\x7e]+$/.test(pw)) return 'The password can only use plain letters, numbers, spaces and punctuation.';
  if (!input.bands.length) return 'Pick at least one band.';
  if (input.mlo && input.bands.length < 2) return 'Multi-link needs at least two bands.';
  if (input.mlo && input.security !== 'sae') return 'Multi-link networks need WPA3.';
  if (input.bands.includes('6g') && input.security !== 'sae') return '6 GHz needs WPA3. Choose WPA3, or leave 6 GHz out.';
  return null;
}

/** The agent reads 0 as "the radio's default", because a JSON null doesn't survive the bus. */
const wire = (o: Partial<WifiOptions>) => ({
  ...o,
  ...('maxClients' in o ? { maxClients: o.maxClients ?? 0 } : {}),
  ...('dtim' in o ? { dtim: o.dtim ?? 0 } : {}),
});

export const wifiNetworks = (t: Transport) => {
  const call = <T>(method: string, args?: object, timeoutMs?: number) => t.zeeli<T>('wifi', method, args, timeoutMs);
  return {
    overview: () => call<WifiOverview>('list'),
    /** The password of a network made here; the only way to read one. */
    reveal: (id: string) => call<{ password: string }>('reveal', { id }).then((r) => r.password),
    create: ({ schedule, options, ...input }: OwnWifiInput) =>
      call<{ id: string }>('create', { ...input, options: wire(options), ...(schedule ? { schedule } : {}) }),
    /** Anything left out stays as it is; no password keeps the current one. */
    update: (id: string, { options, ...patch }: Partial<Omit<OwnWifiInput, 'schedule'>>) =>
      call('update', { id, ...patch, ...(options ? { options: wire(options) } : {}) }),
    /** A multi-link network answers `restartNeeded`: it only goes at the next restart. */
    remove: (id: string) => call<{ restartNeeded?: boolean }>('delete', { id }),
    setEnabled: (id: string, enabled: boolean) => call('set_enabled', { id, enabled }),
    setSchedule: (id: string, schedule: WifiSchedule | null) =>
      schedule ? call('set_schedule', { id, ...schedule }) : call('clear_schedule', { id }),
    /** Load every saved change into the radios. Devices on changed networks reconnect briefly. */
    apply: () => call('apply', {}, 90_000),
  };
};
