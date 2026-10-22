import type { ProfileInput } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { buildProfile, dailyBedtime, newProfile, siteOf, weekBedtimes } from './profile.ts';

const v: ProfileInput = {
  name: ' Maya ',
  enabled: true,
  macs: ['02:00:00:00:00:01'],
  bedtimeOn: true,
  bedtimeDays: 'everyday',
  bedtimes: [],
  categories: [],
  apps: [],
  sites: [],
};
const bedtime = { everyday: { begin: '21:00', end: '07:00' }, perDay: [] };

test('a valid profile is trimmed and gets one daily bedtime', () => {
  const p = buildProfile(v, 'https://www.roblox.com/home\n\n', bedtime, []);
  expect(p.name).toBe('Maya');
  expect(p.bedtimes).toEqual([{ week: 0, enabled: true, begin: '21:00', end: '07:00' }]);
  expect(p.sites).toEqual(['www.roblox.com']);
});

test('mistakes are explained', () => {
  expect(() => buildProfile({ ...v, macs: [] }, '', bedtime, [])).toThrow(/at least one device/);
  expect(() => buildProfile(v, 'not a site', bedtime, [])).toThrow(/isn’t a website/);
  expect(() => buildProfile(v, '', { ...bedtime, everyday: { begin: '07:00', end: '07:00' } }, [])).toThrow(/same time/);
  expect(() => buildProfile(v, '', bedtime, [{ ...v, id: 'x', name: 'Maya' }])).toThrow(/already has that name/);
});

test('per-day bedtimes are listed Sunday first with missing days off', () => {
  const p = buildProfile(
    { ...v, bedtimeDays: 'customize' },
    '',
    { ...bedtime, perDay: [{ week: 1, enabled: true, begin: '20:00', end: '06:00' }] },
    [],
  );
  expect(p.bedtimes.map((b) => b.week)).toEqual([7, 1, 2, 3, 4, 5, 6]);
  expect(p.bedtimes[1]?.enabled).toBe(true);
  expect(p.bedtimes[0]?.enabled).toBe(false);
});

test('site addresses lose their scheme and path', () => {
  expect(siteOf(' http://example.com/a/b ')).toBe('example.com');
});

test('a sheet starts from the profile’s bedtime, else the preset’s, else 10 PM to 7 AM', () => {
  const own = { week: 0, enabled: true, begin: '21:00', end: '06:00' };
  const teen = { bedtime: ['23:00', '06:30'], categories: ['gambling'] } as const;
  expect(dailyBedtime({ ...v, id: 'p', bedtimes: [own] }, teen)).toBe(own);
  expect(dailyBedtime(null, teen)).toMatchObject({ begin: '23:00', end: '06:30' });
  expect(dailyBedtime(null, { ...teen, bedtime: null })).toMatchObject({ begin: '22:00', end: '07:00' });
  expect(dailyBedtime(null, null)).toMatchObject({ begin: '22:00', end: '07:00' });
});

test('a new profile takes its preset’s blocks and bedtime switch', () => {
  const daily = { week: 0, enabled: true, begin: '22:00', end: '07:00' };
  expect(newProfile({ bedtime: null, categories: ['gambling'] }, daily)).toMatchObject({ bedtimeOn: false, categories: ['gambling'] });
  expect(newProfile(null, daily)).toMatchObject({
    bedtimeOn: true,
    bedtimes: [daily],
    categories: ['sexual_content', 'gambling', 'malicious_content'],
  });
});

test('per-day bedtimes keep the profile’s own days and fill the rest', () => {
  const daily = { week: 0, enabled: true, begin: '22:00', end: '07:00' };
  const sunday = { week: 7, enabled: false, begin: '21:00', end: '08:00' };
  const week = weekBedtimes({ ...v, id: 'p', bedtimes: [sunday] }, daily);
  expect(week.map((b) => b.week)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(week[6]).toBe(sunday);
  expect(week[0]).toEqual({ week: 1, enabled: true, begin: '22:00', end: '07:00' });
  expect(weekBedtimes(null, daily)).toHaveLength(7);
});
