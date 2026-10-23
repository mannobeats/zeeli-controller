import { settings } from '../settings.ts';
import type { Transport } from '../transport/types.ts';

export interface Ipv6Config {
  enable: boolean;
  lan_mode: 'nat6' | 'relay' | 'native' | 'static';
  lan_ip?: string;
  lan_dns_mode: boolean;
  lan_dns1?: string;
  lan_dns2?: string;
}

export interface NetNat {
  enable: boolean;
  dpi_enabled?: boolean;
  conflict_features?: string[];
  [key: string]: unknown;
}

export interface MeshNode {
  mac: string;
  model: string;
  signal: number | null;
}

/** A node that has joined the mesh. */
export interface MeshMember {
  mac: string;
  name: string;
  model: string;
  ip: string;
  /** This router (the controller) is listed too; it can’t be removed or rebooted from here. */
  self: boolean;
  online: boolean;
  /** How the node reaches the controller. */
  backhaul: 'wired' | 'wireless' | null;
  band: string | null;
  /** dBm, for a wireless backhaul. */
  signal: number | null;
  clients: number;
  /** Seconds, when the node reports it. */
  uptime: number | null;
}

/**
 * GL’s `mesh.get_topology` answer. The shape isn’t documented and mesh was off when it was
 * studied, so every field is read under the names its other methods and the firmware’s
 * scripts use, and a missing one stays empty rather than failing the page.
 */
interface RawMeshNode {
  mac?: string;
  macaddr?: string;
  name?: string;
  node_name?: string;
  hostname?: string;
  model?: string;
  ip?: string;
  ipaddr?: string;
  role?: string;
  is_controller?: boolean;
  online?: boolean | number | string;
  status?: string;
  backhaul?: string | { type?: string; band?: string; signal?: number; rssi?: number };
  connection?: { type?: string; band?: string; signal?: number; rssi?: number };
  band?: string;
  signal?: number;
  rssi?: number;
  clients?: number | unknown[];
  client_count?: number;
  uptime?: number | string;
}

const WIRED = /eth|wire|cable|lan/;

/** How a node reaches the controller, from whichever of GL’s fields carries it. */
function backhaulOf(n: RawMeshNode) {
  const link = typeof n.backhaul === 'object' ? n.backhaul : (n.connection ?? {});
  const kind = (typeof n.backhaul === 'string' ? n.backhaul : (link.type ?? '')).toLowerCase();
  const type = WIRED.test(kind) ? 'wired' : kind ? 'wireless' : null;
  const dbm = link.signal ?? link.rssi ?? n.signal ?? n.rssi ?? null;
  return { type, band: link.band ?? n.band ?? null, signal: type === 'wireless' ? dbm : null } as const;
}

const isOnline = (n: RawMeshNode) => ![false, 0, '0'].includes(n.online as never) && !/off|down/i.test(n.status ?? '');
const clientCount = (n: RawMeshNode) => (Array.isArray(n.clients) ? n.clients.length : (n.clients ?? n.client_count ?? 0));

const toMember = (n: RawMeshNode): MeshMember => {
  const link = backhaulOf(n);
  return {
    mac: (n.mac ?? n.macaddr ?? '').toUpperCase(),
    name: n.name ?? n.node_name ?? n.hostname ?? '',
    model: n.model ?? 'GL.iNet',
    ip: n.ip ?? n.ipaddr ?? '',
    self: n.role === 'controller' || n.is_controller === true,
    online: isOnline(n),
    backhaul: link.type,
    band: link.band,
    signal: link.signal,
    clients: clientCount(n),
    uptime: n.uptime === undefined ? null : Number(n.uptime) || 0,
  };
};

export const networkExtras = (t: Transport) => ({
  ipv6: settings<Ipv6Config>(t, 'ipv6', { get: 'get_ipv6', set: 'set_ipv6', timeoutMs: 60_000 }),
  igmp: settings<{ enable: boolean; version: number }>(t, 'igmp'),
  acceleration: settings<NetNat>(t, 'network', { get: 'get_netnat_config', set: 'set_netnat_config', timeoutMs: 60_000 }),
  nat: settings<{ nat_enable: number; sip_enable: number }>(t, 'network', { get: 'get_advance_config', set: 'set_advance_config' }),
  edgeRouter: settings<{ enable: boolean; ignore?: boolean }>(t, 'edgerouter', { timeoutMs: 60_000 }),
  mode: async () => (await t.call<{ mode?: string }>('netmode', 'get_mode')).mode ?? 'router',

  mesh: {
    config: settings<{ enabled: boolean; mode: string }>(t, 'mesh', { timeoutMs: 60_000 }),
    async scan(): Promise<void> {
      await t.call('mesh', 'trigger_onbd_scan', {}, 30_000);
    },
    async scanStatus(): Promise<{ status: string; nodes: MeshNode[] }> {
      const r = await t
        .call<{ status?: string; nodes?: { mac: string; model?: string; signal?: number }[] }>('mesh', 'get_onbd_scan_status')
        .catch(() => ({}) as { status?: string; nodes?: { mac: string; model?: string; signal?: number }[] });
      return {
        status: r.status ?? 'idle',
        nodes: (r.nodes ?? []).map((n) => ({ mac: n.mac, model: n.model ?? 'GL.iNet', signal: n.signal ?? null })),
      };
    },
    add: (macs: string[]) => t.call('mesh', 'add_nodes', { maclist: macs }, 180_000),
    async nodes(): Promise<MeshMember[]> {
      const r = await t.call<{ nodes?: RawMeshNode[]; topology?: RawMeshNode[] } | RawMeshNode[]>('mesh', 'get_topology', {}, 30_000);
      const list = Array.isArray(r) ? r : (r.nodes ?? r.topology ?? []);
      return list.map(toMember);
    },
    remove: (macs: string[]) => t.call('mesh', 'remove_nodes', { maclist: macs }, 120_000),
    reboot: (macs: string[]) => t.call('mesh', 'reboot_nodes', { maclist: macs }, 60_000),
    rename: (mac: string, name: string) => t.call('mesh', 'set_node_name', { mac, node_name: name }),
  },
});
