import { settings } from '../settings.ts';
import type { Transport } from '../transport/types.ts';
import { writeAndVerify } from '../verify.ts';

/* ---------- uplinks ---------- */

export const UPLINKS = [
  { id: 'wwan', name: 'Repeater', kind: 'wifi' },
  { id: 'wan', name: 'Ethernet 1', kind: 'wired' },
  { id: 'secondwan', name: 'Ethernet 2', kind: 'wired' },
  { id: 'tethering', name: 'Tethering', kind: 'phone' },
  { id: 'modem_1_1_2', name: 'Cellular', kind: 'cellular' },
] as const;
export type UplinkId = (typeof UPLINKS)[number]['id'];
export const uplinkName = (id: string) => UPLINKS.find((u) => u.id === id)?.name ?? id;

/* ---------- repeater ---------- */

export interface RepeaterStatus {
  connected: boolean;
  ssid: string;
  band: string;
  channel: number;
  dfs: boolean;
  signal: number | null;
  generation: string;
  htmode: string;
  ip: string;
  gateway: string;
  dns: string[];
  connectedFor: string;
  mac: string;
  randomMac: boolean;
}

interface RawRepeaterStatus {
  state_s?: string;
  ssid?: string;
  band?: string;
  channel?: number;
  dfs?: boolean;
  signal?: number;
  wifi_generation?: string;
  htmode?: string;
  ipv4?: { ip?: string; gateway?: string; dns?: string[] };
  connected?: string;
  macaddr?: string;
  config?: { macaddr?: { mode?: string } };
}

export interface ScannedNetwork {
  ssid: string;
  bssid: string;
  band: string;
  channel: number;
  signal: number | null;
  open: boolean;
}

export interface SavedNetwork {
  ssid: string;
  protocol: string;
  randomMac: boolean;
}

export interface RepeaterConfig {
  auto: boolean;
  lock_band: string;
}

/* ---------- WAN (Ethernet) ---------- */

export type WanProtocol = 'dhcp' | 'pppoe' | 'static';
export interface WanConfig {
  protocol: WanProtocol;
  username?: string;
  password?: string;
  ipv4?: { ip: string; netmask: string; gateway: string; dns: string[] };
}

/* ---------- ports ---------- */

export type MacMode = 'default' | 'clone' | 'random';
export type VlanMode = 'Standard' | 'Multiple VLANs';

export interface EthernetPort {
  name: string;
  label: string;
  role: 'wan' | 'lan';
  defaultRole: 'wan' | 'lan';
  canBeWan: boolean;
  mac: { mode: MacMode; address: string; own: string } | null;
  speedMbps: number | null;
  vlanMode: VlanMode | null;
  untagged: number | null;
  tagged: number[];
}

interface RawPortConfig {
  name: string;
  silk: string;
  mode: 'wan' | 'lan';
  default_mode: 'wan' | 'lan';
  support_wan?: string;
  macaddr?: { mode: MacMode; macaddr: string; defmacaddr: string };
}
interface RawPortStatus {
  name: string;
  speed?: number;
  vlan_mode?: VlanMode;
  pvid?: number;
  trunk_tag?: number[];
}

/* ---------- multi-WAN ---------- */

export interface MultiWanUplink {
  id: string;
  metric: number;
  weight: number;
  online: boolean;
  healthCheck: boolean;
  pingTargets: string[];
}
export interface MultiWan {
  /** 0 failover in order, 1 load balance by weight */
  mode: 0 | 1;
  uplinks: MultiWanUplink[];
  sensitivity: number | null;
}

export const internet = (t: Transport) => ({
  async repeater(): Promise<RepeaterStatus | null> {
    const r = await t.call<RawRepeaterStatus>('repeater', 'get_status').catch(() => null);
    if (!r) return null;
    return {
      connected: r.state_s === 'connected',
      ssid: r.ssid ?? '',
      band: r.band ?? '',
      channel: r.channel ?? 0,
      dfs: Boolean(r.dfs),
      signal: r.signal ?? null,
      generation: r.wifi_generation ?? '',
      htmode: r.htmode ?? '',
      ip: (r.ipv4?.ip ?? '').split('/')[0] ?? '',
      gateway: r.ipv4?.gateway ?? '',
      dns: r.ipv4?.dns ?? [],
      connectedFor: r.connected ?? '',
      mac: (r.macaddr ?? '').toUpperCase(),
      randomMac: r.config?.macaddr?.mode === 'random',
    };
  },
  repeaterConfig: settings<RepeaterConfig>(t, 'repeater'),
  async saved(): Promise<SavedNetwork[]> {
    const r = await t.call<{ res?: { ssid: string; protocol?: string; macaddr?: { mode?: string } }[] }>('repeater', 'get_saved_ap_list');
    return (r.res ?? []).map((n) => ({ ssid: n.ssid, protocol: n.protocol || 'dhcp', randomMac: n.macaddr?.mode === 'random' }));
  },
  async scan(): Promise<ScannedNetwork[]> {
    const r = await t.call<{
      res?: {
        ssid?: string;
        bssid?: string;
        band?: string;
        channel?: number;
        signal?: number;
        encryption?: { enabled?: boolean } | string;
      }[];
    }>('repeater', 'scan', { refresh: true }, 120_000);
    return (r.res ?? [])
      .map((n) => ({
        ssid: n.ssid ?? '',
        bssid: n.bssid ?? '',
        band: n.band ?? '',
        channel: n.channel ?? 0,
        signal: n.signal ?? null,
        open: n.encryption === 'none' || (typeof n.encryption === 'object' && n.encryption.enabled === false),
      }))
      .sort((a, b) => (b.signal ?? -100) - (a.signal ?? -100));
  },
  join: (n: { ssid: string; key?: string; bssid?: string }) => t.call('repeater', 'connect', { ...n, remember: true }, 30_000),
  disconnect: () => t.call('repeater', 'disconnect'),
  forget: (ssid: string) => t.call('repeater', 'remove_saved_ap', { ssid }),
  async forgetAll(ssids: string[]) {
    for (const ssid of ssids) await t.call('repeater', 'remove_saved_ap', { ssid });
  },

  wan: settings<WanConfig>(t, 'cable', { timeoutMs: 60_000, writeOnly: ['password'] }),
  tethering: () => t.call<{ devices?: unknown[]; status?: number }>('tethering', 'get_status').catch(() => ({ devices: [], status: 0 })),

  async ports(): Promise<EthernetPort[]> {
    const [cfg, st] = await Promise.all([
      t.call<{ ports?: RawPortConfig[] }>('cable', 'get_ports_config'),
      t.call<{ ports?: RawPortStatus[] }>('cable', 'get_ports_status'),
    ]);
    return (cfg.ports ?? []).map((p) => {
      const s = st.ports?.find((x) => x.name === p.name);
      return {
        name: p.name,
        label: p.silk,
        role: p.mode,
        defaultRole: p.default_mode,
        canBeWan: p.support_wan === '1',
        mac: p.macaddr ? { mode: p.macaddr.mode, address: p.macaddr.macaddr.toUpperCase(), own: p.macaddr.defmacaddr.toUpperCase() } : null,
        speedMbps: s?.speed ?? null,
        vlanMode: s?.vlan_mode ?? null,
        untagged: s?.pvid ?? null,
        tagged: (s?.trunk_tag ?? []).map(Number),
      };
    });
  },
  setPortRole: (port: EthernetPort, role: 'wan' | 'lan') =>
    t.call(
      'cable',
      'set_port_config',
      role === 'wan'
        ? { name: port.name, mode: 'wan' }
        : { name: port.name, mode: 'lan', vlan_mode: port.vlanMode ?? 'Standard', pvid: port.untagged ?? 1 },
      60_000,
    ),
  setPortMac: (port: EthernetPort, mode: MacMode, address: string) =>
    t.call(
      'cable',
      'set_port_config',
      {
        name: port.name,
        mode: 'wan',
        macaddr: mode === 'random' ? { mode, macaddr: address, update: 'none' } : { mode, macaddr: address },
      },
      60_000,
    ),
  setPortVlans: (port: EthernetPort, vlanMode: VlanMode, untagged: number, tagged: number[]) =>
    t.call(
      'cable',
      'set_port_config',
      {
        name: port.name,
        mode: 'lan',
        vlan_mode: vlanMode,
        pvid: untagged,
        ...(vlanMode === 'Multiple VLANs' ? { trunk_tag: tagged.filter((v) => v !== untagged) } : {}),
      },
      60_000,
    ),

  async multiWan(): Promise<MultiWan> {
    const [cfg, status, sens] = await Promise.all([
      t.call<{
        mode: 0 | 1;
        interfaces: { interface: string; metric: number; weight: number; enable_check: boolean; track_ipv4?: string[] }[];
      }>('kmwan', 'get_config'),
      t.call<{ interfaces?: { interface: string; status_v4: number }[] }>('kmwan', 'get_status'),
      t.call<{ sensitivity?: { val: number } }>('kmwan', 'get_sensitivity').catch(() => null),
    ]);
    return {
      mode: cfg.mode,
      sensitivity: sens?.sensitivity?.val ?? null,
      uplinks: [...cfg.interfaces]
        .sort((a, b) => a.metric - b.metric)
        .map((i) => ({
          id: i.interface,
          metric: i.metric,
          weight: i.weight,
          online: status.interfaces?.find((s) => s.interface === i.interface)?.status_v4 === 0,
          healthCheck: i.enable_check,
          pingTargets: i.track_ipv4 ?? [],
        })),
    };
  },
  setMultiWan: (mode: 0 | 1, order: { id: string; weight: number }[]) =>
    t.call(
      'kmwan',
      'set_config',
      {
        mode,
        interfaces:
          mode === 0
            ? order.map((u, i) => ({ interface: u.id, metric: i + 1 }))
            : order.map((u) => ({ interface: u.id, weight: u.weight })),
      },
      30_000,
    ),
  setSensitivity: (val: number) =>
    writeAndVerify(
      () => t.call('kmwan', 'set_sensitivity', { val }),
      () => t.call<{ sensitivity?: { val: number } }>('kmwan', 'get_sensitivity'),
      (r) => r.sensitivity?.val === val,
      'the switch-over speed',
    ),
});
