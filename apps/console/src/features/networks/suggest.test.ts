import { cidrOf, type Network, parseCidr, type Reservation } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import {
  addressFamily,
  autofill,
  conflicts,
  defaultRange,
  type Facts,
  planText,
  suggest,
  TAILSCALE,
  type Taken,
  uniqueName,
} from './suggest.ts';

const taken = (label: string, cidr: string): Taken => ({ label, cidr: parseCidr(cidr) as Taken['cidr'] });
const net = (id: string, ip: string, vlanId: number | null): Network =>
  ({ id, label: id, ip, netmask: '255.255.255.0', vlanId, dns: [] }) as unknown as Network;

test('the family follows where the router’s networks live', () => {
  expect(addressFamily([{ ip: '10.0.10.1' }])).toBe('10.0');
  expect(addressFamily([{ ip: '192.168.8.1' }])).toBe('192.168');
});

test('a suggestion skips used VLAN IDs and taken subnets', () => {
  const used = new Set([10, 11, 12]);
  expect(suggest('10.0', 24, used, [])).toEqual({ vlanId: 13, ip: '10.0.13.1' });
  expect(suggest('10.0', 24, new Set(), [taken('WireGuard', '10.0.10.0/24'), taken('WAN', '10.0.11.0/25')])).toEqual({
    vlanId: 12,
    ip: '10.0.12.1',
  });
  expect(suggest('10.0', 22, new Set(), [taken('x', '10.0.8.0/24')])?.vlanId).toBe(12);
  expect(suggest('100.64', 24, new Set(), [TAILSCALE])).toBeNull();
});

test('names stay unique', () => {
  expect(uniqueName('Guest', ['guest'])).toBe('Guest 2');
  expect(uniqueName('Lab', ['Home'])).toBe('Lab');
});

test('the default range runs from .6 to the last host', () => {
  expect(defaultRange('10.0.30.1', 24)).toEqual({ start: '10.0.30.6', end: '10.0.30.254' });
  expect(defaultRange('10.0.30.1', 25)?.end).toBe('10.0.30.126');
  expect(defaultRange('nope', 24)).toBeNull();
});

const form = {
  label: 'Cams',
  ip: '10.0.30.1',
  netmask: '255.255.255.0',
  vlanId: '30',
  dhcp: true,
  dhcpStart: '10.0.30.6',
  dhcpEnd: '10.0.30.254',
};
const facts = (over: Partial<Facts> = {}): Facts => ({
  networks: [net('main', '10.0.10.1', null)],
  taken: [TAILSCALE, taken('the WireGuard server', '10.0.0.0/24')],
  vlans: new Map([[40, 'port LAN3']]),
  reservations: [],
  editing: null,
  ...over,
});

test('a clean form has no conflicts', () => {
  expect(conflicts(form, facts())).toEqual({});
});

test('subnet, gateway, VLAN and name conflicts are found', () => {
  expect(conflicts({ ...form, ip: '10.0.10.1' }, facts()).subnet).toMatch(/overlaps main/);
  expect(conflicts({ ...form, ip: '10.0.0.1' }, facts()).subnet).toMatch(/WireGuard/);
  expect(conflicts({ ...form, ip: '100.64.1.1' }, facts()).subnet).toMatch(/Tailscale/);
  expect(conflicts({ ...form, ip: '10.0.30.0' }, facts()).gateway).toMatch(/first address/);
  expect(conflicts({ ...form, ip: '10.0.30.255' }, facts()).gateway).toMatch(/broadcast/);
  expect(conflicts({ ...form, vlanId: '40' }, facts()).vlan).toMatch(/port LAN3/);
  expect(conflicts({ ...form, label: 'MAIN' }, facts()).name).toMatch(/already/);
});

test('a network being edited doesn’t conflict with itself', () => {
  const me = net('Cams', '10.0.30.1', 30);
  const f = facts({ networks: [net('main', '10.0.10.1', null), me], vlans: new Map([[30, 'Cams']]), editing: me });
  expect(conflicts(form, f)).toEqual({});
});

test('DHCP range problems and swallowed reservations are reported', () => {
  expect(conflicts({ ...form, dhcpEnd: '10.0.31.9' }, facts()).range).toMatch(/inside 10\.0\.30\.0\/24/);
  expect(conflicts({ ...form, dhcpStart: '10.0.30.1' }, facts()).range).toMatch(/gateway/);
  expect(conflicts({ ...form, dhcpStart: '10.0.30.9', dhcpEnd: '10.0.30.8' }, facts()).range).toMatch(/comes after/);
  const reservations = [{ mac: 'AA', ip: '10.0.30.20', name: '', network: 'Cams' }] as Reservation[];
  expect(conflicts(form, facts({ reservations })).reserved).toMatch(/10\.0\.30\.20/);
  expect(conflicts({ ...form, dhcpStart: '10.0.30.30' }, facts({ reservations })).reserved).toBeUndefined();
});

test('fields on auto follow the ones the person set', () => {
  const env = { family: '10.0', usedVlans: new Set([10]), taken: [] };
  const blank = { ip: '', netmask: '255.255.255.0', vlanId: '', dhcpStart: '', dhcpEnd: '' };
  const on = { ip: true, vlan: true, range: true, name: true };
  const first = autofill(blank, on, env);
  expect(first).toMatchObject({ vlanId: '11', ip: '10.0.11.1', dhcpStart: '10.0.11.6', dhcpEnd: '10.0.11.254' });
  expect(autofill({ ...first, vlanId: '30' }, { ...on, vlan: false }, env)).toMatchObject({ ip: '10.0.30.1', dhcpEnd: '10.0.30.254' });
  expect(autofill({ ...first, ip: '10.9.9.1', dhcpEnd: '10.9.9.9' }, { ...on, ip: false, range: false }, env)).toMatchObject({
    ip: '10.9.9.1',
    dhcpEnd: '10.9.9.9',
  });
  expect(cidrOf('10.0.11.1', 24).network).toBe('10.0.11.0');
});

test('the plan says what will be created in plain words', () => {
  const plan = { ...form, isolate: true, wanAccess: 1 as const, dnsText: '' };
  expect(planText(plan)).toBe('Creates VLAN 30, 10.0.30.0/24 with addresses .6–.254 handed out, isolated, internet only.');
  expect(planText({ ...plan, dhcp: false, isolate: false, wanAccess: 2, dnsText: 'DNS from Quad9' })).toBe(
    'Creates VLAN 30, 10.0.30.0/24 with DHCP off, local only, no internet, DNS from Quad9.',
  );
});
