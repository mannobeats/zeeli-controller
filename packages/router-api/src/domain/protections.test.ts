import { beforeEach, expect, test } from 'vitest';
import { createRouterApi, type RouterApi } from '../api.ts';
import { createMockTransport } from '../mock/transport.ts';

let api: RouterApi;
beforeEach(async () => {
  api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
});

test('AdGuard protections read back after a change', async () => {
  expect(await api.dns.protections.get()).toEqual({ safeBrowsing: true, adultContent: false, safeSearch: false });
  const kept = await api.dns.protections.set({ adultContent: true, safeSearch: true });
  expect(kept).toEqual({ safeBrowsing: true, adultContent: true, safeSearch: true });
  expect(await api.dns.protections.set({ safeBrowsing: false })).toMatchObject({ safeBrowsing: false });
});
