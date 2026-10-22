import { settings } from '../settings.ts';
import type { Transport } from '../transport/types.ts';

/* ---------- port forwarding ---------- */

export interface PortForward {
  id: string;
  name: string;
  proto: 'tcp udp' | 'tcp' | 'udp';
  src: string;
  srcPort: string;
  dest: string;
  destIp: string;
  destPort: string;
  enabled: boolean;
}
interface RawForward {
  id: string | number;
  name: string;
  proto: PortForward['proto'];
  src: string;
  src_dport: string;
  dest: string;
  dest_ip: string;
  dest_port: string;
  enabled: boolean;
}
const toRaw = (f: Omit<PortForward, 'id'>) => ({
  name: f.name,
  proto: f.proto,
  src: f.src,
  src_dport: f.srcPort,
  dest: f.dest,
  dest_ip: f.destIp,
  dest_port: f.destPort,
  enabled: f.enabled,
});

export interface Dmz {
  enabled: boolean;
  dest_ip?: string;
  priority?: boolean;
}

export interface Zones {
  internals: string[];
  externals: string[];
}

/* ---------- content filter ---------- */

export const CONTENT_CATEGORIES = {
  adult: 'Adult',
  gambling: 'Gambling',
  malware: 'Malware and phishing',
  dangerous_website: 'Dangerous sites',
  advertisement: 'Ads',
  social_entertainment: 'Social and video',
  game: 'Games',
  shopping: 'Shopping',
} as const;
export type ContentCategory = keyof typeof CONTENT_CATEGORIES;

export interface ContentFilter {
  enable: boolean;
  category_list: string[];
  app_list?: (string | { name: string })[];
  domain_list?: string[];
}

/* ---------- access control ---------- */

export interface AccessRule {
  id: string;
  name: string;
  family: string;
  src: string;
  srcIps: string[];
  dest: string;
  destIps: string[];
  proto: string;
  destPort: string;
  target: 'ACCEPT' | 'DROP';
  enabled: boolean;
}
interface RawAcl {
  id: string | number;
  name: string;
  family?: string;
  src: string;
  src_ip?: string[];
  dest: string;
  dest_ip?: string[];
  proto?: string;
  dest_port?: string;
  target: 'ACCEPT' | 'DROP';
  enabled: boolean;
}
const aclToRaw = (r: Omit<AccessRule, 'id'>) => ({
  name: r.name,
  family: r.family || 'ipv4 ipv6',
  src: r.src,
  src_ip: r.srcIps,
  dest: r.dest,
  dest_ip: r.destIps,
  proto: r.proto,
  target: r.target,
  enabled: r.enabled,
  ...(r.destPort ? { dest_port: r.destPort } : {}),
});

/* ---------- remote management ---------- */

export interface RemoteAccess {
  enable_https: boolean;
  enable_ssh: boolean;
  enable_ping: boolean;
  enable_whitelist: boolean;
  whitelist: { ipaddr: string; name: string }[];
}

export interface LocalAccess {
  http_port: number;
  https_port: number;
  redirect_https: boolean;
  ssh_enabled: boolean;
  ssh_port: number;
  session_timeout: number;
  luci_http_port?: number;
  luci_https_port?: number;
  luci_redirect_https?: boolean;
}

export const security = (t: Transport) => ({
  async forwards(): Promise<PortForward[]> {
    const r = await t.call<{ res?: RawForward[] }>('firewall', 'get_port_forward_list');
    return (r.res ?? []).map((f) => ({
      id: String(f.id),
      name: f.name,
      proto: f.proto,
      src: f.src,
      srcPort: f.src_dport,
      dest: f.dest,
      destIp: f.dest_ip,
      destPort: f.dest_port,
      enabled: f.enabled,
    }));
  },
  zones: () => t.call<Zones>('firewall', 'get_zone_list'),
  saveForward: (f: Omit<PortForward, 'id'>, id?: string) =>
    id ? t.call('firewall', 'set_port_forward', { ...toRaw(f), id }) : t.call('firewall', 'add_port_forward', toRaw(f)),
  async setForwardsEnabled(list: PortForward[], enabled: boolean) {
    for (const f of list) await t.call('firewall', 'set_port_forward', { ...toRaw({ ...f, enabled }), id: f.id });
  },
  async removeForwards(list: PortForward[]) {
    for (const f of list) await t.call('firewall', 'remove_port_forward', { id: f.id });
  },
  dmz: settings<Dmz>(t, 'firewall', { get: 'get_dmz', set: 'set_dmz' }),

  content: settings<ContentFilter>(t, 'dpi', { get: 'get_content_protection', set: 'set_content_protection' }),
  dpiStats: () =>
    t
      .call<{ traffic_day: number; content_protection_day: number; content_protection_all: number }>('dpi', 'get_dpi_stats')
      .catch(() => null),

  async accessRules(): Promise<AccessRule[]> {
    const r = await t.call<RawAcl[] | { res?: RawAcl[] }>('firewall', 'get_acl_rule_list');
    const list = Array.isArray(r) ? r : (r.res ?? []);
    return list.map((x) => ({
      id: String(x.id),
      name: x.name,
      family: x.family ?? 'ipv4 ipv6',
      src: x.src,
      srcIps: (x.src_ip ?? []).filter(Boolean),
      dest: x.dest,
      destIps: (x.dest_ip ?? []).filter(Boolean),
      proto: x.proto ?? '',
      destPort: /any/i.test(x.dest_port ?? '') ? '' : (x.dest_port ?? ''),
      target: x.target,
      enabled: x.enabled,
    }));
  },
  aclZones: () => t.call<Zones>('firewall', 'get_acl_zone_list'),
  saveAccessRule: (r: Omit<AccessRule, 'id'>, id?: string) =>
    id ? t.call('firewall', 'edit_acl_rule', { ...aclToRaw(r), id }) : t.call('firewall', 'add_acl_rule', aclToRaw(r)),
  async setAccessRulesEnabled(list: AccessRule[], enabled: boolean) {
    for (const r of list) await t.call('firewall', 'edit_acl_rule', { ...aclToRaw({ ...r, enabled }), id: r.id });
  },
  async removeAccessRules(list: AccessRule[]) {
    for (const r of list) await t.call('firewall', 'delete_acl_rule', { id: r.id });
  },

  wanAccess: settings<RemoteAccess>(t, 'firewall', { get: 'get_wan_access', set: 'set_wan_access' }),
  openPorts: async () =>
    (
      await t.call<{ res?: { name: string; proto: string; dest_port?: string; port?: string; enabled: boolean }[] }>(
        'firewall',
        'get_rule_list',
      )
    ).res ?? [],
  localAccess: settings<LocalAccess>(t, 'local-access'),
});
