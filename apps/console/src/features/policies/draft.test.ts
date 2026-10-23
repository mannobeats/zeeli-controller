import type { Client, Group, Network, Policy } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { emptyForm, formOf, inputOf, partsOf } from './draft.ts';
import type { Names } from './sentence.ts';

const kids: Group = { id: 'a1b2c3', name: 'Kids', kind: 'person', members: [] };
const names: Names = { clients: [] as Client[], groups: [kids], networks: [] as Network[], targets: [] };
const NOW = 1_800_000_000;

const stored: Policy = {
  id: '000001',
  name: 'Bedtime',
  enabled: true,
  order: 10,
  who: [{ type: 'group', id: 'a1b2c3' }],
  what: { kind: 'internet' },
  when: { kind: 'schedule', days: [1, 2, 3], from: '21:00', to: '06:30' },
  until: NOW + 100,
  action: { kind: 'block' },
  tag: '',
  active: false,
};

test('a new policy starts on the first group, and presets set the step they are about', () => {
  expect(emptyForm('', [kids]).who).toEqual([{ type: 'group', id: 'a1b2c3' }]);
  expect(emptyForm('', []).who).toEqual([]);
  expect(emptyForm('bedtime', [kids])).toMatchObject({ scheduled: true, from: '22:00', to: '07:00' });
  expect(emptyForm('site', [kids]).whatKind).toBe('sites');
  expect(emptyForm('pause', [kids]).ends).toBe('1h');
  expect(emptyForm('limit', [kids]).action).toBe('limit');
});

test('editing starts from the stored policy', () => {
  const f = formOf(stored);
  expect(f).toMatchObject({ scheduled: true, days: [1, 2, 3], from: '21:00', to: '06:30', ends: 'keep', action: 'block' });
  expect(formOf({ ...stored, until: null }).ends).toBe('never');
  expect(formOf({ ...stored, what: { kind: 'sites', sites: ['a.com', 'b.com'] } }).sites).toBe('a.com\nb.com');
  expect(formOf({ ...stored, what: { kind: 'network', network: 'guest' } }).network).toBe('guest');
  expect(formOf({ ...stored, when: { kind: 'always' } }).scheduled).toBe(false);
  expect(formOf({ ...stored, action: { kind: 'limit', down: 5, up: 0 } })).toMatchObject({ action: 'limit', down: '5', up: '' });
});

test('sites are cleaned up and limits only cover the internet or everything', () => {
  const f = { ...emptyForm('', [kids]), whatKind: 'sites' as const, sites: ' https://www.TikTok.com/en \n\ninstagram.com' };
  expect(partsOf(f, null, NOW).what).toEqual({ kind: 'sites', sites: ['www.tiktok.com', 'instagram.com'] });
  expect(partsOf({ ...f, action: 'limit', down: '5' }, null, NOW).what).toEqual({ kind: 'internet' });
  expect(partsOf({ ...f, action: 'limit', whatKind: 'everything', down: '5', up: 'x' }, null, NOW)).toMatchObject({
    what: { kind: 'everything' },
    action: { kind: 'limit', down: 5, up: 0 },
  });
});

const targets = [
  { id: 'vpn:10101', kind: 'vpn' as const, name: 'UK VPN', label: 'UK VPN (WireGuard)', up: true },
  { id: 'uplink:wan', kind: 'uplink' as const, name: 'Ethernet 1', label: 'Ethernet 1', up: true },
];

test('a route starts on the first target, blocks by default, and covers the internet or sites', () => {
  const f = emptyForm('route', [kids], targets);
  expect(f).toMatchObject({ action: 'route', target: 'vpn:10101', fallback: 'block' });
  expect(emptyForm('route', [kids]).target).toBe('');
  expect(partsOf(f, null, NOW).action).toEqual({ kind: 'route', target: 'vpn:10101', fallback: 'block' });
  expect(partsOf({ ...f, whatKind: 'network', network: 'guest' }, null, NOW).what).toEqual({ kind: 'internet' });
  expect(partsOf({ ...f, whatKind: 'everything' }, null, NOW).what).toEqual({ kind: 'internet' });
  expect(partsOf({ ...f, whatKind: 'sites', sites: 'netflix.com' }, null, NOW).what).toEqual({ kind: 'sites', sites: ['netflix.com'] });
  const route: Policy = { ...stored, action: { kind: 'route', target: 'uplink:wan', fallback: 'normal' } };
  expect(formOf(route)).toMatchObject({ action: 'route', target: 'uplink:wan', fallback: 'normal' });
  expect(inputOf(formOf(route), { ...names, targets }, route, NOW)).toMatchObject({
    name: 'Bedtime',
    action: { kind: 'route', target: 'uplink:wan', fallback: 'normal' },
  });
  expect(inputOf({ ...f, name: '' }, { ...names, targets }, null, NOW).name).toBe('Route Kids through UK VPN');
});

test('end times count from the router’s clock', () => {
  const f = emptyForm('', [kids]);
  expect(partsOf({ ...f, ends: '1h' }, null, NOW).until).toBe(NOW + 3600);
  expect(partsOf({ ...f, ends: '7d' }, null, NOW).until).toBe(NOW + 7 * 86_400);
  expect(partsOf({ ...f, ends: 'keep' }, NOW + 5, NOW).until).toBe(NOW + 5);
  expect(partsOf({ ...f, ends: 'never' }, NOW + 5, NOW).until).toBeNull();
});

test('what is sent: a name from the sentence, and an end time only when it changes', () => {
  const f = { ...emptyForm('', [kids]), who: stored.who };
  const create = inputOf(f, names, null, NOW);
  expect(create).toMatchObject({
    name: 'Block Kids from the internet',
    enabled: true,
    when: { kind: 'always' },
    action: { kind: 'block' },
  });
  expect('until' in create).toBe(false);
  expect(inputOf({ ...f, ends: '4h' }, names, null, NOW).until).toBe(NOW + 4 * 3600);
  expect(inputOf({ ...f, name: '  Mine  ' }, names, null, NOW).name).toBe('Mine');
  expect(inputOf({ ...f, ends: 'never' }, names, stored, NOW).until).toBe(0);
  expect('until' in inputOf({ ...f, ends: 'keep' }, names, stored, NOW)).toBe(false);
});

test('a long suggested name is cut to what the router accepts', () => {
  const f = {
    ...emptyForm('', [kids]),
    who: stored.who,
    whatKind: 'sites' as const,
    sites: 'a-very-long-site-name-that-goes-on-and-on.example.com',
  };
  expect(inputOf(f, names, null, NOW).name?.length).toBeLessThanOrEqual(40);
});
