import { beforeEach, expect, test } from 'vitest';
import { createRouterApi, type RouterApi } from './api.ts';
import { RouterError } from './errors.ts';
import { createMockTransport } from './mock/transport.ts';

let api: RouterApi;
beforeEach(async () => {
  api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
});

test('a wrong password is refused', async () => {
  const fresh = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await expect(fresh.session.login('nope')).rejects.toBeInstanceOf(RouterError);
  expect(fresh.session.signedIn()).toBe(false);
});

test('clients carry a readable name and link', async () => {
  const list = await api.clients.list();
  const tv = list.find((c) => c.hostname === 'Living-Room-TV');
  expect(tv?.name).toBe('Living-Room-TV');
  expect(tv?.link.band).toBe('mlo');
  await api.clients.setInfo(tv?.mac ?? '', 'TV', 'television');
  expect((await api.clients.list()).find((c) => c.mac === tv?.mac)?.name).toBe('TV');
});

async function twoMacs() {
  const [a, b] = (await api.clients.list()).map((c) => c.mac);
  if (!a || !b) throw new Error('the demo has fewer than two clients');
  return [a, b] as const;
}

test('bulk block merges with the existing list and is verified', async () => {
  const [a, b] = await twoMacs();
  await api.clients.setBlocked([a, b], true);
  expect((await api.clients.access()).blocked).toEqual(expect.arrayContaining([a, b]));
});

test('unblocking one keeps the others blocked', async () => {
  const [a, b] = await twoMacs();
  await api.clients.setBlocked([a, b], true);
  await api.clients.setBlocked([a], false);
  const after = await api.clients.access();
  expect(after.blocked).toContain(b);
  expect(after.blocked).not.toContain(a);
});

test('reservations round-trip', async () => {
  const before = await api.networks.reservations();
  await api.networks.reserve({ mac: '02:5E:E1:00:00:99', ip: '192.168.8.99', name: 'test', network: 'main' });
  expect(await api.networks.reservations()).toHaveLength(before.length + 1);
});
