import { settings } from '../settings.ts';
import type { Transport } from '../transport/types.ts';

export type DnsMode = 'auto' | 'manual' | 'secure' | 'proxy';

export interface DnsConfig {
  mode: DnsMode;
  manual_list: string[];
  server_auto?: string[];
  provider: string;
  proto: string;
  servers_list: string[];
  nextdns_id: string;
  controld_type: number;
  controld_id: string;
  rebind_protection: boolean;
  force_dns: boolean;
  override_vpn: boolean;
  proxy_list?: string[];
  secure_manual_list?: string[];
  proto_manual?: string;
}

export interface DnsProvider {
  provider: string;
  protocols: string[];
  servers: { name: string; description: string }[];
}

export const DNS_PROVIDERS: Record<string, string> = {
  controld: 'Control D',
  nextdns: 'NextDNS',
  quad9: 'Quad9',
  cleanbrowsing: 'CleanBrowsing',
  cloudflare: 'Cloudflare',
  adguard_dns: 'AdGuard DNS',
  google_dns: 'Google',
  opendns: 'OpenDNS',
};
export const DNS_PROTOCOLS: Record<string, string> = {
  dot: 'DNS over TLS',
  doh: 'DNS over HTTPS',
  doq: 'DNS over QUIC',
  dnscrypt: 'DNSCrypt',
  odoh: 'Oblivious DoH',
};

/* ---------- AdGuard Home ---------- */

export interface AdguardState {
  enabled: boolean;
  dns_enabled: boolean;
}

export interface AdguardStats {
  queries: number;
  blocked: number;
  malware: number;
  adult: number;
  avgMs: number;
  /** Queries per time bucket, oldest first; the bucket length is `bucket`. */
  series: number[];
  blockedSeries: number[];
  bucket: 'hour' | 'day';
  topQueried: [domain: string, count: number][];
  topBlocked: [domain: string, count: number][];
  topClients: [client: string, count: number][];
}

export interface QueryLogEntry {
  time: string;
  client: string;
  domain: string;
  type: string;
  blocked: boolean;
  reason: string;
  elapsedMs: number;
}

const pairs = (list: Record<string, number>[] | undefined): [string, number][] => (list ?? []).map((o) => Object.entries(o)[0] ?? ['', 0]);

export const dns = (t: Transport) => ({
  config: settings<DnsConfig>(t, 'dns'),
  async providers(): Promise<DnsProvider[]> {
    const r = await t
      .call<{ provider: string; sup_proto?: string[]; server_list?: { name: string; description: string }[] }[]>(
        'dns',
        'get_info',
        {},
        20_000,
      )
      .catch(() => []);
    return (Array.isArray(r) ? r : [])
      .filter((p) => DNS_PROVIDERS[p.provider])
      .map((p) => ({ provider: p.provider, protocols: p.sup_proto ?? ['dot'], servers: p.server_list ?? [] }));
  },
  hosts: async () => (await t.call<{ content?: string }>('dns', 'get_host')).content ?? '',
  setHosts: (content: string) => t.call('dns', 'set_host', { content }),

  adguard: settings<AdguardState>(t, 'adguardhome', { timeoutMs: 90_000 }),

  async adguardStats(): Promise<AdguardStats | null> {
    const s = await t
      .adguard<{
        num_dns_queries?: number;
        num_blocked_filtering?: number;
        num_replaced_safebrowsing?: number;
        num_replaced_parental?: number;
        avg_processing_time?: number;
        dns_queries?: number[];
        blocked_filtering?: number[];
        time_units?: 'hours' | 'days';
        top_queried_domains?: Record<string, number>[];
        top_blocked_domains?: Record<string, number>[];
        top_clients?: Record<string, number>[];
      }>('stats')
      .catch(() => null);
    if (!s) return null;
    return {
      queries: s.num_dns_queries ?? 0,
      blocked: s.num_blocked_filtering ?? 0,
      malware: s.num_replaced_safebrowsing ?? 0,
      adult: s.num_replaced_parental ?? 0,
      avgMs: Math.round((s.avg_processing_time ?? 0) * 1000),
      series: s.dns_queries ?? [],
      blockedSeries: s.blocked_filtering ?? [],
      bucket: s.time_units === 'days' ? 'day' : 'hour',
      topQueried: pairs(s.top_queried_domains),
      topBlocked: pairs(s.top_blocked_domains),
      topClients: pairs(s.top_clients),
    };
  },

  async queryLog(limit = 100): Promise<QueryLogEntry[]> {
    const r = await t.adguard<{
      data?: {
        time: string;
        client: string;
        question?: { name?: string; type?: string };
        reason?: string;
        elapsedMs?: string;
      }[];
    }>(`querylog?limit=${limit}`);
    return (r.data ?? []).map((q) => ({
      time: q.time,
      client: q.client,
      domain: q.question?.name ?? '',
      type: q.question?.type ?? '',
      reason: q.reason ?? '',
      blocked: /^Filtered/.test(q.reason ?? ''),
      elapsedMs: Number(q.elapsedMs ?? 0),
    }));
  },

  async filterLists() {
    const r = await t.adguard<{
      enabled?: boolean;
      filters?: { id: number; name: string; url: string; enabled: boolean; rules_count: number; last_updated?: string }[];
    }>('filtering/status');
    return { enabled: Boolean(r.enabled), filters: r.filters ?? [] };
  },
  setFilterList: (url: string, name: string, enabled: boolean) =>
    t.adguard('filtering/set_url', { method: 'POST', body: { url, whitelist: false, data: { name, url, enabled } } }),
  refreshFilters: () => t.adguard('filtering/refresh', { method: 'POST', body: { whitelist: false } }),
});
