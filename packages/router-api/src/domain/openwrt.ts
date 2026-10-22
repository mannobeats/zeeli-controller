import { RouterError } from '../errors.ts';
import { maskToPrefix, parseRoute, type Route } from '../net.ts';
import type { Transport } from '../transport/types.ts';

/** A UCI section as ubus returns it: options plus `.name`, `.type`, `.anonymous`, `.index`. */
export type UciSection = Record<string, string | string[] | boolean | number | undefined> & {
  '.name': string;
  '.type': string;
  '.anonymous': boolean;
  '.index': number;
};
type Values = Record<string, string | string[]>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (v: unknown) => (Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v));

/* ---------- firewall ---------- */

export type FirewallTarget = 'ACCEPT' | 'REJECT' | 'DROP';
export type RuleOrigin = 'service' | 'default' | 'custom';

export interface FirewallZone {
  name: string;
  input: FirewallTarget;
  output: FirewallTarget;
  forward: FirewallTarget;
  masquerade: boolean;
}
export interface ZoneForward {
  src: string;
  dest: string;
  enabled: boolean;
}
export interface FirewallRule {
  id: string;
  name: string;
  src: string;
  dest: string;
  proto: string;
  destPort: string;
  srcIp: string;
  destIp: string;
  target: FirewallTarget;
  family: '' | 'ipv4' | 'ipv6';
  enabled: boolean;
  /** Who made it decides what the console lets you do with it. */
  origin: RuleOrigin;
}
export type RuleInput = Omit<FirewallRule, 'id' | 'origin'>;

const toRule = (r: UciSection): FirewallRule => ({
  id: r['.name'],
  name: text(r.name) || (r['.anonymous'] ? 'Unnamed rule' : r['.name']),
  src: text(r.src),
  dest: text(r.dest),
  proto: text(r.proto) || 'tcp udp',
  destPort: text(r.dest_port),
  srcIp: text(r.src_ip),
  destIp: text(r.dest_ip),
  target: (text(r.target) || 'ACCEPT') as FirewallTarget,
  family: text(r.family) as FirewallRule['family'],
  enabled: r.enabled !== '0',
  origin: !r['.anonymous'] ? 'service' : /^Allow-/.test(text(r.name)) ? 'default' : 'custom',
});

/* ---------- routes ---------- */

export interface StaticRoute {
  id: string;
  /** CIDR, e.g. 192.168.50.0/24 */
  target: string;
  gateway: string;
  interface: string;
  metric: string;
  enabled: boolean;
}
export interface NetInterface {
  name: string;
  up: boolean;
  device: string;
}

/* ---------- DHCP ---------- */

export interface Lease {
  hostname: string;
  ip: string;
  mac: string;
  /** Seconds left, or null for a lease that never expires. */
  expires: number | null;
}
export interface Lease6 {
  hostname: string;
  ip: string;
  duid: string;
  expires: number | null;
}

/* ---------- packages ---------- */

export interface Package {
  name: string;
  version: string;
  size?: number;
  description?: string;
}
const parsePackages = (out: string): Package[] =>
  out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', version = '', ...rest] = line.split(' - ');
      return { name, version, description: rest.join(' - ') };
    });

export const openwrt = (t: Transport) => {
  const uci = {
    async sections(config: string, type?: string): Promise<UciSection[]> {
      const { values = {} } = await t.ubus<{ values?: Record<string, UciSection> }>('uci', 'get', {
        config,
        ...(type ? { type } : {}),
      });
      return Object.values(values).sort((a, b) => a['.index'] - b['.index']);
    },
    add: (config: string, type: string, values: Values) => t.ubus('uci', 'add', { config, type, values }),
    set: (config: string, section: string, values: Values) => t.ubus('uci', 'set', { config, section, values }),
    unset: (config: string, section: string, options: string[]) =>
      options.length ? t.ubus('uci', 'delete', { config, section, options }) : Promise.resolve(),
    remove: (config: string, section: string) => t.ubus('uci', 'delete', { config, section }),

    /**
     * Stage changes in `config`, then apply them with OpenWrt's rollback: if the router
     * can't hear back within `timeout` seconds it reverts on its own, so a firewall or
     * routing mistake can't lock you out. Staged changes are dropped on failure.
     */
    async change(config: string, stage: () => Promise<unknown>, timeout = 30) {
      try {
        await stage();
        await t.ubus('uci', 'apply', { rollback: true, timeout });
        await sleep(2500);
        for (let i = 0; i < 10; i++) {
          try {
            await t.ubus('uci', 'confirm');
            return;
          } catch (err) {
            // code 5: nothing pending, the change applied without needing a confirm
            if (err instanceof RouterError && (err.detail as { code?: number } | undefined)?.code === 5) return;
            await sleep(2000);
          }
        }
        throw new RouterError('failed', `Lost contact with the router after applying. It undoes the change within ${timeout} seconds.`);
      } catch (err) {
        await t.ubus('uci', 'revert', { config }).catch(() => undefined);
        throw err;
      }
    },
  };

  const exec = (command: string, params: string[], timeoutMs = 15_000) =>
    t.ubus<{ code?: number; stdout?: string; stderr?: string }>('file', 'exec', { command, params }, timeoutMs);
  const opkg = async (...params: string[]) => {
    const r = await exec('/usr/libexec/opkg-call', params, 180_000);
    if (r.code) throw new RouterError('failed', (r.stderr || r.stdout || 'opkg failed').trim().split('\n').pop() ?? 'opkg failed');
    return r.stdout ?? '';
  };

  return {
    uci,

    async interfaces(): Promise<NetInterface[]> {
      const r = await t.ubus<{ interface?: { interface: string; up: boolean; l3_device?: string; device?: string }[] }>(
        'network.interface',
        'dump',
      );
      return (r.interface ?? [])
        .filter((i) => i.interface !== 'loopback')
        .map((i) => ({ name: i.interface, up: i.up, device: i.l3_device ?? i.device ?? '' }));
    },

    /* firewall */
    async firewall() {
      const all = await uci.sections('firewall');
      return {
        zones: all
          .filter((x) => x['.type'] === 'zone')
          .map<FirewallZone>((z) => ({
            name: text(z.name),
            input: (text(z.input) || 'ACCEPT') as FirewallTarget,
            output: (text(z.output) || 'ACCEPT') as FirewallTarget,
            forward: (text(z.forward) || 'ACCEPT') as FirewallTarget,
            masquerade: z.masq === '1',
          })),
        forwards: all
          .filter((x) => x['.type'] === 'forwarding')
          .map<ZoneForward>((f) => ({ src: text(f.src), dest: text(f.dest), enabled: f.enabled !== '0' })),
        rules: all.filter((x) => x['.type'] === 'rule').map(toRule),
      };
    },
    saveRule(input: RuleInput, existing?: FirewallRule) {
      const values: Values = {
        name: input.name,
        src: input.src || '*',
        proto: input.proto,
        target: input.target,
        enabled: input.enabled ? '1' : '0',
      };
      const optional: Values = {
        dest: input.dest,
        dest_port: input.destPort,
        src_ip: input.srcIp,
        dest_ip: input.destIp,
        family: input.family,
      };
      const clear: string[] = [];
      for (const [k, v] of Object.entries(optional)) {
        if (v) values[k] = v;
        else if (existing) clear.push(k);
      }
      return uci.change('firewall', async () => {
        if (!existing) return uci.add('firewall', 'rule', values);
        await uci.set('firewall', existing.id, values);
        await uci.unset('firewall', existing.id, clear);
      });
    },
    setRulesEnabled: (rules: FirewallRule[], enabled: boolean) =>
      uci.change('firewall', async () => {
        for (const r of rules) await uci.set('firewall', r.id, { enabled: enabled ? '1' : '0' });
      }),
    removeRules: (rules: FirewallRule[]) =>
      uci.change('firewall', async () => {
        for (const r of rules) await uci.remove('firewall', r.id);
      }),

    /* routes */
    async routes(): Promise<{ statics: StaticRoute[]; table: Route[] }> {
      const [sections, ip] = await Promise.all([
        uci.sections('network', 'route'),
        // the exact command OpenWrt's ACL allows; it has no JSON form
        exec('/sbin/ip', ['-4', 'route', 'show', 'table', 'all']),
      ]);
      return {
        statics: sections.map((r) => {
          const target = text(r.target);
          return {
            id: r['.name'],
            target: target.includes('/') ? target : `${target}/${r.netmask ? maskToPrefix(text(r.netmask)) : 32}`,
            gateway: text(r.gateway),
            interface: text(r.interface),
            metric: text(r.metric),
            enabled: r.disabled !== '1',
          };
        }),
        table: (ip.stdout ?? '')
          .split('\n')
          .map(parseRoute)
          .filter((r): r is Route => r !== null && r.type === 'unicast'),
      };
    },
    saveRoute(route: Omit<StaticRoute, 'id' | 'enabled'>, netmask: string, existing?: StaticRoute) {
      const [ip = ''] = route.target.split('/');
      const values: Values = { interface: route.interface, target: ip, netmask };
      if (route.gateway) values.gateway = route.gateway;
      if (route.metric) values.metric = route.metric;
      return uci.change('network', async () => {
        if (!existing) return uci.add('network', 'route', values);
        await uci.set('network', existing.id, values);
        await uci.unset(
          'network',
          existing.id,
          ['gateway', 'metric'].filter((k) => !values[k]),
        );
      });
    },
    removeRoutes: (routes: StaticRoute[]) =>
      uci.change('network', async () => {
        for (const r of routes) await uci.remove('network', r.id);
      }),

    /* DHCP */
    async leases(): Promise<{ v4: Lease[]; v6: Lease6[]; hints: Record<string, { name?: string }> }> {
      const [v4, v6, hints] = await Promise.all([
        t.ubus<{ dhcp_leases?: { hostname?: string; ipaddr: string; macaddr: string; expires: number | false }[] }>(
          'luci-rpc',
          'getDHCPLeases',
          { family: 4 },
        ),
        t
          .ubus<{
            dhcp6_leases?: { hostname?: string; ip6addr?: string; ip6addrs?: string[]; duid: string; expires: number | false }[];
          }>('luci-rpc', 'getDHCPLeases', { family: 6 })
          .catch(() => ({ dhcp6_leases: [] })),
        t.ubus<Record<string, { name?: string }>>('luci-rpc', 'getHostHints').catch(() => ({})),
      ]);
      const left = (e: number | false) => (e === false || e < 0 ? null : e);
      return {
        v4: (v4.dhcp_leases ?? []).map((l) => ({
          hostname: l.hostname ?? '',
          ip: l.ipaddr,
          mac: l.macaddr.toUpperCase(),
          expires: left(l.expires),
        })),
        v6: (v6.dhcp6_leases ?? []).map((l) => ({
          hostname: l.hostname ?? '',
          ip: (l.ip6addrs ?? [l.ip6addr]).filter(Boolean)[0] ?? '',
          duid: l.duid,
          expires: left(l.expires),
        })),
        hints,
      };
    },

    /* packages */
    packages: {
      installed: async () => parsePackages(await opkg('list-installed')),
      available: async () => parsePackages(await opkg('list-available')),
      refresh: () => opkg('update'),
      install: (name: string) => opkg('install', name),
      remove: (name: string) => opkg('remove', name),
    },
  };
};
