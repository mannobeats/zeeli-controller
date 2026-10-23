import { isIpv4, isIpv6 } from '../net.ts';
import type { Transport } from '../transport/types.ts';

/* ---------- your own rules ---------- */

export interface ParsedRule {
  kind: 'block' | 'allow' | 'other';
  /** The domain a block or allow rule names; empty for anything else. */
  domain: string;
}

export const blockRule = (domain: string) => `||${domain.toLowerCase()}^`;
export const allowRule = (domain: string) => `@@||${domain.toLowerCase()}^`;

/** The two plain forms the console writes; any other rule stays as the raw text it is. */
export function parseRule(rule: string): ParsedRule {
  const m = /^(@@)?\|\|([a-z0-9][a-z0-9.-]*)\^$/i.exec(rule.trim());
  if (!m?.[2]) return { kind: 'other', domain: '' };
  return { kind: m[1] ? 'allow' : 'block', domain: m[2].toLowerCase() };
}

export interface DomainAction {
  label: 'Block' | 'Allow' | 'Unblock' | 'Remove allow';
  /** What the toast says once it is done. */
  done: string;
  /** The whole rule list after the action. */
  rules: string[];
}

/**
 * What one click on a domain does: take away your own rule for it when there is one, else
 * add the opposite of how it was just answered. An allow rule wins over any filter list.
 */
export function domainAction(rules: string[], domain: string, blocked: boolean): DomainAction {
  const d = domain.toLowerCase();
  const own = rules.find((r) => parseRule(r).domain === d);
  if (own) {
    const block = parseRule(own).kind === 'block';
    return {
      label: block ? 'Unblock' : 'Remove allow',
      done: block ? `Unblocked ${d}` : `Removed the allow rule for ${d}`,
      rules: rules.filter((r) => r !== own),
    };
  }
  return blocked
    ? { label: 'Allow', done: `Allowed ${d}`, rules: [...rules, allowRule(d)] }
    : { label: 'Block', done: `Blocked ${d}`, rules: [...rules, blockRule(d)] };
}

/* ---------- names and addresses ---------- */

const LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
/** A host name, with `*.` allowed at the front when it is a wildcard. */
export const isHostName = (v: string, wildcard = false) =>
  new RegExp(`^${wildcard ? '(\\*\\.)?' : ''}${LABEL}(\\.${LABEL})*$`, 'i').test(v) && v.length <= 253;

/** What was typed, or pasted as an address, as the bare domain: "https://Example.com/a" becomes "example.com". */
export const cleanDomain = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '');

export interface AdguardRewrite {
  domain: string;
  answer: string;
  enabled: boolean;
}

/** The problem with a rewrite, in a sentence, or '' when it is fine. */
export function rewriteProblem(domain: string, answer: string): string {
  if (!isHostName(domain, true)) return `“${domain}” isn’t a domain name. Use something like nas.home, or *.home for every name under it.`;
  if (!(isIpv4(answer) || isIpv6(answer) || isHostName(answer)))
    return `“${answer}” isn’t an IP address or a name. Use something like 192.168.8.20.`;
  return '';
}

/* ---------- blocked services ---------- */

export interface ServiceInfo {
  id: string;
  name: string;
  /** A data: URL for an <img>; empty when the router sent something that isn't base64. */
  icon: string;
  group: string;
}

export interface ServiceCatalog {
  services: ServiceInfo[];
  groups: string[];
}

export interface BlockedServices {
  ids: string[];
  /** AdGuard's pause schedule, kept as it came so a save never drops it. */
  schedule: unknown;
}

interface RawCatalog {
  blocked_services?: { id: string; name: string; icon_svg?: string; group_id?: string }[];
  groups?: { id: string }[];
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/* ---------- per-device and per-group profiles ---------- */

/** AdGuard's "persistent client", as the router sends and takes it. */
export interface AdguardClient {
  name: string;
  ids: string[];
  use_global_settings: boolean;
  filtering_enabled: boolean;
  parental_enabled: boolean;
  safebrowsing_enabled: boolean;
  safe_search: { enabled: boolean } & Record<string, boolean>;
  use_global_blocked_services: boolean;
  blocked_services: string[];
  /** Everything else AdGuard keeps (schedule, tags, upstreams, ...), carried through unchanged. */
  [other: string]: unknown;
}

export const PROFILE_PREFIX = 'Zeeli: ';
export const profileName = (group: string) => `${PROFILE_PREFIX}${group}`;
export const isProfile = (c: Pick<AdguardClient, 'name'>) => c.name.startsWith(PROFILE_PREFIX);

/** What AdGuard matches a device by: its address and its MAC. */
export function profileIds(devices: { ip: string; mac: string }[]): string[] {
  return [...new Set(devices.flatMap((d) => [d.ip, d.mac.toLowerCase()]).filter(Boolean))];
}

/** A profile that follows the shared settings until told otherwise. */
export const newProfile = (name: string, ids: string[]): AdguardClient => ({
  name,
  ids,
  use_global_settings: true,
  filtering_enabled: true,
  parental_enabled: false,
  safebrowsing_enabled: false,
  // AdGuard only enforces SafeSearch on the engines switched on here; all of them, like its own default
  safe_search: { enabled: false, bing: true, duckduckgo: true, ecosia: true, google: true, pixabay: true, yandex: true, youtube: true },
  use_global_blocked_services: true,
  blocked_services: [],
  tags: [],
  upstreams: [],
  ignore_querylog: false,
  ignore_statistics: false,
});

const nameList = (names: string[]) => {
  if (names.length <= 3) return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
};

/** One short sentence for a profile: "Parental control on, TikTok and YouTube blocked". */
export function describeProfile(c: AdguardClient, serviceName: (id: string) => string): string {
  const parts: string[] = [];
  if (!c.use_global_settings) {
    if (!c.filtering_enabled) parts.push('ad blocking off');
    if (c.safebrowsing_enabled) parts.push('malware protection on');
    if (c.parental_enabled) parts.push('parental control on');
    if (c.safe_search.enabled) parts.push('SafeSearch on');
  }
  if (!c.use_global_blocked_services && c.blocked_services.length) parts.push(`${nameList(c.blocked_services.map(serviceName))} blocked`);
  const text = parts.join(', ') || 'Same protection as everyone else';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ---------- the calls ---------- */

export const adguardAdmin = (t: Transport) => {
  const put = <B>(path: string, body: B, method: 'POST' | 'PUT' = 'POST') => t.adguard(path, { method, body });
  const blocked = async (): Promise<BlockedServices> => {
    const r = await t.adguard<{ ids?: string[]; schedule?: unknown }>('blocked_services/get');
    return { ids: r.ids ?? [], schedule: r.schedule ?? {} };
  };
  return {
    async userRules(): Promise<string[]> {
      return (await t.adguard<{ user_rules?: string[] }>('filtering/status')).user_rules ?? [];
    },
    setUserRules: (rules: string[]) => put('filtering/set_rules', { rules }),

    async serviceCatalog(): Promise<ServiceCatalog> {
      const r = await t.adguard<RawCatalog>('blocked_services/all');
      return {
        services: (r.blocked_services ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          icon: s.icon_svg && BASE64.test(s.icon_svg) ? `data:image/svg+xml;base64,${s.icon_svg}` : '',
          group: s.group_id ?? 'other',
        })),
        groups: (r.groups ?? []).map((g) => g.id),
      };
    },
    blockedServices: blocked,
    /** Saves the list and puts back the schedule that is already there. */
    async setBlockedServices(ids: string[]) {
      const { schedule } = await blocked();
      await put('blocked_services/update', { ids, schedule }, 'PUT');
    },

    async adguardClients(): Promise<AdguardClient[]> {
      return (await t.adguard<{ clients?: AdguardClient[] | null }>('clients')).clients ?? [];
    },
    addAdguardClient: (client: AdguardClient) => put('clients/add', client),
    updateAdguardClient: (name: string, client: AdguardClient) => put('clients/update', { name, data: client }),
    deleteAdguardClient: (name: string) => put('clients/delete', { name }),

    // AdGuard 0.107.7x keeps an on/off flag per rewrite; a delete has to name it to match
    async rewrites(): Promise<AdguardRewrite[]> {
      const r = await t.adguard<{ domain: string; answer: string; enabled?: boolean }[] | null>('rewrite/list');
      return Array.isArray(r) ? r.map(({ domain, answer, enabled }) => ({ domain, answer, enabled: enabled !== false })) : [];
    },
    addRewrite: (domain: string, answer: string) => put('rewrite/add', { domain, answer, enabled: true }),
    deleteRewrite: (r: AdguardRewrite) => put('rewrite/delete', r),
  };
};
