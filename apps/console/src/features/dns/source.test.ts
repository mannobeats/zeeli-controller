import type { DnsConfig } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { sourceSettings } from './source.ts';

const base = { mode: 'manual', manual_list: [], servers_list: [], provider: '', proto: '' } as unknown as DnsConfig;
const cloudflare = { provider: 'cloudflare', protocols: ['dot', 'doh'], servers: [{ name: 'Standard', description: '' }] };

test('manual mode gets default servers when none are set', () => {
  expect(sourceSettings(base, 'manual', { provider: '', proto: '', server: '', nextdns: '' }, undefined).manual_list).toEqual([
    '1.1.1.1',
    '1.0.0.1',
  ]);
});

test('encrypted DNS falls back to a protocol and server the provider supports', () => {
  const s = sourceSettings(base, 'secure', { provider: 'cloudflare', proto: 'doq', server: '', nextdns: '' }, cloudflare);
  expect(s).toMatchObject({ mode: 'secure', provider: 'cloudflare', proto: 'dot', servers_list: ['Standard'] });
});

test('NextDNS needs a six-character ID', () => {
  const pick = { provider: 'nextdns', proto: 'dot', server: '', nextdns: 'nope' };
  expect(() => sourceSettings(base, 'secure', pick, undefined)).toThrow(/six-character/);
  expect(sourceSettings(base, 'secure', { ...pick, nextdns: 'abc123' }, undefined).nextdns_id).toBe('abc123');
});
