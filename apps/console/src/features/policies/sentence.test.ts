import type { Client, Group, Network, Policy } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { daysText, listed, type Names, plain, sentence, speedText, suggestedName, untilText, whatText, whenText } from './sentence.ts';

const client = (mac: string, name: string) => ({ mac, name }) as Client;
const net = (id: string, label: string, fixed = true, vlanId = 1) => ({ id, label, fixed, vlanId }) as Network;
const kids: Group = { id: 'a1b2c3', name: 'Kids', kind: 'person', members: [] };
const names: Names = {
  clients: [client('02:00:00:00:00:01', 'Living-Room-TV'), client('02:00:00:00:00:02', 'Leo’s iPad')],
  groups: [kids],
  networks: [net('main', 'Main LAN'), net('guest', 'Guest'), net('Lab', 'Lab', false, 20)],
  targets: [
    { id: 'vpn:10101', kind: 'vpn', name: 'UK VPN', label: 'UK VPN (WireGuard)', up: true },
    { id: 'uplink:secondwan', kind: 'uplink', name: 'Ethernet 2', label: 'Ethernet 2', up: false },
  ],
  tzoffset: '-0400',
};

const policy = (more: Partial<Policy>): Policy => ({
  id: '000001',
  name: 'P',
  enabled: true,
  order: 10,
  who: [{ type: 'group', id: 'a1b2c3' }],
  what: { kind: 'internet' },
  when: { kind: 'always' },
  until: null,
  action: { kind: 'block' },
  tag: '',
  active: false,
  ...more,
});
const text = (p: Policy, now?: number) => plain(sentence(p, names, now));

test('a block reads as who, what and when', () => {
  const night = policy({ when: { kind: 'schedule', days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '07:00' } });
  expect(text(night)).toBe('Block Kids from the internet every day 22:00–07:00');
  expect(
    sentence(night, names)
      .filter((s) => s.strong)
      .map((s) => s.text),
  ).toEqual(['Kids', 'the internet', 'every day 22:00–07:00']);
});

test('each kind of target', () => {
  const tv = { type: 'client' as const, id: '02:00:00:00:00:01' };
  expect(text(policy({ who: [tv], what: { kind: 'sites', sites: ['tiktok.com'] } }))).toBe('Block Living-Room-TV from tiktok.com');
  expect(text(policy({ what: { kind: 'sites', sites: ['a.com', 'b.com', 'c.com', 'd.com'] } }))).toBe(
    'Block Kids from a.com, b.com and 2 more sites',
  );
  expect(text(policy({ what: { kind: 'network', network: 'guest' } }))).toBe('Block Kids from reaching Guest');
  expect(text(policy({ what: { kind: 'network', network: 'vlan20' } }))).toBe('Block Kids from reaching Lab');
  expect(text(policy({ what: { kind: 'everything' } }))).toBe('Block Kids from everything');
  expect(text(policy({ who: [{ type: 'network', id: 'guest' }], what: { kind: 'network', network: 'lan' } }))).toBe(
    'Block everyone on Guest from reaching Main LAN',
  );
});

test('allow and limit read their own way', () => {
  expect(text(policy({ action: { kind: 'allow' } }))).toBe('Allow Kids to reach the internet');
  expect(text(policy({ action: { kind: 'limit', down: 5, up: 1 } }))).toBe('Limit Kids to 5 Mbps down, 1 up');
  expect(speedText(2.5, 0)).toBe('2.5 Mbps down');
  expect(speedText(0, 1)).toBe('1 Mbps up');
});

test('a route reads as who, the target and, for sites, what', () => {
  const tv = [{ type: 'client' as const, id: '02:00:00:00:00:01' }];
  const via = (target: string) => ({ kind: 'route' as const, target, fallback: 'block' as const });
  expect(text(policy({ who: tv, action: via('vpn:10101') }))).toBe('Route Living-Room-TV through UK VPN');
  expect(text(policy({ action: via('uplink:secondwan') }))).toBe('Route Kids through Ethernet 2');
  expect(text(policy({ what: { kind: 'sites', sites: ['netflix.com'] }, action: via('vpn:10101') }))).toBe(
    'Route Kids to netflix.com through UK VPN',
  );
  expect(text(policy({ action: via('vpn:99999') }))).toBe('Route Kids through a connection that’s gone');
  expect(
    sentence(policy({ who: tv, action: via('vpn:10101') }), names)
      .filter((s) => s.strong)
      .map((s) => s.text),
  ).toEqual(['Living-Room-TV', 'UK VPN']);
  expect(suggestedName(policy({ who: tv, action: via('vpn:10101') }), names)).toBe('Route Living-Room-TV through UK VPN');
});

test('who is listed the way people say it', () => {
  const who = [
    { type: 'group' as const, id: 'a1b2c3' },
    { type: 'client' as const, id: '02:00:00:00:00:02' },
    { type: 'client' as const, id: '02:00:00:00:00:01' },
    { type: 'client' as const, id: '02:00:00:00:00:99' },
  ];
  expect(text(policy({ who: who.slice(0, 2) }))).toBe('Block Kids and Leo’s iPad from the internet');
  expect(text(policy({ who }))).toBe('Block Kids, Leo’s iPad and 2 more from the internet');
  expect(text(policy({ who: [{ type: 'client', id: '02:00:00:00:00:99' }] }))).toBe('Block 02:00:00:00:00:99 from the internet');
  expect(text(policy({ who: [{ type: 'group', id: 'gone' }] }))).toBe('Block a deleted group from the internet');
  expect(text(policy({ who: [] }))).toBe('Block nobody from the internet');
  expect(listed(['a'])).toBe('a');
});

test('days read as a person would say them', () => {
  expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe('every day');
  expect(daysText([5, 1, 3, 2, 4])).toBe('weekdays');
  expect(daysText([7, 6])).toBe('weekends');
  expect(daysText([6])).toBe('every Saturday');
  expect(daysText([1, 3, 5])).toBe('Monday, Wednesday and Friday');
  expect(daysText([2, 4])).toBe('Tuesday and Thursday');
});

test('a whole day, and an overnight window, are written as such', () => {
  expect(whenText({ when: { kind: 'schedule', days: [6], from: '00:00', to: '00:00' } })).toBe('every Saturday, all day');
  expect(whenText({ when: { kind: 'schedule', days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' } })).toBe('weekdays 09:00–17:00');
  expect(whenText({ when: { kind: 'always' } })).toBe('');
});

test('an end time is written in the router’s clock, with the day when it isn’t today', () => {
  // 18:00 Thursday 22 October 2026 in UTC-4 is 22:00 UTC
  const now = Date.UTC(2026, 9, 22, 22) / 1000;
  expect(untilText(now + 3600, '-0400', now)).toMatch(/7:00\s?PM/);
  expect(untilText(now + 20 * 3600, '-0400', now)).toMatch(/^Fri /);
  expect(text(policy({ until: now + 3600 }), now)).toMatch(/^Block Kids from the internet until \d+:00\s?PM$/);
});

test('whatText and the suggested name', () => {
  expect(whatText({ what: { kind: 'internet' } }, names)).toBe('the internet');
  expect(suggestedName(policy({ when: { kind: 'schedule', days: [1], from: '22:00', to: '07:00' }, until: 5 }), names)).toBe(
    'Block Kids from the internet',
  );
});
