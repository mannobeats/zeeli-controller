import {
  type Icon,
  IconApps,
  IconChartBar,
  IconDevices,
  IconHeartHandshake,
  IconLayoutDashboard,
  IconNetwork,
  IconSettings,
  IconShieldLock,
  IconSitemap,
  IconWorldLongitude,
} from '@tabler/icons-react';
import { APP_CATALOG } from '@zeeli/router-api';

export interface Page {
  id: string;
  title: string;
  /** Words people might type in the command palette to find this page. */
  keywords?: string;
}

export interface Group {
  label?: string;
  pages: Page[];
}

export interface Section {
  id: string;
  title: string;
  icon: Icon;
  /** The page fills the section panel itself (Clients puts its filters there). */
  panel?: boolean;
  groups: Group[];
}

/** Where an app opens: its own page, or the generic app page `app-<id>`. */
export const appPageId = (a: { id: string; page?: string }) => a.page ?? `app-${a.id}`;
const ADD_ONS: Page[] = APP_CATALOG.filter((a) => !a.page).map((a) => ({
  id: appPageId(a),
  title: a.name,
  keywords: `${(a.packages ?? []).join(' ')} ${a.category}`.toLowerCase(),
}));

/** The whole information architecture. Order here is order on screen. */
export const SECTIONS: Section[] = [
  {
    id: 'overview',
    title: 'Overview',
    icon: IconLayoutDashboard,
    groups: [
      {
        pages: [
          { id: 'dashboard', title: 'Dashboard', keywords: 'home status health' },
          { id: 'activity', title: 'Activity', keywords: 'events log timeline history' },
        ],
      },
    ],
  },
  {
    id: 'topology',
    title: 'Topology',
    icon: IconSitemap,
    groups: [{ pages: [{ id: 'topology', title: 'Topology', keywords: 'map canvas diagram' }] }],
  },
  {
    id: 'clients',
    title: 'Clients',
    icon: IconDevices,
    panel: true,
    groups: [{ pages: [{ id: 'clients', title: 'Clients', keywords: 'devices block forget rename limit' }] }],
  },
  {
    id: 'insights',
    title: 'Insights',
    icon: IconChartBar,
    groups: [
      {
        pages: [
          { id: 'traffic', title: 'Traffic', keywords: 'usage statistics apps bandwidth' },
          { id: 'dns-insights', title: 'DNS queries', keywords: 'adguard blocked domains queries' },
        ],
      },
    ],
  },
  {
    id: 'network',
    title: 'Network',
    icon: IconNetwork,
    groups: [
      {
        pages: [
          { id: 'internet', title: 'Internet', keywords: 'wan uplink repeater pppoe static' },
          { id: 'wifi', title: 'WiFi', keywords: 'wireless ssid password band guest iot hidden channel' },
          { id: 'networks', title: 'Networks and VLANs', keywords: 'subnet vlan guest iot lan' },
          { id: 'ports', title: 'Ethernet ports', keywords: 'wan lan port mac clone vlan tagging' },
          { id: 'dhcp', title: 'DHCP and leases', keywords: 'reservation static ip lease' },
          { id: 'routes', title: 'Routing', keywords: 'static route gateway' },
          { id: 'multiwan', title: 'Multi-WAN', keywords: 'failover load balance' },
          { id: 'mesh', title: 'Mesh', keywords: 'nodes extender' },
        ],
      },
      {
        label: 'Traffic shaping',
        pages: [
          { id: 'qos', title: 'QoS', keywords: 'priority' },
          { id: 'sqm', title: 'SQM', keywords: 'bufferbloat cake latency' },
        ],
      },
      {
        label: 'Advanced',
        pages: [
          { id: 'ipv6', title: 'IPv6' },
          { id: 'igmp', title: 'IGMP snooping', keywords: 'multicast' },
          { id: 'accel', title: 'NAT and acceleration', keywords: 'hardware offload nat' },
          { id: 'edgerouter', title: 'EdgeRouter' },
        ],
      },
    ],
  },
  {
    id: 'security',
    title: 'Security',
    icon: IconShieldLock,
    groups: [
      {
        pages: [
          { id: 'firewall', title: 'Firewall rules', keywords: 'allow drop reject zone' },
          { id: 'forwarding', title: 'Port forwarding', keywords: 'nat open port' },
          { id: 'dns', title: 'DNS and filtering', keywords: 'adguard encrypted dns doh dot rebinding' },
          { id: 'content', title: 'Content filter', keywords: 'categories block sites' },
          { id: 'access', title: 'Access control', keywords: 'allow list block list mac' },
          { id: 'remote', title: 'Remote management', keywords: 'wan access ssh https' },
        ],
      },
    ],
  },
  {
    id: 'family',
    title: 'Family',
    icon: IconHeartHandshake,
    groups: [{ pages: [{ id: 'parental', title: 'Parental control', keywords: 'kids bedtime pause schedule' }] }],
  },
  {
    id: 'vpn',
    title: 'VPN',
    icon: IconWorldLongitude,
    groups: [
      {
        pages: [
          { id: 'vpn', title: 'Overview' },
          { id: 'tunnels', title: 'Tunnels', keywords: 'policy routing vpn client' },
          { id: 'profiles', title: 'Client profiles', keywords: 'wireguard openvpn import' },
        ],
      },
      {
        label: 'Servers',
        pages: [
          { id: 'wgserver', title: 'WireGuard server', keywords: 'peers' },
          { id: 'ovpnserver', title: 'OpenVPN server' },
        ],
      },
      {
        label: 'Mesh VPNs',
        pages: [
          { id: 'tailscale', title: 'Tailscale' },
          { id: 'zerotier', title: 'ZeroTier' },
        ],
      },
    ],
  },
  {
    id: 'apps',
    title: 'Apps',
    icon: IconApps,
    groups: [
      { pages: [{ id: 'apps', title: 'App store', keywords: 'install plugins' }] },
      {
        label: 'Built in',
        pages: [
          { id: 'adguard', title: 'AdGuard Home' },
          { id: 'tor', title: 'Tor' },
          { id: 'ddns', title: 'Dynamic DNS' },
          { id: 'bark', title: 'Bark alerts', keywords: 'notifications push' },
          { id: 'dpi', title: 'App detection', keywords: 'dpi signatures' },
        ],
      },
      { label: 'Add-ons', pages: ADD_ONS },
      { label: 'Advanced', pages: [{ id: 'packages', title: 'Packages', keywords: 'opkg' }] },
    ],
  },
  {
    id: 'system',
    title: 'System',
    icon: IconSettings,
    groups: [
      {
        pages: [
          { id: 'device', title: 'Device', keywords: 'hardware fan led reboot cpu memory' },
          { id: 'firmware', title: 'Firmware', keywords: 'update upgrade' },
          { id: 'schedules', title: 'Schedules', keywords: 'reboot led wifi timer' },
          { id: 'time', title: 'Time zone' },
          { id: 'logs', title: 'Logs', keywords: 'syslog kernel' },
          { id: 'admin', title: 'Admin and access', keywords: 'password luci ssh' },
          { id: 'mode', title: 'Operating mode', keywords: 'bridge extender access point' },
          { id: 'reset', title: 'Factory reset' },
        ],
      },
    ],
  },
];

export const PAGES = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.pages.map((p) => ({ ...p, section: s }))));
export const pageById = (id: string) => PAGES.find((p) => p.id === id);
export const DEFAULT_PAGE = 'dashboard';
