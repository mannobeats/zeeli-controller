// Demo answers for the rest of the router. Invented values only.
import { appConfigs, opkgCall } from './apps-handlers.ts';
import type { MockState } from './seed.ts';
import { SETTINGS } from './settings-data.ts';

type Args = Record<string, unknown>;
type Handler = (state: MockState, args: Args, ctx: { uptime: number }) => unknown;

/** Mutable demo state that isn't in the seed's typed core, kept per mock router. */
const keep = <T>(s: MockState, key: string, init: () => T): T => {
  if (!s.extra.has(key)) s.extra.set(key, init());
  return s.extra.get(key) as T;
};
let nextId = 100;

const portConfig = (s: MockState) =>
  keep<Args[]>(s, 'ports', () => [
    {
      name: 'wan',
      silk: 'WAN',
      mode: 'wan',
      default_mode: 'wan',
      support_wan: '1',
      macaddr: { mode: 'default', macaddr: '02:5e:e1:00:00:02', defmacaddr: '02:5e:e1:00:00:02' },
    },
    {
      name: 'secondwan',
      silk: 'LAN1',
      mode: 'lan',
      default_mode: 'lan',
      support_wan: '1',
      macaddr: { mode: 'default', macaddr: '02:5e:e1:00:00:03', defmacaddr: '02:5e:e1:00:00:03' },
    },
    { name: 'lan2', silk: 'LAN2', mode: 'lan', default_mode: 'lan', support_wan: '0' },
    { name: 'lan3', silk: 'LAN3', mode: 'lan', default_mode: 'lan', support_wan: '0' },
    { name: 'lan4', silk: 'LAN4', mode: 'lan', default_mode: 'lan', support_wan: '0' },
  ]);
const kmwan = (s: MockState) =>
  keep(s, 'kmwan', () => ({
    mode: 0,
    interfaces: [
      { interface: 'wan', metric: 1, weight: 3, enable_check: true, track_ipv4: ['1.1.1.1', '8.8.8.8'] },
      { interface: 'secondwan', metric: 2, weight: 1, enable_check: true, track_ipv4: ['1.1.1.1'] },
      { interface: 'wwan', metric: 3, weight: 1, enable_check: true, track_ipv4: ['1.1.1.1'] },
    ],
  }));
type PortStatus = { name: string; speed?: number; vlan_mode?: string; pvid?: number; trunk_tag?: number[] };
const portStatus = (s: MockState) =>
  keep<PortStatus[]>(s, 'port-status', () => [
    { name: 'wan', speed: 2500 },
    { name: 'secondwan', speed: 1000, vlan_mode: 'Standard', pvid: 1 },
    { name: 'lan2', vlan_mode: 'Standard', pvid: 1 },
    { name: 'lan3', vlan_mode: 'Standard', pvid: 1 },
    { name: 'lan4', speed: 1000, vlan_mode: 'Multiple VLANs', pvid: 1, trunk_tag: [20] },
  ]);

// the repeater starts disconnected, with one network remembered from earlier
const repeaterStatus = (s: MockState) => keep<Record<string, unknown>>(s, 'repeater-status', () => ({ state_s: 'disconnected' }));
type SavedAp = { ssid: string; protocol: string; macaddr: { mode: string } };
const savedAps = (s: MockState) =>
  keep<SavedAp[]>(s, 'saved-aps', () => [{ ssid: 'Cafe Corner', protocol: 'dhcp', macaddr: { mode: 'random' } }]);

type Group = { group_id: number; group_name: string; group_type: number; peer_count?: number; client_count?: number };
const wgGroups = (s: MockState) =>
  keep<Group[]>(s, 'wg-groups', () => [
    { group_id: 7, group_name: 'Home VPN', group_type: 2, peer_count: 1 },
    { group_id: 10003, group_name: 'Mullvad', group_type: 1, peer_count: 0 },
  ]);
const ovpnGroups = (s: MockState) => keep<Group[]>(s, 'ovpn-groups', () => []);
// imported profiles land in user groups (type 2), like the stock panel's "Add a group"
const addGroup = (list: Group[], a: Args) => {
  list.push({ group_id: nextId++, group_name: String(a.group_name), group_type: 2 });
  return {};
};
// the OpenVPN server starts without certificates, as on a fresh router
const ovpnServer = (s: MockState) =>
  keep<Args>(s, 'ovpn-server', () => ({
    initialization: false,
    mode: 'tun',
    proto: 'udp',
    port: 1194,
    subnetv4: '10.8.0.0',
    mask: '255.255.255.0',
    cipher: 'AES-256-GCM',
    client_auth: 1,
    client_to_client: false,
  }));
const ovpnUsers = (s: MockState) => keep<{ username: string }[]>(s, 'ovpn-users', () => []);
const wifiTimers = (s: MockState) =>
  keep<Args[]>(s, 'wifi-timers', () =>
    ['2G', '5G', '6G', 'MLD'].map((band) => ({
      func: 'turn_onoff',
      band,
      guest: 0,
      enable: false,
      week: [0, 1, 2, 3, 4, 5, 6],
      turnoff_hour: '23',
      turnoff_min: '00',
      turnon_hour: '06',
      turnon_min: '30',
    })),
  );
// a confirmed import adds one profile to its group
const countProfile = (list: Group[], a: Args, field: 'peer_count' | 'client_count') => {
  const g = list.find((x) => x.group_id === a.group_id);
  if (g) g[field] = (g[field] ?? 0) + 1;
  return {};
};

const settingsHandlers: Record<string, Handler> = Object.fromEntries(
  Object.entries(SETTINGS).flatMap(([getKey, [setFn, initial]]) => {
    const [mod] = getKey.split('.');
    const read = (s: MockState) => keep(s, getKey, () => structuredClone(initial));
    return [
      [getKey, (s: MockState) => read(s)],
      [
        `${mod}.${setFn}`,
        (s: MockState, a: Args) => {
          Object.assign(read(s), a);
          return {};
        },
      ],
    ];
  }),
);

const radio = (device: string, band: string, channel: number | 'auto', htmode: string, ifaces: unknown[]) => ({
  device,
  band,
  channel,
  channels: band === '2g' ? [1, 6, 11] : band === '5g' ? [36, 40, 44, 48, 149, 153, 157, 161] : [5, 37, 69, 101],
  htmode,
  htmodes: Object.fromEntries((band === '2g' ? ['HE20', 'HE40'] : ['EHT80', 'EHT160', 'EHT320']).map((m) => [m, {}])),
  hwmode: '11be',
  txpower: 'max',
  encryptions: ['psk2', 'sae-mixed', 'sae', 'none'],
  ifaces,
});
const iface = (name: string, ssid: string, extra: Record<string, unknown> = {}) => ({
  name,
  ssid,
  key: 'correct-horse-battery',
  encryption: 'sae-mixed',
  enabled: true,
  hidden: false,
  guest: false,
  iot: false,
  init: true,
  random_bssid: true,
  ...extra,
});

const wifiState = (s: MockState) =>
  keep(s, 'wifi', () => [
    radio('radio0', '2g', 6, 'HE20', [
      iface('wifi2g', 'Zeeli Home'),
      iface('guest2g', 'Zeeli Guest', { guest: true, enabled: false }),
      iface('iot2g', 'Zeeli Things', { iot: true, encryption: 'psk2' }),
    ]),
    radio('radio1', '5g', 36, 'EHT160', [iface('wifi5g', 'Zeeli Home'), iface('guest5g', 'Zeeli Guest', { guest: true })]),
    radio('radio2', '6g', 'auto', 'EHT320', [iface('wifi6g', 'Zeeli Home 6', { encryption: 'sae' })]),
  ]);

const sections = (s: MockState) =>
  keep(s, 'uci', () => ({
    ...appConfigs(),
    firewall: {
      zlan: {
        '.name': 'zlan',
        '.type': 'zone',
        '.anonymous': true,
        '.index': 0,
        name: 'lan',
        input: 'ACCEPT',
        output: 'ACCEPT',
        forward: 'ACCEPT',
      },
      zwan: {
        '.name': 'zwan',
        '.type': 'zone',
        '.anonymous': true,
        '.index': 1,
        name: 'wan',
        input: 'REJECT',
        output: 'ACCEPT',
        forward: 'REJECT',
        masq: '1',
      },
      zguest: {
        '.name': 'zguest',
        '.type': 'zone',
        '.anonymous': true,
        '.index': 2,
        name: 'guest',
        input: 'REJECT',
        output: 'ACCEPT',
        forward: 'REJECT',
      },
      f1: { '.name': 'f1', '.type': 'forwarding', '.anonymous': true, '.index': 3, src: 'lan', dest: 'wan' },
      f2: { '.name': 'f2', '.type': 'forwarding', '.anonymous': true, '.index': 4, src: 'guest', dest: 'wan' },
      r1: {
        '.name': 'r1',
        '.type': 'rule',
        '.anonymous': true,
        '.index': 5,
        name: 'Allow-DHCP-Renew',
        src: 'wan',
        proto: 'udp',
        dest_port: '68',
        target: 'ACCEPT',
        family: 'ipv4',
      },
      r2: {
        '.name': 'r2',
        '.type': 'rule',
        '.anonymous': true,
        '.index': 6,
        name: 'Allow-Ping',
        src: 'wan',
        proto: 'icmp',
        target: 'ACCEPT',
        family: 'ipv4',
      },
      r3: {
        '.name': 'r3',
        '.type': 'rule',
        '.anonymous': true,
        '.index': 7,
        name: 'Keep cameras off the internet',
        src: 'iot',
        dest: 'wan',
        src_ip: '192.168.10.52',
        proto: 'all',
        target: 'REJECT',
      },
      ts_rule: {
        '.name': 'ts_rule',
        '.type': 'rule',
        '.anonymous': false,
        '.index': 8,
        name: 'Allow-Tailscale',
        src: 'wan',
        proto: 'udp',
        dest_port: '41641',
        target: 'ACCEPT',
      },
    } as Record<string, Record<string, unknown>>,
    network: {
      rt1: {
        '.name': 'rt1',
        '.type': 'route',
        '.anonymous': true,
        '.index': 0,
        interface: 'lan',
        target: '10.50.0.0',
        netmask: '255.255.255.0',
        gateway: '192.168.8.11',
      },
    } as Record<string, Record<string, unknown>>,
  }));

const LOG = () => {
  const t = (minsAgo: number) => {
    const d = new Date(Date.now() - minsAgo * 60_000);
    return d
      .toString()
      .replace(
        /^(\w{3}) (\w{3}) (\d+) (\d{4}) ([\d:]+).*$/,
        (_m, w, mo, dd, y, hms) => `${w} ${mo} ${String(dd).padStart(2, ' ')} ${hms} ${y}`,
      );
  };
  return [
    `${t(180)} daemon.notice netifd: Interface 'wan' is now up`,
    `${t(170)} daemon.info hostapd: wlan1: AP-STA-CONNECTED 02:5e:e1:33:29:c3`,
    `${t(169)} daemon.info dnsmasq-dhcp[1]: DHCPACK(br-lan) 192.168.8.41 02:5e:e1:33:29:c3 Maya-iPhone`,
    `${t(95)} authpriv.warn dropbear[2]: Bad password attempt for 'root' from 203.0.113.7:51234`,
    `${t(94)} authpriv.warn dropbear[2]: Bad password attempt for 'root' from 203.0.113.7:51240`,
    `${t(60)} daemon.info hostapd: wlan0: AP-STA-DISCONNECTED 02:5e:e1:64:35:bc`,
    `${t(42)} daemon.info hostapd: wlan2: AP-STA-CONNECTED 02:5e:e1:72:78:ba`,
    `${t(41)} daemon.info dnsmasq-dhcp[1]: DHCPACK(br-guest) 192.168.9.120 02:5e:e1:72:78:ba Guest-Phone`,
    `${t(12)} daemon.notice netifd: Interface 'secondwan' is now down`,
    `${t(3)} authpriv.notice dropbear[3]: Pubkey auth succeeded for 'root' with ssh-ed25519 key`,
  ].join('\n');
};

const series = (n: number, base: number) =>
  Array.from({ length: n }, (_, i) => Math.round(base * (0.6 + 0.4 * Math.sin(i / 3) + Math.random() * 0.3)));

export const moreHandlers: Record<string, Handler> = {
  ...settingsHandlers,

  /* internet */
  'repeater.get_status': (s) => repeaterStatus(s),
  'repeater.get_saved_ap_list': (s) => ({ res: savedAps(s) }),
  'repeater.connect': (s, a) => {
    const ssid = String(a.ssid);
    s.extra.set('repeater-status', {
      state_s: 'connected',
      ssid,
      band: '5g',
      channel: 44,
      signal: -58,
      wifi_generation: '6',
      htmode: 'HE80',
      ipv4: { ip: '192.168.1.57/24', gateway: '192.168.1.1', dns: ['192.168.1.1'] },
      connected: '0 days 00:00:05',
      macaddr: '02:5e:e1:00:00:0a',
      config: { macaddr: { mode: 'random' } },
    });
    if (a.remember && !savedAps(s).some((n) => n.ssid === ssid)) savedAps(s).push({ ssid, protocol: 'dhcp', macaddr: { mode: 'random' } });
    return {};
  },
  'repeater.disconnect': (s) => {
    s.extra.set('repeater-status', { state_s: 'disconnected' });
    return {};
  },
  'repeater.remove_saved_ap': (s, a) => {
    s.extra.set(
      'saved-aps',
      savedAps(s).filter((n) => n.ssid !== a.ssid),
    );
    return {};
  },
  'repeater.scan': (_s) => ({
    res: [
      { ssid: 'Neighbour-5G', bssid: '02:5e:e1:aa:00:01', band: '5g', channel: 44, signal: -71, encryption: { enabled: true } },
      { ssid: 'Cafe Corner', bssid: '02:5e:e1:aa:00:02', band: '2g', channel: 11, signal: -64, encryption: 'none' },
      { ssid: 'Library Free WiFi', bssid: '02:5e:e1:aa:00:03', band: '5g', channel: 149, signal: -80, encryption: 'none' },
    ],
  }),
  'tethering.get_status': (_s) => ({ devices: [], status: 0 }),
  'cable.get_ports_config': (s) => ({ ports: portConfig(s) }),
  'cable.get_ports_status': (s) => ({ ports: portStatus(s) }),
  // one call sets a port's role, its WAN MAC, or its LAN VLANs
  'cable.set_port_config': (s, a) => {
    const { name, mode, macaddr, ...vlans } = a;
    const cfg: Args = portConfig(s).find((p) => p.name === name) ?? {};
    Object.assign(cfg, { mode }, macaddr && { macaddr: { ...(cfg.macaddr as object), ...(macaddr as object) } });
    Object.assign(portStatus(s).find((p) => p.name === name) ?? {}, vlans);
    return {};
  },
  'kmwan.get_config': (s) => kmwan(s),
  // failover sends each uplink's metric, load balancing its weight
  'kmwan.set_config': (s, a) => {
    const cfg = kmwan(s);
    cfg.mode = Number(a.mode);
    for (const change of a.interfaces as Args[]) Object.assign(cfg.interfaces.find((i) => i.interface === change.interface) ?? {}, change);
    return {};
  },
  'kmwan.get_status': (_s) => ({
    interfaces: [
      { interface: 'wan', status_v4: 0 },
      { interface: 'secondwan', status_v4: 1 },
      { interface: 'wwan', status_v4: 1 },
    ],
  }),
  'kmwan.get_sensitivity': (s) => ({ sensitivity: { val: keep(s, 'sens', () => ({ v: 3 })).v } }),
  'kmwan.set_sensitivity': (s, a) => {
    keep(s, 'sens', () => ({ v: 3 })).v = Number(a.val);
    return {};
  },

  /* wifi */
  'wifi.get_config': (s) => ({ res: wifiState(s) }),
  'wifi.get_mlo_config': (_s) => ({
    res: {
      ifaces: [iface('mlo0', 'Zeeli Home MLO', { mlo_enable: true, mlo_band: ['5g', '6g'], encryption: 'sae' })],
      encryptions: ['sae', 'sae-mixed'],
    },
  }),
  'wifi.set_config': (s, a) => {
    for (const r of wifiState(s)) for (const i of r.ifaces as Record<string, unknown>[]) if (i.name === a.iface_name) Object.assign(i, a);
    return {};
  },

  /* security */
  'firewall.get_zone_list': (_s) => ({ internals: ['lan', 'guest', 'iot'], externals: ['wan'] }),
  'firewall.get_acl_zone_list': (_s) => ({ internals: ['lan', 'guest', 'iot', 'wan'], externals: ['lan', 'guest', 'iot'] }),
  'firewall.get_port_forward_list': (s) => ({
    res: keep(s, 'pf', () => [
      {
        id: 1,
        name: 'Plex',
        proto: 'tcp',
        src: 'wan',
        src_dport: '32400',
        dest: 'lan',
        dest_ip: '192.168.8.10',
        dest_port: '32400',
        enabled: true,
      },
      {
        id: 2,
        name: 'Minecraft',
        proto: 'tcp udp',
        src: 'wan',
        src_dport: '25565',
        dest: 'lan',
        dest_ip: '192.168.8.11',
        dest_port: '25565',
        enabled: false,
      },
    ]),
  }),
  'firewall.add_port_forward': (s, a) => {
    keep<Record<string, unknown>[]>(s, 'pf', () => []).push({ ...a, id: nextId++ });
    return {};
  },
  'firewall.set_port_forward': (s, a) => {
    const list = keep<Record<string, unknown>[]>(s, 'pf', () => []);
    const i = list.findIndex((x) => String(x.id) === String(a.id));
    if (i >= 0) list[i] = { ...list[i], ...a };
    return {};
  },
  'firewall.remove_port_forward': (s, a) => {
    const list = keep<Record<string, unknown>[]>(s, 'pf', () => []);
    list.splice(
      list.findIndex((x) => String(x.id) === String(a.id)),
      1,
    );
    return {};
  },
  'firewall.get_acl_rule_list': (s) =>
    keep(s, 'acl', () => [
      {
        id: 1,
        name: 'Keep IoT off the NAS',
        family: 'ipv4 ipv6',
        src: 'iot',
        src_ip: [],
        dest: 'lan',
        dest_ip: ['192.168.8.10'],
        proto: '',
        target: 'DROP',
        enabled: true,
      },
    ]),
  'firewall.add_acl_rule': (s, a) => {
    keep<Record<string, unknown>[]>(s, 'acl', () => []).push({ ...a, id: nextId++ });
    return {};
  },
  'firewall.edit_acl_rule': (s, a) => {
    const rule = keep<Record<string, unknown>[]>(s, 'acl', () => []).find((x) => String(x.id) === String(a.id));
    if (rule) Object.assign(rule, a);
    return {};
  },
  'firewall.delete_acl_rule': (s, a) => {
    const list = keep<Record<string, unknown>[]>(s, 'acl', () => []);
    s.extra.set(
      'acl',
      list.filter((x) => String(x.id) !== String(a.id)),
    );
    return {};
  },
  'firewall.get_rule_list': (_s) => ({ res: [] }),
  'dpi.get_dpi_stats': (_s) => ({ traffic_day: 4_200_000_000, content_protection_day: 37, content_protection_all: 18_204, qos: 0 }),
  'dpi.get_dpi_config': (_s) => ({ ota_version: '2.4.1', lib_version: '2026.10.01', lib_update_auto: true, ota_update_auto: true }),
  'dpi.check_dpi_upgrade': (_s) => ({ upgrade_available: false }),
  'dpi.check_lib_upgrade': (_s) => ({ upgrade_available: true, lib_new_version: '2026.10.20' }),

  /* dns */
  'dns.get_info': (_s) => [
    {
      provider: 'cloudflare',
      sup_proto: ['dot', 'doh'],
      server_list: [
        { name: 'Standard', description: 'Nothing is filtered.' },
        { name: 'Families', description: 'Blocks malware and adult content.' },
      ],
    },
    {
      provider: 'quad9',
      sup_proto: ['dot', 'doh'],
      server_list: [{ name: 'Recommended', description: 'Malware blocking, DNSSEC validation.' }],
    },
    { provider: 'nextdns', sup_proto: ['dot', 'doh'] },
    {
      provider: 'adguard_dns',
      sup_proto: ['dot', 'doh', 'doq'],
      server_list: [{ name: 'Default', description: 'Blocks ads and trackers.' }],
    },
  ],
  'dns.get_host': (s) => keep(s, 'hosts', () => ({ content: '192.168.8.10 nas.home\n192.168.8.11 proxmox.home' })),
  'dns.set_host': (s, a) => {
    s.extra.set('hosts', { content: a.content });
    return {};
  },
  'adguard:stats': (_s) => ({
    num_dns_queries: 48_211,
    num_blocked_filtering: 9_874,
    num_replaced_safebrowsing: 12,
    num_replaced_parental: 0,
    avg_processing_time: 0.0123,
    time_units: 'hours',
    dns_queries: series(24, 2000),
    blocked_filtering: series(24, 400),
    top_queried_domains: [
      { 'apple.com': 3120 },
      { 'netflix.com': 2840 },
      { 'github.com': 1902 },
      { 'youtube.com': 1650 },
      { 'icloud.com': 1210 },
    ],
    top_blocked_domains: [
      { 'doubleclick.net': 2104 },
      { 'app-measurement.com': 1380 },
      { 'graph.facebook.com': 822 },
      { 'ads.tiktok.com': 610 },
    ],
    top_clients: [{ '192.168.8.30': 12_400 }, { '192.168.8.20': 9_800 }, { '192.168.8.41': 7_100 }],
  }),
  'adguard:querylog': (_s) => ({
    data: [
      {
        time: new Date().toISOString(),
        client: '192.168.8.41',
        question: { name: 'graph.instagram.com', type: 'A' },
        reason: 'NotFilteredNotFound',
        elapsedMs: '4.1',
      },
      {
        time: new Date(Date.now() - 4000).toISOString(),
        client: '192.168.8.30',
        question: { name: 'doubleclick.net', type: 'A' },
        reason: 'FilteredBlackList',
        elapsedMs: '0.3',
      },
      {
        time: new Date(Date.now() - 9000).toISOString(),
        client: '192.168.8.20',
        question: { name: 'github.com', type: 'AAAA' },
        reason: 'NotFilteredNotFound',
        elapsedMs: '12.8',
      },
    ],
  }),
  'adguard:filtering/status': (_s) => ({
    enabled: true,
    filters: [
      {
        id: 1,
        name: 'AdGuard DNS filter',
        url: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt',
        enabled: true,
        rules_count: 61_204,
      },
      { id: 2, name: 'OISD Big', url: 'https://big.oisd.nl', enabled: false, rules_count: 0 },
    ],
  }),

  /* vpn */
  'vpn-client.get_tunnel': (s) =>
    keep(s, 'tunnels', () => ({ global_enabled: false, max_tunnels: 5, tunnels: [], default_tunnels: [{ enabled: true }] })),
  'vpn-client.get_all_config_list': (_s) => ({
    configs: { wireguard: [{ group_id: 7, group_name: 'Home VPN', peers: [{ peer_id: 1, name: 'Amsterdam' }] }], openvpn: [] },
  }),
  'vpn-client.get_connection_methods': (_s) => ({ connection_methods: ['lan', 'guest', 'iot'] }),
  'vpn-client.add_tunnel': (s, a) => {
    const t = keep<{ tunnels: unknown[] }>(s, 'tunnels', () => ({ tunnels: [] }));
    t.tunnels.push({ ...a, tunnel_id: nextId++, enabled: true, killswitch: false });
    return {};
  },
  'vpn-client.remove_tunnel': (s, a) => {
    const t = keep<{ tunnels: { tunnel_id: number }[] }>(s, 'tunnels', () => ({ tunnels: [] }));
    t.tunnels = t.tunnels.filter((x) => x.tunnel_id !== a.tunnel_id);
    return {};
  },
  'vpn-client.set_default_tunnel': (s, a) => {
    keep<Args>(s, 'tunnels', () => ({ tunnels: [] })).default_tunnels = [{ enabled: a.enabled }];
    return {};
  },
  'wg-client.confirm_config': (s, a) => countProfile(wgGroups(s), a, 'peer_count'),
  'ovpn-client.confirm_config': (s, a) => countProfile(ovpnGroups(s), a, 'client_count'),
  'wg-client.get_group_list': (s) => ({ groups: wgGroups(s) }),
  'wg-client.add_group': (s, a) => addGroup(wgGroups(s), a),
  'ovpn-client.get_group_list': (s) => ({ groups: ovpnGroups(s) }),
  'ovpn-client.add_group': (s, a) => addGroup(ovpnGroups(s), a),
  'wg-server.get_config': (_s) => ({ initialization: true, address_v4: '10.0.0.1/24', port: 51820, public_key: 'demo-public-key' }),
  'wg-server.get_peer_list': (s) => ({ peers: keep(s, 'peers', () => [{ peer_id: 1, name: 'Maya’s laptop', client_ip: '10.0.0.2/32' }]) }),
  'wg-server.add_peer': (s, a) => {
    const id = nextId++;
    keep<Record<string, unknown>[]>(s, 'peers', () => []).push({ peer_id: id, name: a.name, client_ip: `10.0.0.${id % 250}/32` });
    return { peer_id: id };
  },
  'wg-server.generate_peer': (_s) => ({
    config:
      '[Interface]\nPrivateKey = (demo)\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = demo-public-key\nEndpoint = demo.example:51820\nAllowedIPs = 0.0.0.0/0',
  }),
  'wg-server.remove_peer': (s, a) => {
    const peers = keep<{ peer_id: number }[]>(s, 'peers', () => []);
    s.extra.set(
      'peers',
      peers.filter((p) => p.peer_id !== a.peer_id),
    );
    return {};
  },
  'ovpn-server.get_config': (s) => ovpnServer(s),
  'ovpn-server.set_config': (s, a) => {
    Object.assign(ovpnServer(s), a);
    return {};
  },
  'ovpn-server.generate_certificate': (s) => {
    ovpnServer(s).initialization = true;
    return {};
  },
  'ovpn-server.get_user_list': (s) => ({ user_list: ovpnUsers(s) }),
  'ovpn-server.add_user': (s, a) => {
    ovpnUsers(s).push({ username: String(a.username) });
    return {};
  },
  'ovpn-server.remove_user': (s, a) => {
    s.extra.set(
      'ovpn-users',
      ovpnUsers(s).filter((u) => u.username !== a.username),
    );
    return {};
  },
  'tailscale.get_status': (_s) => ({ status: 3, login_name: 'demo@example.com', address_v4: '100.101.102.103', dns: ['100.100.100.100'] }),
  'tailscale.get_exit_node_list': (_s) => ({ exit_node_list: [{ ip: '100.64.0.9', name: 'office-mac' }] }),

  /* family */
  'parental-control.get_config': (s) =>
    keep(s, 'pc', () => ({
      enable: true,
      groups: [
        {
          id: 'g1',
          name: 'Leo',
          enabled: true,
          macs: ['02:5E:E1:3A:2A:C2', '02:5E:E1:41:2B:C1'],
          schedules_enabled: true,
          schedules_days: 'everyday',
          schedules: [{ week: '0', enabled: true, begin: '20:30', end: '07:00' }],
          category: ['sexual_content', 'gambling', 'malicious_content', 'social_entertainment'],
          apps: ['tiktok'],
          blacklist: [],
        },
      ],
    })),
  'parental-control.set_config': (s, a) => {
    keep<{ enable: boolean }>(s, 'pc', () => ({ enable: false })).enable = Boolean(a.enable);
    return {};
  },
  'parental-control.add_group': (s, a) => {
    keep<{ groups: unknown[] }>(s, 'pc', () => ({ groups: [] })).groups.push({ ...a, id: `g${nextId++}` });
    return {};
  },
  'parental-control.set_group': (s, a) => {
    const pc = keep<{ groups: Record<string, unknown>[] }>(s, 'pc', () => ({ groups: [] }));
    pc.groups = pc.groups.map((g) => (g.id === a.id ? { ...g, ...a } : g));
    return {};
  },
  'parental-control.remove_group': (s, a) => {
    const pc = keep<{ groups: Record<string, unknown>[] }>(s, 'pc', () => ({ groups: [] }));
    pc.groups = pc.groups.filter((g) => g.id !== a.id);
    return {};
  },
  'parental-control.get_app_list': (_s) => [
    {
      category_name: 'social_entertainment',
      apps: [
        { name: 'tiktok', label: 'TikTok' },
        { name: 'instagram', label: 'Instagram' },
        { name: 'youtube', label: 'YouTube' },
      ],
    },
    {
      category_name: 'game',
      apps: [
        { name: 'roblox', label: 'Roblox' },
        { name: 'fortnite', label: 'Fortnite' },
      ],
    },
  ],

  /* traffic */
  'flow_statistics.get_flow_statistics': (_s) => ({
    applications: [
      { label: 'All traffic', download: 182e9, upload: 21e9, total: 203e9 },
      { label: 'Netflix', download: 64e9, upload: 1e9, total: 65e9 },
      { label: 'YouTube', download: 38e9, upload: 0.6e9, total: 38.6e9 },
      { label: 'iCloud', download: 9e9, upload: 12e9, total: 21e9 },
      { label: 'Steam', download: 19e9, upload: 0.2e9, total: 19.2e9 },
      { label: 'Zoom', download: 3.1e9, upload: 2.9e9, total: 6e9 },
    ],
  }),
  'flow_statistics.get_top_app_flow_statistics': (_s) => ({
    top_apps: [{ time_series: series(7, 28e9).map((total, i) => ({ start_time: Math.floor(Date.now() / 1000) - i * 86_400, total })) }],
  }),

  /* device */
  'system.get_load': (_s) => ({
    memory_total: 1_028_000_000,
    memory_free: 512_000_000,
    memory_buff_cache: 180_000_000,
    load_average: [0.31, 0.27, 0.22],
  }),
  'system.get_usb_info': (_s) => [
    { value: 'usb2', label: 'USB 2.0' },
    { value: 'usb3', label: 'USB 3.0' },
  ],
  'system.get_timezone_list': (_s) => ({
    timezone_list: [
      { zonename: 'America/New_York', timezone: 'EST5EDT,M3.2.0,M11.1.0' },
      { zonename: 'America/Los_Angeles', timezone: 'PST8PDT,M3.2.0,M11.1.0' },
      { zonename: 'Europe/London', timezone: 'GMT0BST,M3.5.0/1,M10.5.0' },
      { zonename: 'Europe/Paris', timezone: 'CET-1CEST,M3.5.0,M10.5.0/3' },
      { zonename: 'Asia/Tokyo', timezone: 'JST-9' },
    ],
  }),
  'upgrade.check_firmware_online': (_s) => ({
    current_version: '4.10.1',
    current_type: 'release',
    current_compile_time: '2026-09-18 18:54:58',
  }),
  'timer.get_wifi': (s) => ({ wifi: wifiTimers(s) }),
  'timer.set_wifi': (s, a) => {
    const next = a.wifi as Args[];
    s.extra.set(
      'wifi-timers',
      wifiTimers(s).map((w) => next.find((n) => n.band === w.band && n.guest === w.guest) ?? w),
    );
    return {};
  },
  'upgrade.check_firmware_local': (_s) => ({ version: '4.10.2', firmware_type: 'release', sha256: 'c0ffee', status: 0 }),
  'logread.get_system_log': (_s) => ({ log: LOG() }),
  'logread.get_kernel_log': (_s) => ({ log: '[    0.000000] Booting Linux on physical CPU 0x0\n[    2.410000] demo: all good' }),
  'logread.get_crash_log': (_s) => ({ log: '' }),
  'logread.get_nginx_log': (_s) => ({ log: '' }),
  'luci.get_status': (_s) => ({ status: 2 }),
  'bark.get_status': (_s) => ({ status: 0 }),
  'network.get_available_address_list': (_s) => ({ domain: ['demo1234.glddns.com'], pub_ip: ['198.51.100.24'], wan_ip: ['192.168.1.20'] }),
  'netmode.get_mode': (_s) => ({ mode: 'router' }),
  'edgerouter.get_status': (_s) => ({ detected: 0 }),
  'mesh.get_onbd_scan_status': (_s) => ({ status: 'done', nodes: [{ mac: '02:5E:E1:77:00:01', model: 'GL-MT6000', signal: -58 }] }),

  /* OpenWrt through LuCI */
  // like the stock LuCI ACLs: everything the console uses, but not procd's `rc`
  'ubus:session.access': (_s, a) => ({ access: a.object !== 'rc' }),
  'ubus:uci.get': (s, a) => {
    const conf = (sections(s) as Record<string, Record<string, Record<string, unknown>>>)[String(a.config)] ?? {};
    const values = Object.fromEntries(Object.entries(conf).filter(([, v]) => !a.type || v['.type'] === a.type));
    return { values };
  },
  'ubus:uci.add': (s, a) => {
    const conf = (sections(s) as Record<string, Record<string, Record<string, unknown>>>)[String(a.config)];
    const name = `cfg${nextId++}`;
    if (conf)
      conf[name] = { '.name': name, '.type': a.type, '.anonymous': true, '.index': Object.keys(conf).length, ...(a.values as object) };
    return { section: name };
  },
  'ubus:uci.set': (s, a) => {
    const conf = (sections(s) as Record<string, Record<string, Record<string, unknown>>>)[String(a.config)];
    const sec = conf?.[String(a.section)];
    if (sec) Object.assign(sec, a.values);
    return {};
  },
  'ubus:uci.delete': (s, a) => {
    const conf = (sections(s) as Record<string, Record<string, Record<string, unknown>>>)[String(a.config)];
    const sec = conf?.[String(a.section)];
    if (!conf || !sec) return {};
    if (Array.isArray(a.options)) for (const o of a.options) delete sec[o as string];
    else delete conf[String(a.section)];
    return {};
  },
  'ubus:network.interface.dump': (_s) => ({
    interface: [
      { interface: 'lan', up: true, l3_device: 'br-lan' },
      { interface: 'wan', up: true, l3_device: 'eth0' },
      { interface: 'guest', up: true, l3_device: 'br-guest' },
      { interface: 'iot', up: true, l3_device: 'br-iot' },
      { interface: 'secondwan', up: false, l3_device: 'eth1' },
    ],
  }),
  'ubus:file.exec': (s, a) => {
    const params = (a.params as string[] | undefined) ?? [];
    if (a.command === '/sbin/ip')
      return {
        code: 0,
        stdout: [
          'default via 192.168.1.1 dev eth0 proto static src 192.168.1.20 metric 10',
          '10.50.0.0/24 via 192.168.8.11 dev br-lan proto static',
          '192.168.8.0/24 dev br-lan proto kernel scope link src 192.168.8.1',
          '192.168.9.0/24 dev br-guest proto kernel scope link src 192.168.9.1',
          '100.64.0.0/10 dev tailscale0 table 52',
        ].join('\n'),
      };
    if (a.command === '/usr/libexec/opkg-call') return { code: 0, stdout: opkgCall(s, params) };
    if (a.command === '/usr/libexec/zeeli-update') return { code: 0, stdout: `Installed Zeeli Controller ${params[1]}` };
    return { code: 0, stdout: '' };
  },
  'ubus:luci-rpc.getDHCPLeases': (s, a) =>
    a.family === 6
      ? { dhcp6_leases: [] }
      : {
          dhcp_leases: s.clients
            .filter((c) => c.online)
            .map((c, i) => ({ hostname: c.name, ipaddr: c.ip, macaddr: c.mac, expires: 3600 * (i + 1) })),
        },
  'ubus:luci-rpc.getHostHints': (_s) => ({}),
};
