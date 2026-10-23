import { beforeEach, expect, test } from 'vitest';
import { createRouterApi, type RouterApi } from '../api.ts';
import { createMockTransport } from '../mock/transport.ts';
import { forwardRule, localName, namesInSync } from './names.ts';

let api: RouterApi;
beforeEach(async () => {
  api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
});

test('named devices are sent across and answer as host.zone; repeats get -2', async () => {
  const [a, b] = (await api.clients.list()).filter((c) => c.online);
  if (!a || !b) throw new Error('the demo has online devices');
  await api.clients.setInfo(a.mac, 'Front Room TV', 'television');
  await api.clients.setInfo(b.mac, 'front room tv!', 'television');
  const clients = await api.clients.list();
  expect(namesInSync(await api.names.list(), clients)).toBe(false);
  const names = await api.names.sync(clients);
  expect(namesInSync(names, clients)).toBe(true);
  expect([localName(names, a.mac), localName(names, b.mac)].sort()).toEqual(['front-room-tv-2.lan', 'front-room-tv.lan']);
  expect(localName(names, '02:00:00:00:00:99')).toBe('');
  expect(localName((await api.names.setEnabled(false)) ?? names, a.mac)).toBe('');
});

test('dismissing is remembered and can be undone', async () => {
  const mac = '02:5E:E1:10:14:C8';
  expect((await api.names.dismiss([mac])).dismissed).toContain(mac);
  expect((await api.names.dismiss([mac], false)).dismissed).not.toContain(mac);
});

test('AdGuard is told once to send .lan lookups to dnsmasq', async () => {
  await api.names.forwardToDnsmasq('lan');
  await api.names.forwardToDnsmasq('lan');
  const { upstream_dns } = await api.transport.adguard<{ upstream_dns: string[] }>('dns_info');
  expect(upstream_dns.filter((u) => u === forwardRule('lan'))).toHaveLength(1);
  expect(upstream_dns[0]).toBe('[/lan/]127.0.0.1:53');
});
