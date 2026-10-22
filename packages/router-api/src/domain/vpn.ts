import { settings } from '../settings.ts';
import type { Transport } from '../transport/types.ts';

/* ---------- client tunnels (policy routing) ---------- */

export type TunnelFrom = 'default' | 'mac' | 'exclude_mac' | 'interface';
export type TunnelTo = 'default' | 'domain' | 'exclude_domain';

export interface Tunnel {
  id: number;
  name: string;
  enabled: boolean;
  killswitch: boolean;
  from: { type: TunnelFrom; mac_list?: string[]; exclude_mac_list?: string[]; interface_list?: string[] };
  to: { type: TunnelTo; domain_list?: string };
  via: { type?: 'wireguard' | 'openvpn'; via?: string };
}
export interface TunnelState {
  enabled: boolean;
  max: number;
  tunnels: Tunnel[];
  /** "Everything else" goes out normally when on, is blocked when off. */
  fallthrough: boolean;
}

/** A profile a tunnel can send traffic through. `value` is "type|group|id". */
export interface ProfileChoice {
  value: string;
  label: string;
}

export interface ProfileGroup {
  id: number;
  name: string;
  kind: 'wireguard' | 'openvpn';
  /** 1 a provider, 3 the GL app's own group, anything else a file group */
  type: number;
  count: number;
}

export interface NewTunnel {
  name: string;
  from: Tunnel['from'];
  to: { type: TunnelTo; manual?: boolean; domain_list?: string };
  profile: string;
}

/* ---------- servers ---------- */

export interface WgPeer {
  id: number;
  name: string;
  address: string;
}
export interface OvpnServerConfig {
  initialization: boolean;
  mode: 'tun' | 'tap-s2s';
  proto: 'udp' | 'tcp';
  port: number;
  subnetv4: string;
  mask: string;
  cipher: string;
  client_auth: 1 | 2 | 3;
  client_to_client: boolean;
  start?: string;
  end?: string;
  [key: string]: unknown;
}
export const OVPN_AUTH = { 1: 'Certificate', 2: 'Username and password', 3: 'Certificate and password' } as const;

/* ---------- mesh VPNs ---------- */

export interface TailscaleConfig {
  enabled: boolean;
  lan_enabled: boolean;
  lan_ip?: string;
  wan_enabled: boolean;
  run_exit_node: boolean;
  exit_node_ip?: string;
  masq?: boolean;
}
export interface TailscaleStatus {
  status: number;
  login_name?: string;
  address_v4?: string;
  dns?: string[];
}
export interface ZeroTierConfig {
  enabled: boolean;
  id?: string;
  lan_enabled?: boolean;
  wan_enabled?: boolean;
}
export interface TorConfig {
  enable: boolean;
  manual: boolean;
  countries?: string[];
}

export const vpn = (t: Transport) => ({
  async tunnels(): Promise<TunnelState> {
    const r = await t.call<{
      global_enabled: boolean;
      max_tunnels: number;
      tunnels?: (Tunnel & { tunnel_id: number })[];
      default_tunnels?: { enabled?: boolean }[];
    }>('vpn-client', 'get_tunnel');
    return {
      enabled: r.global_enabled,
      max: r.max_tunnels,
      tunnels: (r.tunnels ?? []).map((x) => ({ ...x, id: x.tunnel_id })),
      fallthrough: r.default_tunnels?.[0]?.enabled !== false,
    };
  },
  async profileChoices(): Promise<ProfileChoice[]> {
    type Configs = {
      configs?: {
        wireguard?: { group_id: number; group_name: string; peers?: { peer_id: number; name: string }[] }[];
        openvpn?: { group_id: number; group_name: string; clients?: { client_id: number; name: string; mode?: string }[] }[];
      };
    };
    const r = await t.call<Configs>('vpn-client', 'get_all_config_list').catch((): Configs => ({}));
    return [
      ...(r.configs?.wireguard ?? []).flatMap((g) =>
        (g.peers ?? []).map((p) => ({ value: `wireguard|${g.group_id}|${p.peer_id}`, label: `${g.group_name} · ${p.name} (WireGuard)` })),
      ),
      ...(r.configs?.openvpn ?? []).flatMap((g) =>
        (g.clients ?? [])
          .filter((c) => c.mode !== 'tap-s2s')
          .map((c) => ({ value: `openvpn|${g.group_id}|${c.client_id}`, label: `${g.group_name} · ${c.name} (OpenVPN)` })),
      ),
    ];
  },
  connectionMethods: async () =>
    (
      await t
        .call<{ connection_methods?: string[] }>('vpn-client', 'get_connection_methods')
        .catch((): { connection_methods?: string[] } => ({}))
    ).connection_methods ?? [],
  addTunnel(n: NewTunnel) {
    const [type, group, id] = n.profile.split('|');
    return t.call(
      'vpn-client',
      'add_tunnel',
      { name: n.name, from: n.from, to: n.to, via: { type, configs: [{ group_id: Number(group), id_list: [Number(id) || id] }] } },
      30_000,
    );
  },
  async removeTunnels(ids: number[]) {
    for (const tunnel_id of ids) await t.call('vpn-client', 'remove_tunnel', { tunnel_id }, 30_000);
  },
  setFallthrough: (enabled: boolean) => t.call('vpn-client', 'set_default_tunnel', { enabled }),

  async groups(): Promise<ProfileGroup[]> {
    const [wg, ov] = await Promise.all([
      t.call<{ groups?: { group_id: number; group_name: string; group_type: number; peer_count?: number }[] }>(
        'wg-client',
        'get_group_list',
      ),
      t.call<{ groups?: { group_id: number; group_name: string; group_type: number; client_count?: number }[] }>(
        'ovpn-client',
        'get_group_list',
      ),
    ]);
    return [
      ...(wg.groups ?? []).map((g) => ({
        id: g.group_id,
        name: g.group_name,
        kind: 'wireguard' as const,
        type: g.group_type,
        count: g.peer_count ?? 0,
      })),
      ...(ov.groups ?? []).map((g) => ({
        id: g.group_id,
        name: g.group_name,
        kind: 'openvpn' as const,
        type: g.group_type,
        count: g.client_count ?? 0,
      })),
    ];
  },
  /** Same steps as the stock panel: upload, check, set credentials, confirm into a group. */
  async importProfile(
    kind: 'wireguard' | 'openvpn',
    group: { id?: number; newName?: string },
    file: File,
    auth?: { username: string; password: string },
  ) {
    const mod = kind === 'wireguard' ? 'wg-client' : 'ovpn-client';
    let groupId = group.id;
    if (groupId === undefined) {
      const name = group.newName ?? 'Imported';
      await t.call(mod, 'add_group', { group_name: name });
      const list = (await t.call<{ groups?: { group_id: number; group_name: string }[] }>(mod, 'get_group_list')).groups ?? [];
      groupId = list.find((g) => g.group_name === name)?.group_id;
      if (groupId === undefined) throw new Error('The router didn’t create the group.');
    }
    const filename = file.name.replace(/~|\.\.|[^\w.-]/g, '_');
    await t.upload(`/tmp/${kind === 'wireguard' ? 'wg' : 'ovpn'}_upload/${filename}`, file, filename);
    await t.call(mod, 'check_config', { filename, group_id: groupId }, 300_000);
    if (kind === 'openvpn' && auth?.username)
      await t.call('ovpn-client', 'set_group', {
        group_id: groupId,
        group_name: group.newName ?? '',
        username: auth.username,
        password: auth.password,
        askpass: '',
      });
    await t.call(mod, 'confirm_config', { group_id: groupId }, 300_000);
  },

  wireguard: {
    config: () =>
      t.call<{ initialization: boolean; address_v4: string; address_v6?: string; port: number; public_key?: string }>(
        'wg-server',
        'get_config',
      ),
    setting: settings<{ masq: boolean; local_access: boolean; client_to_client: boolean }>(t, 'wg-server', {
      get: 'get_setting',
      set: 'set_setting',
    }),
    async peers(): Promise<WgPeer[]> {
      const r = await t.call<{ peers?: { peer_id: number; name: string; client_ip?: string; address?: string; allowed_ips?: string }[] }>(
        'wg-server',
        'get_peer_list',
      );
      return (r.peers ?? []).map((p) => ({ id: p.peer_id, name: p.name, address: p.client_ip ?? p.address ?? p.allowed_ips ?? '' }));
    },
    addPeer: (name: string) =>
      t.call<{ peer_id?: number }>('wg-server', 'add_peer', {
        name,
        presharedkey_enable: false,
        presharedkey: '',
        mtu: 0,
        persistent_keepalive: 0,
      }),
    async removePeers(ids: number[]) {
      for (const peer_id of ids) await t.call('wg-server', 'remove_peer', { peer_id });
    },
    async peerConfig(id: number): Promise<string> {
      const r = await t.call<Record<string, string> & { config?: string; peer_config?: string }>('wg-server', 'generate_peer', {
        peer_id: id,
      });
      return (
        r.config ??
        r.peer_config ??
        Object.entries(r)
          .map(([k, v]) => `${k} = ${v}`)
          .join('\n')
      );
    },
    run: (on: boolean) => t.call('wg-server', on ? 'start' : 'stop', {}, 30_000),
  },

  openvpn: {
    config: () => t.call<OvpnServerConfig>('ovpn-server', 'get_config'),
    setConfig: (c: Partial<OvpnServerConfig>) => t.call('ovpn-server', 'set_config', c, 300_000),
    setting: settings<{ masq: boolean; local_access: boolean }>(t, 'ovpn-server', { get: 'get_setting', set: 'set_setting' }),
    users: async () => (await t.call<{ user_list?: { username: string }[] }>('ovpn-server', 'get_user_list')).user_list ?? [],
    addUser: (username: string, password: string) => t.call('ovpn-server', 'add_user', { username, password }),
    async removeUsers(names: string[]) {
      for (const username of names) await t.call('ovpn-server', 'remove_user', { username });
    },
    setUp: () => t.call('ovpn-server', 'generate_certificate', {}, 180_000),
    run: (on: boolean) => t.call('ovpn-server', on ? 'start' : 'stop', {}, 30_000),
    addresses: async () => {
      const a = await t
        .call<{ domain?: string[]; pub_ip?: string[]; wan_ip?: string[] }>('network', 'get_available_address_list')
        .catch(() => ({}) as { domain?: string[]; pub_ip?: string[]; wan_ip?: string[] });
      return [...new Set([...(a.domain ?? []), ...(a.pub_ip ?? []), ...(a.wan_ip ?? [])])];
    },
    async clientFile(address: string) {
      await t.call('ovpn-server', 'export_config', { address: [address] }, 30_000);
      return t.download('/etc/openvpn/ovpn/client.ovpn', 'client.ovpn');
    },
  },

  tailscale: {
    config: settings<TailscaleConfig>(t, 'tailscale'),
    status: () => t.call<TailscaleStatus>('tailscale', 'get_status').catch(() => ({ status: 0 }) as TailscaleStatus),
    exitNodes: async () =>
      (
        await t
          .call<{ exit_node_list?: { ip?: string; address?: string; name?: string; host_name?: string }[] }>(
            'tailscale',
            'get_exit_node_list',
          )
          .catch(() => ({}) as { exit_node_list?: never[] })
      ).exit_node_list ?? [],
    authUrl: async () => {
      const r = await t.call<{ auth_url?: string } | string>('tailscale', 'get_auth_url').catch(() => '');
      return typeof r === 'string' ? r : (r.auth_url ?? '');
    },
    signOut: () => t.call('tailscale', 'logout'),
  },
  zerotier: settings<ZeroTierConfig>(t, 'zerotier'),
  tor: settings<TorConfig>(t, 'tor'),
});
