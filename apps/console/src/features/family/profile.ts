import type { Bedtime, Profile, ProfileInput } from '@zeeli/router-api';

/** "https://www.example.com/path" -> "www.example.com" */
export const siteOf = (line: string) =>
  line
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

/** Check a profile and build what the router stores. Throws a message for the person. */
export function buildProfile(
  v: ProfileInput,
  sites: string,
  bedtime: { everyday: { begin: string; end: string }; perDay: Bedtime[] },
  others: Profile[],
): ProfileInput {
  const name = v.name.trim();
  if (!name) throw new Error('Give the profile a name.');
  if (new TextEncoder().encode(name).length > 64) throw new Error('Keep the name under 64 characters.');
  if (others.some((x) => x.name === name)) throw new Error('Another profile already has that name.');
  if (!v.macs.length) throw new Error('Pick at least one device.');
  const byDay = new Map(bedtime.perDay.map((b) => [b.week, b]));
  // the firmware lists days Sunday first
  const bedtimes =
    v.bedtimeDays === 'customize'
      ? [7, 1, 2, 3, 4, 5, 6].map((d) => byDay.get(d) ?? { week: d, enabled: false, begin: '22:00', end: '07:00' })
      : [{ week: 0, enabled: true, ...bedtime.everyday }];
  if (v.bedtimeOn && bedtimes.some((b) => b.enabled && b.begin === b.end)) throw new Error('Bedtime start and end can’t be the same time.');
  const siteList = sites.split('\n').map(siteOf).filter(Boolean);
  const bad = siteList.find((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d));
  if (bad) throw new Error(`${bad} isn’t a website address.`);
  return { ...v, name, bedtimes, sites: siteList };
}

/** What a preset sets up: an everyday bedtime (or none) and the categories it blocks. */
export interface PresetDefaults {
  bedtime: readonly [begin: string, end: string] | null;
  categories: readonly string[];
}

/** The everyday bedtime a sheet starts from: the profile's, else the preset's, else 10 PM to 7 AM. */
export function dailyBedtime(profile: Profile | null, preset: PresetDefaults | null): Bedtime {
  const own = profile?.bedtimes.find((b) => b.week === 0);
  if (own) return own;
  const [begin, end] = preset?.bedtime ?? ['22:00', '07:00'];
  return { week: 0, enabled: true, begin, end };
}

/** A new profile from a preset, or from scratch with the three always-sensible blocks. */
export const newProfile = (preset: PresetDefaults | null, daily: Bedtime): ProfileInput => ({
  name: '',
  enabled: true,
  macs: [],
  bedtimeOn: preset ? preset.bedtime !== null : true,
  bedtimeDays: 'everyday',
  bedtimes: [daily],
  categories: preset ? [...preset.categories] : ['sexual_content', 'gambling', 'malicious_content'],
  apps: [],
  sites: [],
});

/** One bedtime per weekday, Monday first; days without their own get the everyday one. */
export function weekBedtimes(profile: Profile | null, daily: Bedtime): Bedtime[] {
  const byDay = new Map((profile?.bedtimes ?? []).map((b) => [b.week, b]));
  return [1, 2, 3, 4, 5, 6, 7].map((d) => byDay.get(d) ?? { week: d, enabled: true, begin: daily.begin, end: daily.end });
}
