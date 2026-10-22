import type { Transport } from '../transport/types.ts';
import { writeAndVerify } from '../verify.ts';

export type Band = '2.4' | '5' | '6' | 'mlo';
export type Medium = 'wired' | 'wifi';

export interface Link {
  label: string;
  medium: Medium;
  band: Band | null;
  guest: boolean;
}

/** clients.get_list `type`, from the stock panel's link table. */
const LINKS: Record<number, [string, Medium, Band | null, boolean]> = {
  0: ['2.4 GHz', 'wifi', '2.4', false],
  1: ['5 GHz', 'wifi', '5', false],
  2: ['Wired', 'wired', null, false],
  3: ['2.4 GHz guest', 'wifi', '2.4', true],
  4: ['5 GHz guest', 'wifi', '5', true],
  7: ['EdgeRouter', 'wired', null, false],
  8: ['OpenVPN TAP', 'wired', null, false],
  9: ['MLO', 'wifi', 'mlo', false],
  10: ['MLO guest', 'wifi', 'mlo', true],
  11: ['6 GHz', 'wifi', '6', false],
  12: ['6 GHz guest', 'wifi', '6', true],
  13: ['USB tethering', 'wired', null, false],
  15: ['2.4 GHz IoT', 'wifi', '2.4', false],
  16: ['5 GHz IoT', 'wifi', '5', false],
  17: ['Wired guest', 'wired', null, true],
  18: ['Wired IoT', 'wired', null, false],
  19: ['Wired, custom', 'wired', null, false],
};

export const linkOf = (type: number): Link => {
  const [label, medium, band, guest] = LINKS[type] ?? ['Unknown', 'wired', null, false];
  return { label, medium, band, guest };
};

/** clients.set_info `class` values the firmware accepts. */
export const DEVICE_CLASSES = [
  'computer',
  'laptop',
  'phone',
  'pad',
  'watch',
  'television',
  'sound',
  'camera',
  'printer',
  'games',
  'smartappliances',
  'nas',
  'server',
  'switch',
  'gateway',
] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number] | '';

export interface Client {
  mac: string;
  ip: string;
  ipv6: string[];
  /** The name you gave it, else the name it announced, else its MAC. */
  name: string;
  alias: string;
  hostname: string;
  deviceClass: DeviceClass;
  online: boolean;
  /** Seconds since epoch: when it connected, or when it was last seen. */
  since: number;
  link: Link;
  type: number;
  rx: number;
  tx: number;
  totalRx: number;
  totalTx: number;
  limitRx: number;
  limitTx: number;
  blocked: boolean;
  remote: boolean;
  iface: string;
}

interface RawClient {
  mac: string;
  ip: string;
  ipv6?: string[];
  name: string;
  alias: string;
  class?: string;
  online: boolean;
  online_time: number;
  type: number;
  rx: number;
  tx: number;
  total_rx: string | number;
  total_tx: string | number;
  limit_rx: number;
  limit_tx: number;
  blocked: boolean;
  remote: boolean;
  iface: string;
}

const toClient = (c: RawClient): Client => ({
  mac: c.mac.toUpperCase(),
  ip: c.ip,
  ipv6: c.ipv6 ?? [],
  name: c.alias || c.name || c.mac.toUpperCase(),
  alias: c.alias,
  hostname: c.name,
  deviceClass: (c.class ?? '') as DeviceClass,
  online: c.online,
  since: c.online_time,
  link: linkOf(c.type),
  type: c.type,
  rx: c.rx,
  tx: c.tx,
  totalRx: Number(c.total_rx) || 0,
  totalTx: Number(c.total_tx) || 0,
  limitRx: c.limit_rx,
  limitTx: c.limit_tx,
  blocked: c.blocked,
  remote: c.remote,
  iface: c.iface,
});

/** QoS speed limits are KiB/s on the router; people think in Mbps. */
export const KIB_PER_MBPS = 1e6 / 8 / 1024;

export type AccessMode = 'black' | 'white';
export interface AccessList {
  mode: AccessMode;
  blocked: string[];
  allowed: string[];
}

export const clients = (t: Transport) => {
  const access = async (): Promise<AccessList> => {
    const r = await t.call<{ mode: AccessMode; black_mac?: string[]; white_mac?: string[] }>('black_white_list', 'get_config');
    return {
      mode: r.mode,
      blocked: (r.black_mac ?? []).map((m) => m.toUpperCase()),
      allowed: (r.white_mac ?? []).map((m) => m.toUpperCase()),
    };
  };

  const api = {
    async list(): Promise<Client[]> {
      const r = await t.call<{ clients?: RawClient[] }>('clients', 'get_list');
      return (r.clients ?? []).map(toClient);
    },

    access,

    /** Rename and/or set the device type. */
    setInfo: (mac: string, alias: string, deviceClass: DeviceClass) => t.call('clients', 'set_info', { mac, alias, class: deviceClass }),

    /** Mbps, 0 for no limit in that direction. Both 0 removes the rule. */
    setSpeedLimit: (mac: string, downMbps: number, upMbps: number) =>
      downMbps || upMbps
        ? t.call(
            'qos',
            'set_speed_limit_rule',
            { mac, download: Math.round(downMbps * KIB_PER_MBPS), upload: Math.round(upMbps * KIB_PER_MBPS) },
            30_000,
          )
        : t.call('qos', 'remove_speed_limit_rule', { mac }, 30_000),

    /**
     * Block or unblock many devices in one write. The firmware stores the block list as
     * one array, so this merges with what is there and checks the result.
     */
    async setBlocked(macs: string[], blocked: boolean) {
      const current = await access();
      if (current.mode !== 'black') throw new Error('Access control is in allow-list mode. Change it in Security → Access control.');
      const set = new Set(current.blocked);
      for (const m of macs) blocked ? set.add(m.toUpperCase()) : set.delete(m.toUpperCase());
      await writeAndVerify(
        () => t.call('black_white_list', 'set_config', { mode: 'black', mac: [...set] }),
        access,
        (a) => macs.every((m) => a.blocked.includes(m.toUpperCase()) === blocked),
        'the block list',
      );
    },

    /** Forget offline devices: their name, type and usage history go away. */
    async forget(macs: string[]) {
      for (const mac of macs) await t.call('clients', 'remove_offline', { mac });
    },

    resetTraffic: () => t.call('clients', 'clean_traffic'),
    autoForget: async () => Boolean((await t.call<{ auto_remove_offline?: boolean }>('clients', 'get_status')).auto_remove_offline),
    setAutoForget: (on: boolean) =>
      writeAndVerify(
        () => t.call('clients', 'set_cache_offline', { auto_remove_offline: on }),
        api.autoForget,
        (v) => v === on,
      ),
  };
  return api;
};
