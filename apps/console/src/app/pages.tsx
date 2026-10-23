import { APP_CATALOG } from '@zeeli/router-api';
import { type ComponentType, type LazyExoticComponent, lazy } from 'react';
import { appPageId } from './nav.ts';

type Loader = () => Promise<Record<string, ComponentType>>;
/** Lazy-load `name` from a feature module, so each area loads on first visit. */
const from = (load: Loader, name = 'default') => lazy(async () => ({ default: (await load())[name] as ComponentType }));

const network = () => import('../features/network/pages.tsx');
const advanced = () => import('../features/network/advanced.tsx');
const security = () => import('../features/security/pages.tsx');
const vpn = () => import('../features/vpn/pages.tsx');
const servers = () => import('../features/vpn/servers.tsx');
const apps = () => import('../features/apps/pages.tsx');
const system = () => import('../features/system/pages.tsx');
const insights = () => import('../features/insights/pages.tsx');

export const PAGE_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  dashboard: from(() => import('../features/dashboard/DashboardPage.tsx')),
  activity: from(() => import('../features/activity/ActivityPage.tsx')),
  alerts: from(() => import('../features/alerts/AlertsPage.tsx')),
  topology: from(() => import('../features/topology/TopologyPage.tsx')),
  clients: from(() => import('../features/clients/ClientsPage.tsx')),
  traffic: from(insights, 'TrafficPage'),
  'dns-insights': from(insights, 'DnsInsightsPage'),

  internet: from(() => import('../features/internet/InternetPage.tsx')),
  wifi: from(() => import('../features/wifi/WifiPage.tsx')),
  networks: from(() => import('../features/networks/NetworksPage.tsx')),
  ports: from(network, 'PortsPage'),
  dhcp: from(network, 'DhcpPage'),
  routes: from(network, 'RoutesPage'),
  multiwan: from(network, 'MultiWanPage'),
  mesh: from(network, 'MeshPage'),
  qos: from(advanced, 'QosPage'),
  sqm: from(advanced, 'SqmPage'),
  ipv6: from(advanced, 'Ipv6Page'),
  igmp: from(advanced, 'IgmpPage'),
  accel: from(advanced, 'AccelPage'),
  edgerouter: from(advanced, 'EdgeRouterPage'),

  firewall: from(() => import('../features/firewall/FirewallPage.tsx')),
  forwarding: from(security, 'ForwardingPage'),
  dns: from(() => import('../features/dns/DnsPage.tsx')),
  content: from(security, 'ContentPage'),
  access: from(security, 'AccessPage'),
  remote: from(security, 'RemotePage'),

  parental: from(() => import('../features/family/ParentalPage.tsx')),

  vpn: from(vpn, 'VpnOverviewPage'),
  tunnels: from(vpn, 'TunnelsPage'),
  profiles: from(vpn, 'ProfilesPage'),
  wgserver: from(servers, 'WireGuardPage'),
  ovpnserver: from(servers, 'OpenVpnPage'),
  tailscale: from(vpn, 'TailscalePage'),
  zerotier: from(vpn, 'ZeroTierPage'),

  apps: from(apps, 'AppStorePage'),
  adguard: from(() => import('../features/dns/AdguardPage.tsx')),
  tor: from(apps, 'TorPage'),
  ddns: from(apps, 'DdnsPage'),
  bark: from(apps, 'BarkPage'),
  dpi: from(apps, 'DpiPage'),
  packages: from(() => import('../features/apps/PackagesPage.tsx'), 'PackagesPage'),
  // package apps share one page, which reads the app from the route
  ...Object.fromEntries(
    APP_CATALOG.filter((a) => !a.page).map((a) => [appPageId(a), from(() => import('../features/apps/AppPage.tsx'), 'AppPage')]),
  ),

  device: from(system, 'DevicePage'),
  firmware: from(system, 'FirmwarePage'),
  schedules: from(system, 'SchedulesPage'),
  time: from(system, 'TimePage'),
  logs: from(system, 'LogsPage'),
  admin: from(system, 'AdminPage'),
  mode: from(system, 'ModePage'),
  reset: from(system, 'ResetPage'),
};
