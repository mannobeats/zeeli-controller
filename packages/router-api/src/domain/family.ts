import type { Transport } from '../transport/types.ts';
import type { openwrt as openwrtFactory, UciSection } from './openwrt.ts';
import type { policies as policiesFactory } from './policies.ts';
import type { system as systemFactory } from './system.ts';

/**
 * Profiles, bedtime and content blocking are the firmware's parental-control service.
 * Pause is ours. With the Zeeli agent it is a policy that ends by itself on the router, the
 * same way on every router and with no Advanced unlock. Without the agent it falls back to a
 * time-limited OpenWrt firewall rule (fw4 start_date/stop_date with date and time together),
 * which needs the unlock.
 */

export const FAMILY_CATEGORIES = {
  sexual_content: 'Adult content',
  gambling: 'Gambling',
  malicious_content: 'Malware and scams',
  social_entertainment: 'Social media and video',
  game: 'Games',
  shopping: 'Shopping',
} as const;
export type FamilyCategory = keyof typeof FAMILY_CATEGORIES;

export interface Bedtime {
  /** 0 every day, 1..7 Monday..Sunday */
  week: number;
  enabled: boolean;
  begin: string;
  end: string;
}

export interface Profile {
  id: string;
  name: string;
  enabled: boolean;
  macs: string[];
  bedtimeOn: boolean;
  bedtimeDays: 'everyday' | 'customize';
  bedtimes: Bedtime[];
  categories: string[];
  apps: string[];
  sites: string[];
}
export type ProfileInput = Omit<Profile, 'id'>;

export interface AppEntry {
  name: string;
  label: string;
  category: string;
}

export interface Pause {
  profileId: string;
  /** The OpenWrt rule's section, or the agent policy's id when `agent` is set. */
  section: string;
  /** null: until resumed */
  until: Date | null;
  /** Made by the Zeeli agent as a policy, not as an OpenWrt rule. */
  agent?: boolean;
}

const PAUSE_TAG = 'flint-pause:';
/** The tag the agent keeps on a profile's pause policy. */
const AGENT_TAG = 'family:';
const AGENT_CHECK_MS = 30_000;
const FOREVER_YEAR = 2037;

interface RawGroup {
  id: string | number;
  name: string;
  enabled?: boolean;
  macs?: string[];
  schedules_enabled?: boolean;
  schedules_days?: string;
  schedules?: { week: number | string; enabled: boolean; begin: string; end: string }[];
  category?: string[];
  apps?: string[];
  blacklist?: string[];
}

const toProfile = (g: RawGroup): Profile => ({
  id: String(g.id),
  name: g.name,
  enabled: g.enabled !== false,
  macs: (g.macs ?? []).map((m) => m.toUpperCase()),
  bedtimeOn: Boolean(g.schedules_enabled),
  bedtimeDays: g.schedules_days === 'customize' ? 'customize' : 'everyday',
  // the firmware sends `week` as a string
  bedtimes: (g.schedules ?? []).map((s) => ({ ...s, week: Number(s.week) })),
  categories: g.category ?? [],
  apps: g.apps ?? [],
  sites: g.blacklist ?? [],
});
const toRaw = (p: ProfileInput) => ({
  name: p.name,
  enabled: p.enabled,
  macs: p.macs,
  schedules_enabled: p.bedtimeOn,
  schedules_days: p.bedtimeDays,
  schedules: p.bedtimes,
  category: p.categories,
  apps: p.apps,
  blacklist: p.sites,
});

/* ---------- router clock ---------- */

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date whose UTC fields read as the router's local wall-clock time. */
export function routerClock(timestamp: number, tzoffset: string, receivedAt: number, now = Date.now()) {
  const sign = tzoffset.startsWith('-') ? -1 : 1;
  const minutes = sign * (Number(tzoffset.slice(1, 3)) * 60 + Number(tzoffset.slice(3, 5)));
  return new Date(timestamp * 1000 + minutes * 60_000 + (now - receivedAt));
}
const stamp = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const parseStamp = (date: string, time?: string) => new Date(`${date.includes('T') ? date : `${date}T${time ?? '23:59:59'}`}Z`);

/** Minutes since midnight. */
export const toMinutes = (t: string) => {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
};
/** 1..7, Monday..Sunday */
export const weekdayOf = (d: Date) => d.getUTCDay() || 7;

/** Bedtime windows on a weekday as [begin, end] minutes; a window can cross midnight. */
export function windowsFor(p: Profile, day: number): [number, number][] {
  if (!p.bedtimeOn) return [];
  return p.bedtimes.filter((s) => s.enabled && (s.week === 0 || s.week === day)).map((s) => [toMinutes(s.begin), toMinutes(s.end)]);
}

/** Is the profile in bedtime at router time `d`, and until which minute (may exceed 1440)? */
export function bedtimeAt(p: Profile, d: Date): { until: number } | null {
  const day = weekdayOf(d);
  const prev = day === 1 ? 7 : day - 1;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  for (const [b, e] of windowsFor(p, day)) if (b < e ? m >= b && m < e : m >= b) return { until: b < e ? e : e + 1440 };
  for (const [b, e] of windowsFor(p, prev)) if (b > e && m < e) return { until: e };
  return null;
}

export const family = (
  t: Transport,
  ow: ReturnType<typeof openwrtFactory>,
  pol: ReturnType<typeof policiesFactory>,
  sys: ReturnType<typeof systemFactory>,
  agentInstalled: () => Promise<boolean>,
) => {
  const pauseRules = async (): Promise<UciSection[]> =>
    (await ow.uci.sections('firewall', 'rule')).filter((r) => String(r.name ?? '').startsWith(PAUSE_TAG));

  // asked at most every 30 seconds: pauses are read on every refresh of the page
  let checked: { at: number; value: boolean } | undefined;
  const hasAgent = async () => {
    if (!checked || Date.now() - checked.at > AGENT_CHECK_MS) checked = { at: Date.now(), value: await agentInstalled() };
    return checked.value;
  };

  const agentPauses = async (): Promise<Pause[]> => {
    const [list, s] = await Promise.all([pol.list(), sys.status()]);
    const at = Date.now();
    return list.policies
      .filter((p) => p.tag.startsWith(AGENT_TAG))
      .map((p) => ({
        profileId: p.tag.slice(AGENT_TAG.length),
        section: p.id,
        until: p.until === null ? null : routerClock(p.until, s.tzoffset, at, at),
        agent: true,
      }));
  };

  /** An OpenWrt pause rule. With the agent these are only left over from before it was installed, so a locked router isn't an error. */
  const legacyPauses = async (tolerant: boolean): Promise<Pause[]> => {
    const rules = await (tolerant ? pauseRules().catch(() => []) : pauseRules());
    return rules.map((r) => {
      const until = r.stop_date ? parseStamp(String(r.stop_date), r.stop_time ? String(r.stop_time) : undefined) : null;
      return {
        profileId: String(r.name).slice(PAUSE_TAG.length),
        section: r['.name'],
        until: until && until.getUTCFullYear() >= FOREVER_YEAR ? null : until,
      };
    });
  };

  const agentPause = async (p: Profile, now: Date, until: Date | null) => {
    const tag = AGENT_TAG + p.id;
    const who = p.macs.map((id) => ({ type: 'client' as const, id }));
    const name = `${p.name} paused`;
    if (until)
      return pol.pause({ who, minutes: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000)), name, what: 'everything', tag });
    // until resumed: an ordinary block policy with no end
    const before = (await pol.list()).policies.filter((x) => x.tag === tag);
    for (const x of before) await pol.remove(x.id);
    return pol.create({ name, who, what: { kind: 'everything' }, when: { kind: 'always' }, action: { kind: 'block' }, tag });
  };

  const resume = async (pauses: Pause[]) => {
    for (const x of pauses.filter((y) => y.agent)) await pol.remove(x.section);
    const old = pauses.filter((y) => !y.agent);
    if (old.length)
      await ow.uci.change('firewall', async () => {
        for (const x of old) await ow.uci.remove('firewall', x.section);
      });
  };

  return {
    async config(): Promise<{ enabled: boolean; profiles: Profile[] }> {
      const r = await t.call<{ enable?: boolean; groups?: RawGroup[] }>('parental-control', 'get_config');
      return { enabled: Boolean(r.enable), profiles: (r.groups ?? []).map(toProfile) };
    },
    setEnabled: (enable: boolean) => t.call('parental-control', 'set_config', { enable }),
    async apps(): Promise<AppEntry[]> {
      const r = await t
        .call<{ category_name: string; apps?: { name: string; label: string }[] }[]>('parental-control', 'get_app_list')
        .catch(() => []);
      return (Array.isArray(r) ? r : []).flatMap((c) => (c.apps ?? []).map((a) => ({ ...a, category: c.category_name })));
    },
    save: (p: ProfileInput, id?: string) =>
      id ? t.call('parental-control', 'set_group', { ...toRaw(p), id }, 30_000) : t.call('parental-control', 'add_group', toRaw(p), 30_000),
    remove: (id: string) => t.call('parental-control', 'remove_group', { id }),

    async pauses(): Promise<Pause[]> {
      if (!(await hasAgent())) return legacyPauses(false);
      return [...(await agentPauses()), ...(await legacyPauses(true))];
    },
    /** `now` and `until` are router-clock dates (see `routerClock`); `until` null pauses until resumed. */
    async pause(p: Profile, now: Date, until: Date | null, existing?: Pause) {
      if (await hasAgent()) {
        // a pause from before the agent was installed would otherwise keep running beside the new one
        if (existing && !existing.agent) await resume([existing]);
        return agentPause(p, now, until);
      }
      const end = until ?? new Date(Date.UTC(FOREVER_YEAR, 11, 31, 23, 59, 59));
      return ow.uci.change('firewall', async () => {
        if (existing) await ow.uci.remove('firewall', existing.section);
        // Appended, not reordered: reordering rewrites every section in the file, and fw4
        // matches custom rules after established flows anyway, so position gains nothing.
        await ow.uci.add('firewall', 'rule', {
          name: PAUSE_TAG + p.id,
          src: '*',
          dest: '*',
          proto: 'all',
          target: 'REJECT',
          family: 'any',
          src_mac: p.macs,
          start_date: stamp(now),
          stop_date: stamp(end),
        });
      });
    },
    resume,
  };
};
