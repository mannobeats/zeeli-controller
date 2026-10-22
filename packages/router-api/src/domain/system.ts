import type { Transport } from '../transport/types.ts';

export interface RouterInfo {
  model: string;
  hostname: string;
  firmware: string;
  firmwareDate: string;
  openwrt: string;
  kernel: string;
  architecture: string;
  mac: string;
  serial: string;
  cpuCount: number;
  features: Record<string, boolean | string | number>;
  hardware: Record<string, boolean | string | number>;
}

export interface ServiceState {
  name: string;
  running: boolean;
}

export interface WifiSummary {
  name: string;
  band: string;
  ssid: string;
  up: boolean;
  guest: boolean;
  iot: boolean;
  mld: boolean;
  hidden: boolean;
  channel: number;
  encryption: string;
}

export interface Uplink {
  interface: string;
  up: boolean;
  online: boolean;
}

export interface RouterStatus {
  uptime: number;
  load: number[];
  cpuTemp: number | null;
  memory: { total: number; free: number; cache: number };
  flash: { total: number; free: number };
  lanIp: string;
  lanNetmask: string;
  mode: number;
  services: ServiceState[];
  wifi: WifiSummary[];
  uplinks: Uplink[];
  clients: { wired: number; wireless: number };
  flags: Record<string, boolean>;
  /** Seconds since epoch on the router, and its UTC offset like "-0400". */
  timestamp: number;
  tzoffset: string;
}

interface RawInfo {
  model: string;
  firmware_version: string;
  firmware_date: string;
  mac: string;
  sn: string;
  cpu_num: number;
  board_info: { hostname: string; model: string; openwrt_version: string; kernel_version: string; architecture: string };
  software_feature?: Record<string, boolean | string | number>;
  hardware_feature?: Record<string, boolean | string | number>;
}

interface RawStatus {
  service?: { name: string; status: number }[];
  client?: { wireless_total: number; cable_total: number }[];
  wifi?: {
    name: string;
    band: string;
    ssid: string;
    up: boolean;
    guest: boolean;
    iot: boolean;
    mld: boolean;
    hidden: boolean;
    channel: number;
    encryption: string;
  }[];
  network?: { interface: string; up: boolean; online: boolean }[];
  system: {
    uptime: number;
    load_average?: number[];
    cpu?: { temperature?: number };
    memory_total: number;
    memory_free: number;
    memory_buff_cache: number;
    flash_total: number;
    flash_free: number;
    lan_ip: string;
    lan_netmask: string;
    mode: number;
    timestamp: number;
    tzoffset?: string;
    [flag: string]: unknown;
  };
}

const FLAG_KEYS = [
  'ipv6_enabled',
  'ddns_enabled',
  'sqm_enabled',
  'qos_enabled',
  'netnat_enabled',
  'flow_statistics_enabled',
  'content_protection_enabled',
] as const;

export const system = (t: Transport) => ({
  async info(): Promise<RouterInfo> {
    const r = await t.call<RawInfo>('system', 'get_info');
    return {
      model: r.board_info.model.replace(/^GL\.iNet\s+/, ''),
      hostname: r.board_info.hostname,
      firmware: r.firmware_version,
      firmwareDate: r.firmware_date,
      openwrt: r.board_info.openwrt_version,
      kernel: r.board_info.kernel_version,
      architecture: r.board_info.architecture,
      mac: r.mac,
      serial: r.sn,
      cpuCount: r.cpu_num,
      features: r.software_feature ?? {},
      hardware: r.hardware_feature ?? {},
    };
  },

  async status(): Promise<RouterStatus> {
    const r = await t.call<RawStatus>('system', 'get_status');
    const s = r.system;
    return {
      uptime: s.uptime,
      load: s.load_average ?? [],
      cpuTemp: s.cpu?.temperature ?? null,
      memory: { total: s.memory_total, free: s.memory_free, cache: s.memory_buff_cache },
      flash: { total: s.flash_total, free: s.flash_free },
      lanIp: s.lan_ip,
      lanNetmask: s.lan_netmask,
      mode: s.mode,
      services: (r.service ?? []).map((x) => ({ name: x.name, running: x.status === 1 })),
      wifi: r.wifi ?? [],
      uplinks: r.network ?? [],
      clients: { wired: r.client?.[0]?.cable_total ?? 0, wireless: r.client?.[0]?.wireless_total ?? 0 },
      flags: Object.fromEntries(FLAG_KEYS.map((k) => [k.replace(/_enabled$/, ''), Boolean(s[k])])),
      timestamp: s.timestamp,
      tzoffset: s.tzoffset ?? '+0000',
    };
  },

  fan: () => t.call<{ speed: number; status: boolean }>('fan', 'get_status'),
  reboot: () => t.call('system', 'reboot', { delay: 1 }),
});
