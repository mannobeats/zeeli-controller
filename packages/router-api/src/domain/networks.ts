import type { Transport } from '../transport/types.ts';

/** The three networks the firmware creates; everything else is a custom VLAN. */
export const FIXED_NETWORKS = { main: 'Main LAN', guest: 'Guest', iot: 'IoT' } as const;
export type FixedNetwork = keyof typeof FIXED_NETWORKS;

/** 0 internet and upstream, 1 internet only, 2 local only. */
export type WanAccess = 0 | 1 | 2;

export interface NetworkPort {
  name: string;
  kind: 'wired' | 'wifi';
  up: boolean;
}

export interface Network {
  /** The firmware's key for the network: 'main', 'guest', 'iot' or a custom name. */
  id: string;
  label: string;
  fixed: boolean;
  enabled: boolean;
  vlanId: number | null;
  ip: string;
  netmask: string;
  gateway: string;
  dhcp: boolean;
  dhcpStart: string;
  dhcpEnd: string;
  leaseTime: string;
  isolate: boolean;
  wanAccess: WanAccess;
  dns: string[];
  ports: NetworkPort[];
  /** Fields the firmware wants echoed back on save. */
  raw: RawSubnet;
}

export interface RawSubnet {
  display_name: string;
  ip: string;
  netmask: string;
  gateway?: string;
  vlan_id?: number;
  enabled: boolean;
  dhcp_enable: boolean;
  dhcp_start_ip: string;
  dhcp_end_ip: string;
  leasetime: string;
  isolate: boolean;
  wan_access_mode?: number;
  dns?: string[];
  lpr?: unknown[];
  transfer_enable?: number;
  ifaces?: { name: string; conn_type: string; state: string }[];
}

export interface Reservation {
  mac: string;
  ip: string;
  name: string;
  network: string;
}

export interface NetworkInput {
  label: string;
  enabled: boolean;
  ip: string;
  netmask: string;
  vlanId: number | null;
  wanAccess: WanAccess;
  isolate: boolean;
  dhcp: boolean;
  dhcpStart: string;
  dhcpEnd: string;
  leaseTime: string;
  dns: string[];
}

const toNetwork = (n: RawSubnet): Network => ({
  id: n.display_name,
  label: FIXED_NETWORKS[n.display_name as FixedNetwork] ?? n.display_name,
  fixed: n.display_name in FIXED_NETWORKS,
  enabled: n.enabled,
  vlanId: n.vlan_id ?? null,
  ip: n.ip,
  netmask: n.netmask,
  gateway: n.gateway ?? '',
  dhcp: n.dhcp_enable,
  dhcpStart: n.dhcp_start_ip,
  dhcpEnd: n.dhcp_end_ip,
  leaseTime: n.leasetime,
  isolate: n.isolate,
  wanAccess: (n.wan_access_mode ?? 0) as WanAccess,
  dns: n.dns ?? [],
  ports: (n.ifaces ?? []).map((i) => ({ name: i.name, kind: i.conn_type === 'wifi' ? 'wifi' : 'wired', up: i.state === 'up' })),
  raw: n,
});

export const networks = (t: Transport) => {
  const reserve = (r: Reservation, replace = false) =>
    t.call('vlan_subnet', replace ? 'set_static_bind' : 'add_static_bind', {
      mac: r.mac,
      ip: r.ip,
      name: r.name,
      hostname: '',
      display_name: r.network,
    });
  const unreserve = (r: Reservation) => t.call('vlan_subnet', 'remove_static_bind', { mode: 0, display_name: r.network, mac: r.mac });
  return {
    async list(): Promise<Network[]> {
      const r = await t.call<{ subnets?: RawSubnet[] }>('vlan_subnet', 'get_subnets');
      return (r.subnets ?? []).map(toNetwork);
    },

    async reservations(): Promise<Reservation[]> {
      const r = await t.call<{ static_bind_list?: { mac: string; ip: string; name: string; display_name: string }[] }>(
        'vlan_subnet',
        'get_static_bind_list',
      );
      return (r.static_bind_list ?? []).map((b) => ({
        mac: b.mac.toUpperCase(),
        ip: b.ip,
        name: b.name,
        network: b.display_name,
      }));
    },

    /** Create (no `existing`) or update a network. Fixed networks keep their key. */
    save(input: NetworkInput, existing?: Network) {
      const base = {
        ip: input.ip,
        gateway: existing?.gateway ?? '',
        netmask: input.netmask,
        dhcp_enable: input.dhcp,
        leasetime: input.leaseTime,
        isolate: input.isolate,
        dns: input.dns,
        lpr: existing?.raw.lpr ?? [],
        dhcp_start_ip: input.dhcpStart,
        dhcp_end_ip: input.dhcpEnd,
      };
      const vlan = {
        vlan_id: input.vlanId ?? 0,
        wan_access_mode: input.wanAccess,
        transfer_enable: existing?.raw.transfer_enable ?? 0,
      };
      if (existing?.fixed) {
        const extra = existing.id === 'main' ? {} : { enabled: input.enabled, ...vlan };
        return t.call('vlan_subnet', 'set_fixed_subnet', { display_name: existing.id, ...base, ...extra }, 60_000);
      }
      if (existing)
        return t.call('vlan_subnet', 'update_custom_subnet', { name: existing.id, display_name: input.label, ...base, ...vlan }, 60_000);
      return t.call('vlan_subnet', 'add_custom_subnet', { name: input.label, ...base, ...vlan }, 60_000);
    },

    remove: (id: string) => t.call('vlan_subnet', 'remove_custom_subnet', { name: id }, 60_000),

    reserve,

    /** One at a time: the firmware rewrites its DHCP config on each call. */
    async reserveAll(list: Reservation[]) {
      for (const r of list) await reserve(r);
    },
    async unreserveAll(list: Reservation[]) {
      for (const r of list) await unreserve(r);
    },

    unreserve,
  };
};
