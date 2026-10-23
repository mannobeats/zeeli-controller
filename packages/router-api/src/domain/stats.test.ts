import { beforeEach, describe, expect, test } from 'vitest';
import { createRouterApi, type RouterApi } from '../api.ts';
import { RouterError } from '../errors.ts';
import { createMockTransport } from '../mock/transport.ts';
import { historyNetworkId } from './stats.ts';

let api: RouterApi;
beforeEach(async () => {
  api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
});

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

describe('history series', () => {
  test('each range has the points and step the agent’s rings have', async () => {
    const lengths = await Promise.all(
      (['24h', '30d', '12m'] as const).map(async (r) => (await api.stats.traffic('network', 'lan', r))?.points.length),
    );
    expect(lengths).toEqual([288, 720, 365]);
    expect((await api.stats.traffic('network', 'lan', '24h'))?.step).toBe(300);
  });

  test('totals add up the points, and a device’s traffic shows its daily rhythm', async () => {
    const mac = (await api.clients.list()).find((c) => c.hostname === 'Living-Room-TV')?.mac ?? '';
    const day = await api.stats.traffic('client', mac, '24h');
    expect(day?.totals.down).toBe(sum(day?.points.map((p) => p?.down) ?? []));
    // the TV is only on in the evening: the points while nobody watched are gaps, not zeros
    expect(day?.points.some((p) => p === null)).toBe(true);
    expect(day?.points.some((p) => p !== null)).toBe(true);
    const hours = await api.stats.traffic('client', mac, '30d');
    expect(hours?.totals.down).toBeGreaterThan(day?.totals.down ?? Number.POSITIVE_INFINITY);
  });

  test('a network is the sum of its devices', async () => {
    const clients = (await api.clients.list()).filter((c) => c.ip.startsWith('192.168.8.'));
    const parts = await Promise.all(clients.map((c) => api.stats.traffic('client', c.mac, '12m')));
    const lan = await api.stats.traffic('network', 'lan', '12m');
    expect(lan?.totals.down).toBe(sum(parts.map((p) => p?.totals.down)));
  });

  test('a device we have never seen has no history rather than an error', async () => {
    expect(await api.stats.traffic('client', 'AA:BB:CC:00:00:99', '24h')).toBeNull();
    expect(await api.stats.health('eth9', '24h')).toBeNull();
  });

  test('the main uplink has a gap for the outage, and the second takes over for it', async () => {
    const wan = await api.stats.traffic('wan', 'wan', '24h');
    const second = await api.stats.traffic('wan', 'wwan', '24h');
    const gaps = (wan?.points ?? []).flatMap((p, i) => (p === null ? [i] : []));
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.length).toBeLessThan(5);
    expect(second?.points.some((p, i) => p !== null && gaps.includes(i))).toBe(true);
    const health = await api.stats.health('wan', '24h');
    expect(health?.points.filter((p) => p === null).length).toBe(gaps.length);
  });

  test('health reads in milliseconds and percent; the system in percent and degrees', async () => {
    const health = (await api.stats.health('wan', '24h'))?.points.find((p) => p !== null);
    expect(health?.gatewayMs).toBeGreaterThan(0.5);
    expect(health?.gatewayMs).toBeLessThan(10);
    expect(health?.internetMs).toBeGreaterThan(10);
    const sys = (await api.stats.system('24h'))?.points.find((p) => p !== null);
    expect(sys?.cpu).toBeGreaterThan(0);
    expect(sys?.cpu).toBeLessThan(100);
    expect(sys?.temp).toBeGreaterThan(40);
    expect(sys?.temp).toBeLessThan(80);
  });

  test('console networks map to the ids the agent uses', () => {
    expect(historyNetworkId({ id: 'main', vlanId: 1 })).toBe('lan');
    expect(historyNetworkId({ id: 'guest', vlanId: 9 })).toBe('guest');
    expect(historyNetworkId({ id: 'Lab', vlanId: 20 })).toBe('vlan20');
    expect(historyNetworkId({ id: 'Lab', vlanId: null })).toBe('Lab');
  });
});

describe('top usage', () => {
  test('devices and networks are ranked by what they moved', async () => {
    const top = await api.stats.top('30d', 3);
    expect(top.clients).toHaveLength(3);
    const totals = top.clients.map((c) => c.down + c.up);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    expect(top.networks[0]?.id).toBe('lan');
    expect(top.wans[0]?.id).toBe('wan');
    expect(top.asOf).toBeInstanceOf(Date);
  });
});

describe('events and alerts', () => {
  test('events come newest first and can be narrowed to kinds', async () => {
    const all = await api.stats.events({ limit: 500 });
    expect(all.map((e) => e.time.getTime())).toEqual(all.map((e) => e.time.getTime()).sort((a, b) => b - a));
    const outages = await api.stats.events({ kinds: ['wan.down', 'wan.up'] });
    expect(outages.every((e) => e.kind.startsWith('wan.'))).toBe(true);
    expect(outages.length).toBeGreaterThanOrEqual(6);
    expect((await api.stats.events({ limit: 2 })).length).toBe(2);
    const mac = (await api.clients.list()).find((c) => c.hostname === 'Maya-iPhone')?.mac ?? '';
    const maya = await api.stats.events({ subject: mac.toLowerCase() });
    expect(maya.length).toBeGreaterThan(2);
    expect(maya.every((e) => e.subject === mac)).toBe(true);
    const recent = await api.stats.events({ since: new Date(Date.now() - 3600_000) });
    expect(recent.every((e) => e.time.getTime() > Date.now() - 3600_000)).toBe(true);
  });

  test('the new device and the outage are unread alerts until acknowledged', async () => {
    const before = await api.stats.alerts();
    expect(before.alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(['device.new', 'wan.down']));
    expect(before.alerts.every((a) => a.alert)).toBe(true);
    const first = before.alerts[0];
    const one = await api.stats.acknowledge(first ? [first.id] : []);
    expect(one.unread).toBe(before.unread - 1);
    const none = await api.stats.acknowledgeAll();
    expect([none.unread, none.alerts]).toEqual([0, []]);
  });

  test('which kinds raise alerts is a setting', async () => {
    expect((await api.stats.alerts()).on).toContain('wan.down');
    const next = await api.stats.setAlertKinds(['device.left']);
    expect(next.on).toEqual(['device.left']);
    expect((await api.stats.alerts()).on).toEqual(['device.left']);
  });

  test('the ping target and heat limit round-trip', async () => {
    expect(await api.stats.settings()).toEqual({ target: '1.1.1.1', tempHigh: 85 });
    expect(await api.stats.saveSettings({ target: '9.9.9.9', tempHigh: 90 })).toEqual({ target: '9.9.9.9', tempHigh: 90 });
    expect((await api.stats.settings()).target).toBe('9.9.9.9');
  });
});

describe('status', () => {
  test('says the collector is running and how much it keeps', async () => {
    const s = await api.stats.status();
    expect(s?.running).toBe(true);
    expect(s?.devices).toBeGreaterThan(0);
    expect(s?.savedAt).toBeInstanceOf(Date);
  });

  test('is null on a router whose agent has no history', async () => {
    const real = createMockTransport({ latencyMs: 0 });
    const old = createRouterApi({
      ...real,
      zeeli: async () => {
        throw new RouterError('failed', 'The Zeeli agent didn’t answer (Not found).');
      },
    });
    expect(await old.stats.status()).toBeNull();
  });

  test('other failures are not hidden', async () => {
    const real = createMockTransport({ latencyMs: 0 });
    const broken = createRouterApi({
      ...real,
      zeeli: async () => {
        throw new RouterError('offline', 'No answer.');
      },
    });
    await expect(broken.stats.status()).rejects.toBeInstanceOf(RouterError);
  });
});
