import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRouterApi, type RouterApi } from '../api.ts';
import { createMockTransport } from '../mock/transport.ts';
import { type Policy, type PolicyInput, zoneOf } from './policies.ts';

let api: RouterApi;
beforeEach(async () => {
  // 12:00 on Thursday in the demo router's time zone (UTC-4)
  vi.setSystemTime(new Date('2026-10-22T16:00:00Z'));
  api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
});
afterEach(() => vi.useRealTimers());

const find = async (name: string) => (await api.policies.list()).policies.find((p) => p.name === name) as Policy;
const mac = async (name: string) => (await api.clients.list()).find((c) => c.hostname === name)?.mac ?? '';

const block = (who: PolicyInput['who'], more: PolicyInput = {}): PolicyInput => ({
  name: 'Test',
  who,
  what: { kind: 'internet' },
  when: { kind: 'always' },
  action: { kind: 'block' },
  ...more,
});

describe('the demo', () => {
  test('starts with a Kids group of three devices', async () => {
    const groups = await api.policies.groups.list();
    const kids = groups.find((g) => g.name === 'Kids');
    expect(kids).toMatchObject({ kind: 'person' });
    expect(kids?.members).toHaveLength(3);
    expect(await api.clients.list()).toEqual(expect.arrayContaining([expect.objectContaining({ mac: kids?.members[0] })]));
  });

  test('has a bedtime, a site block, a paused TV and the TV routed through a VPN', async () => {
    const { policies } = await api.policies.list();
    expect(policies.map((p) => p.name)).toEqual(['Bedtime', 'No TikTok', 'Living-Room-TV paused', 'TV via UK VPN']);
    expect(policies[3]).toMatchObject({ action: { kind: 'route', target: 'vpn:10101', fallback: 'block' }, active: true });
    expect(policies[0]).toMatchObject({ when: { kind: 'schedule', from: '22:00', to: '07:00' }, action: { kind: 'block' }, active: false });
    expect(policies[1]).toMatchObject({ what: { kind: 'sites', sites: ['tiktok.com', 'tiktokv.com'] }, active: true });
    expect(policies[2]?.active).toBe(true);
    expect(policies[2]?.until).toBeGreaterThan(Date.now() / 1000);
  });

  test('a schedule turns on at its start, past midnight, and off again', async () => {
    vi.setSystemTime(new Date('2026-10-23T03:00:00Z')); // 23:00 Thursday
    expect((await find('Bedtime')).active).toBe(true);
    vi.setSystemTime(new Date('2026-10-23T10:59:00Z')); // 06:59 Friday: still Thursday night's window
    expect((await find('Bedtime')).active).toBe(true);
    vi.setSystemTime(new Date('2026-10-23T11:00:00Z')); // 07:00
    expect((await find('Bedtime')).active).toBe(false);
  });

  test('the paused TV runs out by itself', async () => {
    expect((await api.policies.list()).policies.map((p) => p.name)).toContain('Living-Room-TV paused');
    vi.setSystemTime(new Date('2026-10-22T16:43:00Z'));
    expect((await api.policies.list()).policies.map((p) => p.name)).not.toContain('Living-Room-TV paused');
  });
});

describe('groups', () => {
  test('create, rename, add and remove members, delete', async () => {
    const maya = await mac('Maya-iPhone');
    const g = await api.policies.groups.create({ name: 'Guests', kind: 'devices', members: [maya.toLowerCase()] });
    expect(g.members).toEqual([maya]);
    expect((await api.policies.groups.update(g.id, { name: 'Visitors' })).name).toBe('Visitors');
    await api.policies.groups.addMembers(g.id, [await mac('Leo-iPad')]);
    await api.policies.groups.removeMembers(g.id, [maya]);
    expect((await api.policies.groups.list()).find((x) => x.id === g.id)?.members).toEqual([await mac('Leo-iPad')]);
    await api.policies.groups.remove(g.id);
    expect((await api.policies.groups.list()).some((x) => x.id === g.id)).toBe(false);
  });

  test('names and members are checked', async () => {
    await expect(api.policies.groups.create({ name: '  ', kind: 'devices', members: [] })).rejects.toThrow('Give the group a name.');
    await expect(api.policies.groups.create({ name: 'kids', kind: 'devices', members: [] })).rejects.toThrow(
      'There is already a group called kids.',
    );
    await expect(api.policies.groups.create({ name: 'New', kind: 'devices', members: ['nope'] })).rejects.toThrow(
      '“nope” isn’t a MAC address.',
    );
    await expect(api.policies.groups.update('ffffff', { name: 'x' })).rejects.toThrow('That group doesn’t exist.');
    const tooMany = Array.from(
      { length: 257 },
      (_, i) => `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`,
    );
    await expect(api.policies.groups.create({ name: 'Big', kind: 'devices', members: tooMany })).rejects.toThrow(
      'A group can hold up to 256 devices.',
    );
  });

  test('deleting a group takes it out of policies and switches off the ones left with nobody', async () => {
    const kids = (await api.policies.groups.list()).find((g) => g.name === 'Kids');
    expect(await api.policies.groups.remove(kids?.id ?? '')).toMatchObject({ affected: 2 });
    const { policies } = await api.policies.list();
    expect(policies.find((p) => p.name === 'Bedtime')).toMatchObject({ who: [], enabled: false });
  });
});

describe('policies', () => {
  test('create, change, switch off and delete', async () => {
    const tv = await mac('Living-Room-TV');
    const p = await api.policies.create(
      block([{ type: 'client', id: tv }], { name: 'Quiet hours', when: { kind: 'schedule', days: [5, 6], from: '20:00', to: '08:00' } }),
    );
    expect(p).toMatchObject({ order: 50, enabled: true, until: null, active: false });
    const changed = await api.policies.update(p.id, { name: 'Weekend quiet', enabled: false });
    expect(changed).toMatchObject({ name: 'Weekend quiet', enabled: false, who: [{ type: 'client', id: tv }] });
    await api.policies.remove(p.id);
    expect((await api.policies.list()).policies.some((x) => x.id === p.id)).toBe(false);
    await expect(api.policies.remove(p.id)).rejects.toThrow('That policy doesn’t exist.');
  });

  test('mistakes are explained in the router’s words', async () => {
    const tv = await mac('Living-Room-TV');
    const who = [{ type: 'client' as const, id: tv }];
    await expect(api.policies.create(block([]))).rejects.toThrow('Choose who the policy is for.');
    await expect(api.policies.create(block(who, { name: '' }))).rejects.toThrow('Give the policy a name.');
    await expect(api.policies.create(block([{ type: 'group', id: 'ffffff' }]))).rejects.toThrow(
      'One of the groups in this policy doesn’t exist.',
    );
    await expect(api.policies.create(block([{ type: 'network', id: 'nowhere' }]))).rejects.toThrow(
      'The firewall has no network called nowhere.',
    );
    await expect(api.policies.create(block(who, { what: { kind: 'sites', sites: ['https://tiktok.com'] } }))).rejects.toThrow(
      'isn’t a site',
    );
    await expect(api.policies.create(block(who, { what: { kind: 'sites', sites: [] } }))).rejects.toThrow('Add at least one site.');
    await expect(api.policies.create(block(who, { when: { kind: 'schedule', days: [], from: '22:00', to: '07:00' } }))).rejects.toThrow(
      'Choose at least one day',
    );
    await expect(api.policies.create(block(who, { when: { kind: 'schedule', days: [1], from: '25:00', to: '07:00' } }))).rejects.toThrow(
      'Times look like 22:00.',
    );
    await expect(api.policies.create(block(who, { until: Math.floor(Date.now() / 1000) - 5 }))).rejects.toThrow(
      'That time has already passed.',
    );
    await expect(api.policies.create(block(who, { action: { kind: 'limit', down: 0, up: 0 } }))).rejects.toThrow(
      'Enter a download or an upload limit.',
    );
    await expect(
      api.policies.create(block(who, { what: { kind: 'sites', sites: ['a.com'] }, action: { kind: 'limit', down: 5, up: 1 } })),
    ).rejects.toThrow('covers all of a device’s traffic');
    await expect(
      api.policies.create(block([{ type: 'network', id: 'guest' }], { action: { kind: 'limit', down: 5, up: 1 } })),
    ).rejects.toThrow('per device');
  });

  test('reorder puts them in the order sent, and refuses nonsense', async () => {
    const before = (await api.policies.list()).policies.map((p) => p.id);
    await api.policies.reorder([...before].reverse());
    expect((await api.policies.list()).policies.map((p) => p.id)).toEqual([...before].reverse());
    await expect(api.policies.reorder([before[0] as string, before[0] as string])).rejects.toThrow('names a policy twice');
    await expect(api.policies.reorder(['ffffff'])).rejects.toThrow('names a policy twice or one that doesn’t exist');
  });

  test('a speed limit shows on the device while it applies, and goes with the policy', async () => {
    const leo = await mac('Leo-iPad');
    const p = await api.policies.create(
      block([{ type: 'client', id: leo }], { what: { kind: 'everything' }, action: { kind: 'limit', down: 5, up: 1 } }),
    );
    const limited = (await api.clients.list()).find((c) => c.mac === leo);
    expect(limited).toMatchObject({ limitRx: 610, limitTx: 122 });
    await api.policies.remove(p.id);
    expect((await api.clients.list()).find((c) => c.mac === leo)).toMatchObject({ limitRx: 0, limitTx: 0 });
  });

  test('a pause ends on its own and a tagged pause replaces its earlier one', async () => {
    const leo = await mac('Leo-iPad');
    const who = [{ type: 'client' as const, id: leo }];
    const a = await api.policies.pause({ who, minutes: 15, name: 'Leo paused', tag: 'pause:x' });
    expect(a.until).toBe(Math.floor(Date.now() / 1000) + 900);
    const b = await api.policies.pause({ who, minutes: 60, name: 'Leo paused', tag: 'pause:x' });
    expect((await api.policies.list()).policies.filter((p) => p.tag === 'pause:x').map((p) => p.id)).toEqual([b.id]);
    vi.setSystemTime(Date.now() + 61 * 60_000);
    expect((await api.policies.list()).policies.some((p) => p.tag === 'pause:x')).toBe(false);
    await expect(api.policies.pause({ who, minutes: 0 })).rejects.toThrow('A pause lasts from 1 minute to 7 days.');
  });

  test('an end time can be added and removed', async () => {
    const leo = await mac('Leo-iPad');
    const p = await api.policies.create(block([{ type: 'client', id: leo }]));
    const until = Math.floor(Date.now() / 1000) + 3600;
    expect((await api.policies.update(p.id, { until })).until).toBe(until);
    expect((await api.policies.update(p.id, { until: 0 })).until).toBeNull();
  });
});

describe('route through', () => {
  const route = (who: PolicyInput['who'], target: string, more: PolicyInput = {}): PolicyInput =>
    block(who, { action: { kind: 'route', target, fallback: 'normal' }, ...more });

  test('offers the VPN tunnels and the uplinks, with whether each is up', async () => {
    expect(await api.policies.routeTargets()).toEqual([
      { id: 'vpn:10101', kind: 'vpn', name: 'UK VPN', label: 'UK VPN (WireGuard)', up: true },
      { id: 'uplink:wan', kind: 'uplink', name: 'Ethernet 1', label: 'Ethernet 1', up: true },
      { id: 'uplink:secondwan', kind: 'uplink', name: 'Ethernet 2', label: 'Ethernet 2', up: false },
    ]);
  });

  test('creates a policy that keeps its target and what happens when that is down', async () => {
    const leo = await mac('Leo-iPad');
    const p = await api.policies.create(route([{ type: 'client', id: leo }], 'uplink:wan'));
    expect(p.action).toEqual({ kind: 'route', target: 'uplink:wan', fallback: 'normal' });
    const safe = await api.policies.create(
      block([{ type: 'client', id: leo }], { action: { kind: 'route', target: 'vpn:10101' } as never }),
    );
    expect(safe.action).toEqual({ kind: 'route', target: 'vpn:10101', fallback: 'block' });
    expect(await find(p.name)).toMatchObject({ action: { kind: 'route', target: 'uplink:wan' } });
  });

  test('mistakes are explained in the router’s words', async () => {
    const who = [{ type: 'client' as const, id: await mac('Leo-iPad') }];
    await expect(api.policies.create(route(who, 'wan'))).rejects.toThrow('Choose a VPN tunnel or an internet connection to route through.');
    await expect(api.policies.create(route(who, 'vpn:99999'))).rejects.toThrow('The router has no such VPN tunnel or internet connection.');
    await expect(api.policies.create(route(who, 'vpn:10101', { what: { kind: 'everything' } }))).rejects.toThrow(
      'Routing covers the internet or chosen sites',
    );
    await expect(
      api.policies.create(route(who, 'vpn:10101', { action: { kind: 'route', target: 'vpn:10101', fallback: 'maybe' as never } })),
    ).rejects.toThrow('either blocked or takes the normal route');
  });

  test('a change that leaves the route alone is fine, and it covers chosen sites too', async () => {
    const tv = (await find('TV via UK VPN')) as Policy;
    expect((await api.policies.update(tv.id, { enabled: false })).enabled).toBe(false);
    const sites = await api.policies.update(tv.id, { what: { kind: 'sites', sites: ['netflix.com'] } });
    expect(sites).toMatchObject({ what: { kind: 'sites' }, action: { kind: 'route' } });
  });
});

test('networks are named by their firewall zone', () => {
  expect(zoneOf({ id: 'main', fixed: true, vlanId: 1 })).toBe('lan');
  expect(zoneOf({ id: 'guest', fixed: true, vlanId: 9 })).toBe('guest');
  expect(zoneOf({ id: 'iot', fixed: true, vlanId: 10 })).toBe('iot');
  expect(zoneOf({ id: 'Lab', fixed: false, vlanId: 20 })).toBe('vlan20');
});
