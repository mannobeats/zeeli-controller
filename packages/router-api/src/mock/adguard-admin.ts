import type { AdguardClient } from '../domain/adguard.ts';
import type { MockState } from './seed.ts';

type Args = Record<string, unknown>;
type Handler = (state: MockState, args: Args) => unknown;

/** [id, name, group, colour]: a small catalogue, with a plain coloured square standing in for each logo. */
const SERVICES = [
  ['tiktok', 'TikTok', 'social_network', '#111827'],
  ['instagram', 'Instagram', 'social_network', '#c13584'],
  ['facebook', 'Facebook', 'social_network', '#1877f2'],
  ['snapchat', 'Snapchat', 'social_network', '#f5c400'],
  ['whatsapp', 'WhatsApp', 'messenger', '#25d366'],
  ['telegram', 'Telegram', 'messenger', '#229ed9'],
  ['discord', 'Discord', 'messenger', '#5865f2'],
  ['youtube', 'YouTube', 'video', '#e11d48'],
  ['netflix', 'Netflix', 'video', '#b91c1c'],
  ['twitch', 'Twitch', 'video', '#7c3aed'],
  ['roblox', 'Roblox', 'games', '#475569'],
  ['fortnite', 'Fortnite', 'games', '#2563eb'],
  ['steam', 'Steam', 'games', '#1e3a5f'],
  ['chatgpt', 'ChatGPT', 'ai', '#0f766e'],
] as const;

const icon = (colour: string) =>
  btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="${colour}"/></svg>`);

interface Admin {
  rules: string[];
  services: { ids: string[]; schedule: unknown };
  clients: AdguardClient[];
  rewrites: { domain: string; answer: string; enabled: boolean }[];
}

const admin = (s: MockState): Admin => {
  const found = s.extra.get('adguard-admin') as Admin | undefined;
  if (found) return found;
  const kids = ['Maya-iPhone', 'Leo-iPad', 'Leo-Switch'].flatMap((n) => {
    const c = s.clients.find((x) => x.name === n);
    return c ? [c.ip, c.mac.toLowerCase()] : [];
  });
  const fresh: Admin = {
    rules: ['||ads.example.com^', '@@||cdn.example.org^', '/tracker[0-9]+\\.example\\.net/'],
    services: { ids: ['snapchat', 'fortnite'], schedule: { time_zone: 'Local' } },
    clients: [
      {
        name: 'Zeeli: Kids',
        ids: kids,
        use_global_settings: false,
        filtering_enabled: true,
        parental_enabled: true,
        safebrowsing_enabled: true,
        safe_search: { enabled: true },
        use_global_blocked_services: false,
        blocked_services: ['tiktok', 'youtube'],
        blocked_services_schedule: { time_zone: 'Local' },
        tags: [],
        upstreams: [],
        ignore_querylog: false,
        ignore_statistics: false,
      },
    ],
    rewrites: [{ domain: 'nas.home', answer: '192.168.8.20', enabled: true }],
  };
  s.extra.set('adguard-admin', fresh);
  return fresh;
};

const without = <T>(list: T[], gone: (x: T) => boolean) => {
  const kept = list.filter((x) => !gone(x));
  list.splice(0, list.length, ...kept);
};

/** The demo router's own rules, for the filtering status answer. */
export const userRules = (s: MockState) => admin(s).rules;

export const adguardAdminHandlers: Record<string, Handler> = {
  'adguard:filtering/set_rules': (s, a) => {
    admin(s).rules = (a.rules as string[]) ?? [];
    return {};
  },
  'adguard:blocked_services/all': () => ({
    blocked_services: SERVICES.map(([id, name, group_id, colour]) => ({ id, name, group_id, icon_svg: icon(colour) })),
    groups: [...new Set(SERVICES.map((x) => x[2]))].map((id) => ({ id })),
  }),
  'adguard:blocked_services/get': (s) => admin(s).services,
  'adguard:blocked_services/update': (s, a) => {
    admin(s).services = { ids: a.ids as string[], schedule: a.schedule };
    return {};
  },
  'adguard:clients': (s) => ({ clients: admin(s).clients, auto_clients: [] }),
  'adguard:clients/add': (s, a) => {
    admin(s).clients.push(a as AdguardClient);
    return {};
  },
  'adguard:clients/update': (s, a) => {
    const list = admin(s).clients;
    const at = list.findIndex((c) => c.name === a.name);
    if (at >= 0) list[at] = a.data as AdguardClient;
    return {};
  },
  'adguard:clients/delete': (s, a) => {
    without(admin(s).clients, (c) => c.name === a.name);
    return {};
  },
  'adguard:rewrite/list': (s) => admin(s).rewrites,
  'adguard:rewrite/add': (s, a) => {
    admin(s).rewrites.push({ domain: String(a.domain), answer: String(a.answer), enabled: a.enabled !== false });
    return {};
  },
  'adguard:rewrite/delete': (s, a) => {
    without(admin(s).rewrites, (r) => r.domain === a.domain && r.answer === a.answer);
    return {};
  },
};
