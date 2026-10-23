import type { Client, Network, RemoteAccess, Reservation, WifiEntry } from '@zeeli/router-api';
import { cidrOf, parseCidr } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { type CheckupData, type Finding, runCheckup, summary } from './checks.ts';

const net = (id: string, base: string, extra: Partial<Network> = {}): Network =>
  ({
    id,
    label: id,
    fixed: false,
    enabled: true,
    ip: `${base}.1`,
    netmask: '255.255.255.0',
    dhcp: true,
    dhcpStart: `${base}.100`,
    dhcpEnd: `${base}.199`,
    isolate: true,
    wanAccess: 1,
    ports: [{ name: 'LAN1', kind: 'wired', up: true }],
    ...extra,
  }) as Network;

const wifi = (id: string, extra: Partial<WifiEntry> = {}): WifiEntry => ({
  id,
  owner: 'zeeli',
  role: null,
  ssid: id,
  bands: ['5g'],
  network: 'main',
  security: 'sae-mixed',
  hidden: false,
  isolate: false,
  disabled: false,
  hasKey: true,
  ...extra,
});

const client = (ip: string): Client => ({ mac: ip, ip }) as Client;
const reservation = (ip: string, network = 'main'): Reservation => ({ mac: 'AA', ip, name: 'printer', network });
const remote = (extra: Partial<RemoteAccess> = {}): RemoteAccess => ({
  enable_https: false,
  enable_ssh: false,
  enable_ping: false,
  enable_whitelist: false,
  whitelist: [],
  ...extra,
});

const clean = (): CheckupData => ({
  networks: [net('main', '192.168.8')],
  reservations: [],
  clients: [],
  wifi: [wifi('home')],
  wan: null,
  vpn: [],
  remote: remote(),
  adguard: { enabled: false, dns_enabled: false },
  firmware: null,
});
const ids = (data: Partial<CheckupData>) => runCheckup({ ...clean(), ...data }).findings.map((f) => f.id);
const one = (data: Partial<CheckupData>): Finding => {
  const { findings } = runCheckup({ ...clean(), ...data });
  expect(findings).toHaveLength(1);
  return findings[0] as Finding;
};

test('a tidy setup has nothing to report', () => {
  expect(runCheckup(clean())).toEqual({ findings: [], skipped: [] });
  expect(summary([])).toBe('');
});

test('an IoT network that reaches upstream is a problem; one kept to the internet is fine', () => {
  expect(one({ networks: [net('iot', '192.168.10', { wanAccess: 0 })] })).toMatchObject({ severity: 'problem', id: 'iot-reach:iot' });
  expect(ids({ networks: [net('Cameras', '10.0.30', { wanAccess: 0 })] })).toEqual(['iot-reach:Cameras']);
  expect(ids({ networks: [net('iot', '192.168.10', { wanAccess: 2 })] })).toEqual([]);
  expect(ids({ networks: [net('iot', '192.168.10', { wanAccess: 0, enabled: false })] })).toEqual([]);
});

test('a guest network without isolation is a warning', () => {
  expect(one({ networks: [net('guest', '192.168.9', { isolate: false })] })).toMatchObject({
    severity: 'warning',
    id: 'guest-isolate:guest',
  });
  expect(ids({ networks: [net('guest', '192.168.9')] })).toEqual([]);
});

test('guest WiFi without isolation offers a fix for networks made here and a link for the router’s own', () => {
  const mine = one({ wifi: [wifi('g1', { ssid: 'Guests', role: 'guest' }), wifi('g2', { ssid: 'Guests', role: 'guest' })] });
  expect(mine.action).toMatchObject({ kind: 'fix', fix: { type: 'wifi', ids: ['g1', 'g2'], patch: { isolate: true } } });
  const theirs = one({ wifi: [wifi('guest5g', { owner: 'firmware', role: 'guest', network: 'guest' })] });
  expect(theirs.action).toMatchObject({ kind: 'open', page: 'wifi' });
  expect(ids({ wifi: [wifi('g', { role: 'guest', isolate: true })] })).toEqual([]);
  expect(ids({ wifi: [wifi('g', { role: 'guest', disabled: true })] })).toEqual([]);
});

test('open WiFi is a problem and WPA2-only is a tip', () => {
  expect(one({ wifi: [wifi('o', { security: 'none', hasKey: false })] })).toMatchObject({ severity: 'problem', id: 'wifi-open:zeeli:o' });
  const old = one({ wifi: [wifi('w', { security: 'psk2' })] });
  expect(old).toMatchObject({ severity: 'tip' });
  expect(old.action).toMatchObject({ kind: 'fix', fix: { patch: { security: 'sae-mixed' } } });
  expect(ids({ wifi: [wifi('w', { security: 'psk2', disabled: true })] })).toEqual([]);
});

test('networks overlapping each other, the upstream, a VPN or Tailscale are found', () => {
  expect(ids({ networks: [net('a', '10.0.1'), net('b', '10.0.1')] })).toEqual(['overlap:a:b']);
  expect(ids({ networks: [net('a', '10.0.1'), net('b', '10.0.2')] })).toEqual([]);
  expect(one({ networks: [net('main', '192.168.8')], wan: cidrOf('192.168.8.5', 24) })).toMatchObject({ severity: 'problem' });
  const vpn = one({ networks: [net('main', '10.0.0')], vpn: [{ label: 'the WireGuard server', cidr: parseCidr('10.0.0.0/24') as never }] });
  expect(vpn).toMatchObject({ severity: 'warning', title: 'main overlaps the WireGuard server' });
  expect(one({ networks: [net('main', '100.100.1')] }).title).toBe('main overlaps Tailscale');
  expect(ids({ networks: [net('a', '10.0.1'), net('b', '10.0.1', { enabled: false })] })).toEqual([]);
});

test('a DHCP pool smaller than the devices is a problem, over 80% full is a warning', () => {
  const n = net('main', '192.168.8', { dhcpStart: '192.168.8.100', dhcpEnd: '192.168.8.109' });
  const on = (count: number) => Array.from({ length: count }, (_, i) => client(`192.168.8.${50 + i}`));
  expect(one({ networks: [n], clients: on(11) })).toMatchObject({ severity: 'problem', id: 'pool:main' });
  expect(one({ networks: [n], clients: on(9) })).toMatchObject({ severity: 'warning', id: 'pool:main' });
  expect(ids({ networks: [n], clients: on(8) })).toEqual([]);
  expect(ids({ networks: [n], clients: [client('192.168.9.5'), ...on(3)] })).toEqual([]);
  // reserved devices don't take from the pool
  expect(ids({ networks: [n], clients: on(11), reservations: on(11).map((c) => reservation(c.ip)) })).not.toContain('pool:main');
  expect(ids({ networks: [{ ...n, dhcp: false }], clients: on(11) })).toEqual([]);
});

test('reservations outside the network are a warning and inside the pool a tip', () => {
  expect(one({ reservations: [reservation('192.168.9.40')] })).toMatchObject({ severity: 'warning', id: 'reserve-outside:main' });
  expect(one({ reservations: [reservation('192.168.8.150')] })).toMatchObject({ severity: 'tip', id: 'reserve-pool:main' });
  expect(ids({ reservations: [reservation('192.168.8.10')] })).toEqual([]);
  expect(one({ reservations: [reservation('1.1.1.1'), reservation('2.2.2.2')] }).title).toBe('2 reserved addresses on main can’t work');
});

test('a network on no WiFi and no port is found, but only when the WiFi list is known', () => {
  const lab = net('Lab', '10.20.0', { ports: [] });
  expect(one({ networks: [lab] })).toMatchObject({ severity: 'warning', id: 'no-carrier:Lab' });
  expect(ids({ networks: [lab], wifi: [wifi('l', { network: 'Lab' })] })).toEqual([]);
  expect(ids({ networks: [net('Lab', '10.20.0', { ports: [{ name: 'LAN4', kind: 'wired', up: false }] })] })).toEqual([]);
  const { findings, skipped } = runCheckup({ ...clean(), networks: [lab], wifi: null });
  expect(findings).toEqual([]);
  expect(skipped).toContain('Networks on no WiFi or port');
});

test('remote access risks are ranked and fixable, and a whitelist quiets them', () => {
  const all = runCheckup({ ...clean(), remote: remote({ enable_ssh: true, enable_https: true, enable_ping: true }) }).findings;
  expect(all.map((f) => f.severity)).toEqual(['problem', 'warning', 'tip']);
  expect(all[0]?.action).toMatchObject({ kind: 'fix', fix: { type: 'remote', key: 'enable_ssh' } });
  expect(ids({ remote: remote({ enable_ssh: true, enable_whitelist: true }) })).toEqual([]);
});

test('AdGuard that is on but not handling every device is a tip', () => {
  expect(one({ adguard: { enabled: true, dns_enabled: false } })).toMatchObject({ severity: 'tip', action: { page: 'adguard' } });
  expect(ids({ adguard: { enabled: true, dns_enabled: true } })).toEqual([]);
  expect(ids({ adguard: { enabled: false, dns_enabled: false } })).toEqual([]);
});

test('a firmware update is a warning that opens the Firmware page', () => {
  expect(one({ firmware: '4.10.2' })).toMatchObject({ severity: 'warning', action: { page: 'firmware' } });
});

test('findings come most serious first, and the summary counts them', () => {
  const { findings } = runCheckup({
    ...clean(),
    firmware: '4.10.2',
    adguard: { enabled: true, dns_enabled: false },
    remote: remote({ enable_ssh: true }),
  });
  expect(findings.map((f) => f.severity)).toEqual(['problem', 'warning', 'tip']);
  expect(summary(findings)).toBe('1 problem, 1 warning, 1 tip');
  expect(summary([...findings, ...findings])).toBe('2 problems, 2 warnings, 2 tips');
});

test('checks without their data are skipped and named, not guessed', () => {
  const { findings, skipped } = runCheckup({ ...clean(), networks: null, wifi: null, remote: null });
  expect(findings).toEqual([]);
  expect(skipped).toEqual(['Network isolation, overlaps and DHCP', 'WiFi security and guest WiFi isolation', 'Remote access']);
  expect(runCheckup({ ...clean(), reservations: null, clients: null }).skipped).toEqual(['Reserved addresses', 'DHCP pool size']);
});
