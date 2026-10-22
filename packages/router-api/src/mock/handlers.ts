import { moreHandlers } from './more-handlers.ts';
import type { MockState } from './seed.ts';

type Args = Record<string, unknown>;
type Handler = (state: MockState, args: Args, ctx: { uptime: number }) => unknown;

const jitter = (n: number) => Math.max(0, Math.round(n * (0.55 + Math.random() * 0.9)));
const str = (v: unknown) => String(v ?? '');

const system: Record<string, Handler> = {
  'system.get_info': (s) => s.info,
  'system.get_status': (s, _a, { uptime }) => {
    const online = s.clients.filter((c) => c.online);
    return {
      service: [
        { name: 'adguardhome', status: 1 },
        { name: 'tailscale', status: 1 },
        { name: 'wgserver', status: 0 },
        { name: 'ovpnserver', status: 0 },
        { name: 'zerotier', status: 0 },
      ],
      client: [
        {
          cable_total: online.filter((c) => c.type === 2).length,
          wireless_total: online.filter((c) => c.type !== 2).length,
        },
      ],
      wifi: [
        wifi('wifi2g', '2G', 'Zeeli Home', 6),
        wifi('wifi5g', '5G', 'Zeeli Home', 36),
        wifi('wifi6g', '6G', 'Zeeli Home 6', 37),
        { ...wifi('mlo', 'MLD', 'Zeeli Home MLO', 0), mld: true },
        { ...wifi('guest5g', '5G', 'Zeeli Guest', 36), guest: true },
        { ...wifi('iot2g', '2G', 'Zeeli Things', 6), iot: true },
      ],
      network: [
        { interface: 'wan', up: true, online: true },
        { interface: 'secondwan', up: false, online: false },
        { interface: 'wwan', up: false, online: false },
        { interface: 'tethering', up: false, online: false },
      ],
      system: {
        uptime: 1_632_263 + uptime,
        load_average: [0.31, 0.27, 0.22],
        cpu: { temperature: 58 + Math.round(Math.random() * 3) },
        memory_total: 1_028_000_000,
        memory_free: 512_000_000,
        memory_buff_cache: 180_000_000,
        flash_total: 7_200_000_000,
        flash_free: 6_300_000_000,
        lan_ip: '192.168.8.1',
        lan_netmask: '255.255.255.0',
        mode: 0,
        timestamp: Math.floor(Date.now() / 1000),
        tzoffset: '-0400',
        ipv6_enabled: true,
        ddns_enabled: false,
        sqm_enabled: false,
        qos_enabled: false,
        netnat_enabled: true,
        flow_statistics_enabled: true,
        content_protection_enabled: false,
      },
    };
  },
  'fan.get_status': () => ({ speed: 2100 + Math.round(Math.random() * 200), status: true }),
};

function wifi(name: string, band: string, ssid: string, channel: number) {
  return { name, band, ssid, up: true, guest: false, iot: false, mld: false, hidden: false, channel, encryption: 'sae-mixed' };
}

const clients: Record<string, Handler> = {
  'clients.get_list': (s) => ({
    clients: s.clients.map((c) => ({
      ...c,
      blocked: c.blocked || s.access.black_mac.includes(c.mac),
      rx: c.online ? jitter(c.rx) : 0,
      tx: c.online ? jitter(c.tx) : 0,
    })),
  }),
  'clients.set_info': (s, a) => {
    const c = s.clients.find((x) => x.mac === str(a.mac).toUpperCase());
    if (c) Object.assign(c, { alias: str(a.alias), class: str(a.class) });
    return {};
  },
  'clients.remove_offline': (s, a) => {
    s.clients = s.clients.filter((c) => c.online || c.mac !== str(a.mac).toUpperCase());
    return {};
  },
  'clients.clean_traffic': (s) => {
    for (const c of s.clients) Object.assign(c, { total_rx: '0', total_tx: '0' });
    return {};
  },
  'clients.get_status': (s) => ({ auto_remove_offline: s.autoForget }),
  'clients.set_cache_offline': (s, a) => {
    s.autoForget = Boolean(a.auto_remove_offline);
    return {};
  },
  'qos.set_speed_limit_rule': (s, a) => {
    const c = s.clients.find((x) => x.mac === str(a.mac).toUpperCase());
    if (c) Object.assign(c, { limit_rx: Number(a.download), limit_tx: Number(a.upload) });
    return {};
  },
  'qos.remove_speed_limit_rule': (s, a) => {
    const c = s.clients.find((x) => x.mac === str(a.mac).toUpperCase());
    if (c) Object.assign(c, { limit_rx: 0, limit_tx: 0 });
    return {};
  },
  'black_white_list.get_config': (s) => s.access,
  'black_white_list.set_config': (s, a) => {
    s.access = { ...s.access, mode: str(a.mode), black_mac: (a.mac as string[]) ?? [] };
    for (const c of s.clients) c.blocked = s.access.black_mac.includes(c.mac);
    return {};
  },
};

const networks: Record<string, Handler> = {
  'vlan_subnet.get_subnets': (s) => ({ subnets: s.subnets }),
  'vlan_subnet.get_static_bind_list': (s) => ({ static_bind_list: s.binds }),
  'vlan_subnet.add_static_bind': (s, a) => {
    s.binds.push({ mac: str(a.mac), ip: str(a.ip), name: str(a.name), display_name: str(a.display_name) });
    return {};
  },
  'vlan_subnet.set_static_bind': (s, a) => {
    s.binds = s.binds.map((b) => (b.mac === a.mac ? { ...b, ip: str(a.ip), name: str(a.name) } : b));
    return {};
  },
  'vlan_subnet.remove_static_bind': (s, a) => {
    s.binds = s.binds.filter((b) => b.mac !== a.mac);
    return {};
  },
  'vlan_subnet.set_fixed_subnet': (s, a) => {
    s.subnets = s.subnets.map((n) => (n.display_name === a.display_name ? { ...n, ...a } : n)) as typeof s.subnets;
    return {};
  },
  'vlan_subnet.add_custom_subnet': (s, a) => {
    const first = s.subnets[0];
    if (first) s.subnets.push({ ...first, ...a, display_name: str(a.name), ifaces: [] } as typeof first);
    return {};
  },
  'vlan_subnet.update_custom_subnet': (s, a) => {
    s.subnets = s.subnets.map((n) =>
      n.display_name === a.name ? { ...n, ...a, display_name: str(a.display_name) } : n,
    ) as typeof s.subnets;
    return {};
  },
  'vlan_subnet.remove_custom_subnet': (s, a) => {
    s.subnets = s.subnets.filter((n) => n.display_name !== a.name);
    return {};
  },
};

export const handlers: Record<string, Handler> = { ...moreHandlers, ...system, ...clients, ...networks };
