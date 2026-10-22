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
  },
});
