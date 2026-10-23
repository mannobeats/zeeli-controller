// A believable demo home, invented from scratch. Nothing here comes from a real network.

const now = () => Math.floor(Date.now() / 1000);

interface MockClient {
  mac: string;
  ip: string;
  name: string;
  alias: string;
  class: string;
  online: boolean;
  online_time: number;
  type: number;
  rx: number;
  tx: number;
  total_rx: string;
  total_tx: string;
  limit_rx: number;
  limit_tx: number;
  blocked: boolean;
  remote: boolean;
  iface: string;
  ipv6: string[];
}

type ClientSeed = [name: string, cls: string, type: number, ip: number, online: boolean, rate: number];

// [hostname, class, link type, last octet, online, typical bytes/s]
const DEVICES: ClientSeed[] = [
  ['Studio-Mac', 'computer', 2, 20, true, 2_400_000],
  ['nas-01', 'nas', 2, 10, true, 640_000],
  ['homelab-proxmox', 'server', 2, 11, true, 180_000],
  ['ci-runner', 'server', 2, 12, true, 42_000],
  ['Living-Room-TV', 'television', 9, 30, true, 3_100_000],
  ['Maya-iPhone', 'phone', 11, 41, true, 96_000],
  ['Leo-iPad', 'pad', 1, 42, true, 410_000],
  ['Leo-Switch', 'games', 1, 43, true, 1_250_000],
  ['Office-Laptop', 'laptop', 9, 44, true, 220_000],
  ['Kitchen-Speaker', 'sound', 0, 50, true, 18_000],
  ['Thermostat', 'smartappliances', 15, 51, true, 600],
  ['Front-Door-Cam', 'camera', 16, 52, true, 160_000],
  ['Garage-Cam', 'camera', 16, 53, false, 0],
  ['Printer', 'printer', 0, 60, false, 0],
  ['Guest-Phone', 'phone', 4, 120, true, 34_000],
  ['Old-Kindle', 'pad', 0, 61, false, 0],
  ['Watch', 'watch', 1, 45, true, 1_200],
  ['Backup-Pi', 'server', 2, 13, true, 7_500],
];

const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();

function seedClients(): MockClient[] {
  return DEVICES.map(([name, cls, type, octet, online, rate], i) => {
    const guest = type === 4;
    const iot = type === 15 || type === 16;
    const subnet = guest ? '192.168.9' : iot ? '192.168.10' : '192.168.8';
    return {
      mac: `02:5E:E1:${hex(i * 7 + 16)}:${hex(octet)}:${hex(200 - i)}`,
      ip: `${subnet}.${octet}`,
      name,
      alias: '',
      class: cls,
      online,
      online_time: now() - (online ? 3600 * (i + 2) : 86_400 * (i - 10)),
      type,
      rx: rate,
      tx: Math.round(rate * 0.18),
      total_rx: String(Math.round(rate * 9_000 + 2e8 * (i + 1))),
      total_tx: String(Math.round(rate * 1_600 + 4e7 * (i + 1))),
      limit_rx: name === 'Leo-Switch' ? 1280 : 0,
      limit_tx: 0,
      blocked: name === 'Old-Kindle',
      remote: false,
      iface: type === 2 ? 'br-lan' : 'wlan',
      ipv6: [],
    };
  });
}

/** Every value is a fresh copy, so mutations in one demo session never leak into the seed. */
export const seed = () => ({
  info: {
    model: 'GL-BE9300',
    firmware_version: '4.10.1',
    firmware_date: '2026-09-18 18:54:58',
    firmware_type: 'release',
    mac: '02:5E:E1:00:00:01',
    sn: 'DEMO000000000001',
    cpu_num: 4,
    board_info: {
      hostname: 'Zeeli-Demo',
      model: 'GL.iNet GL-BE9300',
      openwrt_version: 'OpenWrt 23.05-SNAPSHOT',
      kernel_version: '5.4.213',
      architecture: 'Qualcomm IPQ5332',
    },
    software_feature: { vpn: true, adguard: true, tor: true, mlo: true, vlan: true, ipv6: true, secondwan: true },
    hardware_feature: { fan: true, wan: 'wan', lan: 'lan1 lan2 lan3 lan4' },
  },
  clients: seedClients(),
  access: { mode: 'black', black_mac: [] as string[], white_mac: [] as string[] },
  autoForget: false,
  /** Everything else the demo remembers, keyed by area. */
  extra: new Map<string, unknown>(),
  subnets: [
    subnet('main', '192.168.8.1', 1, true, 'LAN1 LAN2 LAN3 LAN4', 'Main'),
    subnet('guest', '192.168.9.1', 9, true, '', 'Guest'),
    subnet('iot', '192.168.10.1', 10, true, '', 'IoT'),
    subnet('Lab', '10.20.0.1', 20, true, 'LAN4', ''),
    subnet('Kids', '192.168.11.1', 11, true, '', 'Kids'),
  ],
  binds: [
    { mac: '02:5E:E1:17:0A:C7', ip: '192.168.8.10', name: 'nas-01', display_name: 'main' },
    { mac: '02:5E:E1:1E:0B:C6', ip: '192.168.8.11', name: 'homelab-proxmox', display_name: 'main' },
  ],
});

function subnet(name: string, ip: string, vlan: number, enabled: boolean, wired: string, wifi: string) {
  const base = ip.split('.').slice(0, 3).join('.');
  return {
    display_name: name,
    ip,
    netmask: '255.255.255.0',
    gateway: '',
    vlan_id: vlan,
    enabled,
    dhcp_enable: true,
    dhcp_start_ip: `${base}.100`,
    dhcp_end_ip: `${base}.249`,
    leasetime: '12h',
    isolate: name === 'guest',
    wan_access_mode: name === 'iot' ? 1 : 0,
    dns: [] as string[],
    lpr: [] as unknown[],
    transfer_enable: 0,
    ifaces: [
      ...wired
        .split(' ')
        .filter(Boolean)
        .map((n) => ({ name: n, conn_type: 'wired', state: n === 'LAN1' ? 'up' : 'down' })),
      ...(wifi ? [{ name: wifi, conn_type: 'wifi', state: 'up' }] : []),
    ],
  };
}

export type MockState = ReturnType<typeof seed>;
