import type { Handler } from './handlers.ts';
import type { MockState } from './seed.ts';

/**
 * `zeeli.names` on the demo router, and the one AdGuard setting it touches. Like the real agent
 * it keeps its own copy of the names the console sends, and works out the host names itself.
 */

interface Store {
  enabled: boolean;
  devices: { mac: string; name: string }[];
  dismissed: string[];
  upstreams: string[];
}

const MAC = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

const store = (s: MockState): Store => {
  const found = s.extra.get('names') as Store | undefined;
  if (found) return found;
  // the demo router's devices that already have a name count as set up
  const fresh: Store = {
    enabled: true,
    devices: [],
    dismissed: s.clients.filter((c) => c.alias).map((c) => c.mac),
    upstreams: ['https://dns10.quad9.net/dns-query', 'https://cloudflare-dns.com/dns-query'],
  };
  s.extra.set('names', fresh);
  return fresh;
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

/** Same rule as the agent: repeats get -2, -3 in MAC order. */
const view = (st: Store) => {
  const taken = new Set<string>();
  const devices = [...st.devices]
    .sort((a, b) => (a.mac < b.mac ? -1 : 1))
    .map((d) => {
      let host = slug(d.name);
      for (let n = 2; host && taken.has(host); n++) host = `${slug(d.name).slice(0, 62 - String(n).length)}-${n}`;
      if (host) taken.add(host);
      return { ...d, host };
    });
  return { enabled: st.enabled, zone: 'lan', devices, dismissed: [...st.dismissed] };
};

const list = (s: MockState) => view(store(s));

export const agentNames: Record<string, Handler> = {
  'zeeli:names.list': (s) => list(s),
  'zeeli:names.sync': (s, a) => {
    const given = Array.isArray(a.devices) ? (a.devices as { mac?: unknown; name?: unknown }[]) : [];
    if (given.some((d) => typeof d.mac !== 'string' || !MAC.test(d.mac) || typeof d.name !== 'string'))
      return { error: 'That device list isn’t valid.' };
    store(s).devices = given.map((d) => ({ mac: String(d.mac).toUpperCase(), name: String(d.name).trim() }));
    return list(s);
  },
  'zeeli:names.set_enabled': (s, a) => {
    if (typeof a.enabled !== 'boolean') return { error: 'Choose on or off.' };
    store(s).enabled = a.enabled;
    return list(s);
  },
  'zeeli:names.dismiss': (s, a) => {
    const macs = Array.isArray(a.macs) ? (a.macs as unknown[]) : [];
    if (macs.some((m) => typeof m !== 'string' || !MAC.test(m))) return { error: 'That isn’t a MAC address.' };
    const st = store(s);
    const upper = macs.map((m) => String(m).toUpperCase());
    st.dismissed = [...st.dismissed.filter((m) => !upper.includes(m)), ...(a.dismissed ? upper : [])];
    return list(s);
  },
  'adguard:dns_info': (s) => ({ upstream_dns: [...store(s).upstreams] }),
  'adguard:dns_config': (s, a) => {
    if (Array.isArray(a.upstream_dns)) store(s).upstreams = (a.upstream_dns as unknown[]).map(String);
    return {};
  },
};
