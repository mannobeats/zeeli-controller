import type { Transport } from '../transport/types.ts';
import type { openwrt as openwrtFactory } from './openwrt.ts';

/**
 * The app catalog. Built-in apps ship with the firmware and are switched on or off in
 * their own page; package apps install from the OpenWrt repository. Adding an app is
 * one entry here (and a page in the console if it has settings).
 */
export interface AppDefinition {
  id: string;
  name: string;
  summary: string;
  category: 'Privacy and security' | 'Remote access' | 'Network tools' | 'Home and media' | 'Monitoring';
  /** Console page with the app's settings, if any. */
  page?: string;
  /** Present in the firmware; `service` is its name in system status. */
  builtIn?: { service?: string };
  /** opkg packages that make up the app. */
  packages?: string[];
}

export const APP_CATALOG: AppDefinition[] = [
  {
    id: 'adguard',
    name: 'AdGuard Home',
    summary: 'Blocks ads, trackers and malware for every device, with per-query statistics.',
    category: 'Privacy and security',
    page: 'adguard',
    builtIn: { service: 'adguardhome' },
  },
  {
    id: 'tailscale',
    name: 'Tailscale',
    summary: 'Reach your home network from anywhere over WireGuard, without opening ports.',
    category: 'Remote access',
    page: 'tailscale',
    builtIn: { service: 'tailscale' },
  },
  {
    id: 'zerotier',
    name: 'ZeroTier',
    summary: 'Join this router to a ZeroTier virtual network.',
    category: 'Remote access',
    page: 'zerotier',
    builtIn: { service: 'zerotier' },
  },
  {
    id: 'tor',
    name: 'Tor',
    summary: 'Send traffic through the Tor network for anonymity. Much slower.',
    category: 'Privacy and security',
    page: 'tor',
    builtIn: {},
  },
  {
    id: 'ddns',
    name: 'Dynamic DNS',
    summary: 'A stable name for your home connection, even when its address changes.',
    category: 'Remote access',
    page: 'ddns',
    builtIn: {},
  },
  {
    id: 'bark',
    name: 'Bark',
    summary: 'Bark’s parental monitoring service, linked to your Bark account.',
    category: 'Privacy and security',
    page: 'bark',
    builtIn: {},
  },
  {
    id: 'dpi',
    name: 'App detection',
    summary: 'Recognises apps in traffic, for per-app statistics, QoS and blocking.',
    category: 'Monitoring',
    page: 'dpi',
    builtIn: {},
  },
  {
    id: 'samba',
    name: 'File sharing (SMB)',
    summary: 'Share a USB drive with computers on your network.',
    category: 'Home and media',
    packages: ['samba4-server'],
  },
  {
    id: 'minidlna',
    name: 'Media server (DLNA)',
    summary: 'Stream music and video from a USB drive to TVs and speakers.',
    category: 'Home and media',
    packages: ['minidlna'],
  },
  {
    id: 'vnstat',
    name: 'Traffic history',
    summary: 'Keeps internet usage by hour, day and month, across reboots.',
    category: 'Monitoring',
    packages: ['vnstat2'],
  },
  {
    id: 'nlbwmon',
    name: 'Per-device usage',
    summary: 'Records how much each device downloads and uploads over time.',
    category: 'Monitoring',
    packages: ['nlbwmon'],
  },
  {
    id: 'iperf3',
    name: 'Speed test server',
    summary: 'Measure real throughput between any device and the router.',
    category: 'Network tools',
    packages: ['iperf3'],
  },
  {
    id: 'wol',
    name: 'Wake on LAN',
    summary: 'Wake sleeping computers on your network.',
    category: 'Network tools',
    packages: ['etherwake'],
  },
  {
    id: 'banip',
    name: 'IP blocklists',
    summary: 'Drops traffic to and from known-bad addresses using community lists.',
    category: 'Privacy and security',
    packages: ['banip'],
  },
];

export interface AppState extends AppDefinition {
  installed: boolean;
  running: boolean | null;
}

export const apps = (t: Transport, ow: ReturnType<typeof openwrtFactory>) => ({
  /** Every catalog app with whether it is present and, for services, running. */
  async list(): Promise<AppState[]> {
    const [status, installed] = await Promise.all([
      t.call<{ service?: { name: string; status: number }[] }>('system', 'get_status'),
      ow.packages.installed().catch(() => null),
    ]);
    const names = new Set((installed ?? []).map((p) => p.name));
    const service = (n?: string) => (n ? (status.service ?? []).find((s) => s.name === n) : undefined);
    return APP_CATALOG.map((a) => {
      const svc = service(a.builtIn?.service);
      return {
        ...a,
        installed: a.builtIn ? true : (a.packages ?? []).every((p) => names.has(p)),
        running: svc ? svc.status === 1 : null,
      };
    });
  },
  async install(a: AppDefinition) {
    for (const p of a.packages ?? []) await ow.packages.install(p);
  },
  async remove(a: AppDefinition) {
    for (const p of [...(a.packages ?? [])].reverse()) await ow.packages.remove(p);
  },
});
