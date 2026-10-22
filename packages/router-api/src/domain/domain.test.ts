import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRouterApi, type RouterApi } from '../api.ts';
import { createMockTransport } from '../mock/transport.ts';
import { bedtimeAt, type Profile } from './family.ts';

let api: RouterApi;
beforeEach(async () => {
  api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
  await api.session.unlockAdvanced('demo');
});

/** The one item matching `ok`; fails the test when there is none. */
function one<T>(list: T[], ok: (x: T) => boolean): T {
  const hit = list.find(ok);
  if (hit === undefined) throw new Error('no match');
  return hit;
}

describe('system and device', () => {
  test('status reads services, clients and feature flags', async () => {
    const s = await api.system.status();
    expect(s.services).toContainEqual({ name: 'adguardhome', running: true });
    expect(s.clients.wired + s.clients.wireless).toBeGreaterThan(0);
    expect(s.flags).toMatchObject({ ipv6: true, sqm: false });
    expect(s.tzoffset).toBe('-0400');
  });

  test('firmware check reports the offered version', async () => {
    const f = await api.device.firmware();
    expect(f.current).not.toBe('');
    expect(typeof f.notes).toBe('string');
  });

  test('traffic usage and DPI versions', async () => {
    const u = await api.traffic.usage();
    expect(u.apps.map((a) => a.total)).toEqual([...u.apps.map((a) => a.total)].sort((a, b) => b - a));
    const dpi = await api.traffic.dpi();
    expect(dpi).toMatchObject({ engine: '2.4.1', engineUpdate: null, signaturesUpdate: '2026.10.20' });
  });

  test('apps know what is installed and running', async () => {
    const list = await api.apps.list();
    const app = (pkg: string) => one(list, (a) => String(a.packages) === pkg);
    expect([app('samba4-server').installed, app('minidlna').installed]).toEqual([true, false]);
    expect(list.some((a) => a.running === true)).toBe(true);
  });
});

describe('DNS', () => {
  test('AdGuard stats become totals and top lists', async () => {
    const s = await api.dns.adguardStats();
    expect(s).not.toBeNull();
    expect(s).toMatchObject({ bucket: expect.stringMatching(/^(hour|day)$/) });
    expect(Array.isArray(s?.topQueried)).toBe(true);
  });

  test('query log marks filtered answers as blocked', async () => {
    const log = await api.dns.queryLog(10);
    expect(one(log, (q) => q.domain === 'github.com').blocked).toBe(false);
    expect(log.every((q) => q.blocked === q.reason.startsWith('Filtered'))).toBe(true);
  });
});

describe('internet', () => {
  test('repeater status while not connected', async () => {
    expect(await api.internet.repeater()).toMatchObject({ connected: false, ssid: '', dns: [], randomMac: false });
  });

  test('joining a network shows its address', async () => {
    await api.internet.join({ ssid: 'Cafe Corner' });
    expect(await api.internet.repeater()).toMatchObject({ connected: true, ip: '192.168.1.57', randomMac: true, mac: '02:5E:E1:00:00:0A' });
  });

  test('scan results are open-aware and strongest first', async () => {
    const list = await api.internet.scan();
    expect(list.map((n) => n.ssid)).toEqual(['Cafe Corner', 'Neighbour-5G', 'Library Free WiFi']);
    expect(list.map((n) => n.open)).toEqual([true, false, true]);
  });

  test('ports join config and live status', async () => {
    const ports = await api.internet.ports();
    expect(ports.length).toBeGreaterThan(0);
    expect(ports.some((p) => p.canBeWan)).toBe(true);
  });
});

describe('wifi', () => {
  test('lists MLO and per-band networks', async () => {
    const list = await api.wifi.list();
    expect(list.some((n) => n.kind === 'mlo')).toBe(true);
    expect(one(list, (n) => n.kind === 'band').radio).not.toBeNull();
  });

  test('saving the main network carries radio settings', async () => {
    const main = one(await api.wifi.list(), (n) => n.kind === 'band' && n.role === 'main');
    await api.wifi.save(main, { ssid: 'Renamed', key: 'a-long-passphrase', encryption: 'psk2', hidden: false, txpower: 'low' });
    expect(one(await api.wifi.list(), (n) => n.name === main.name).ssid).toBe('Renamed');
  });

  test('saving an MLO network', async () => {
    const mlo = one(await api.wifi.list(), (n) => n.kind === 'mlo');
    await expect(api.wifi.save(mlo, { ssid: 'X', key: 'a-long-passphrase', encryption: 'sae', hidden: true })).resolves.toBeDefined();
  });
});

describe('networks', () => {
  test('main keeps its key; custom networks are added, renamed and removed', async () => {
    const [main] = await api.networks.list();
    if (!main) throw new Error('no networks');
    const input = { ...main, label: 'Lab', vlanId: 30 };
    await api.networks.save(input, main);
    await api.networks.save(input);
    const lab = one(await api.networks.list(), (n) => n.id === 'Lab');
    await api.networks.save({ ...input, label: 'Lab 2' }, lab);
    expect((await api.networks.list()).map((n) => n.id)).toContain('Lab 2');
    await api.networks.remove('Lab 2');
    expect((await api.networks.list()).map((n) => n.id)).not.toContain('Lab 2');
  });

  test('fixed non-main networks also send their VLAN settings', async () => {
    const guest = one(await api.networks.list(), (n) => n.fixed && n.id !== 'main');
    await api.networks.save({ ...guest, isolate: true });
    await api.networks.save({ ...guest, isolate: true }, guest);
    expect(one(await api.networks.list(), (n) => n.id === guest.id).isolate).toBe(true);
  });
});

describe('vpn', () => {
  const file = (name: string) => new File(['[Interface]'], name);

  test('profile choices list WireGuard peers', async () => {
    expect(await api.vpn.profileChoices()).toEqual([{ value: 'wireguard|7|1', label: 'Home VPN · Amsterdam (WireGuard)' }]);
  });

  test('importing into a new WireGuard group creates it', async () => {
    await api.vpn.importProfile('wireguard', { newName: 'Work' }, file('work.conf'));
    expect((await api.vpn.groups()).map((g) => g.name)).toContain('Work');
  });

  test('importing OpenVPN with credentials into an existing group', async () => {
    await api.vpn.importProfile('openvpn', { newName: 'Office' }, file('office.ovpn'));
    const office = one(await api.vpn.groups(), (g) => g.name === 'Office');
    await api.vpn.importProfile('openvpn', { id: office.id }, file('../evil~.ovpn'), { username: 'me', password: 'pw' });
    expect(office.kind).toBe('openvpn');
  });
});

describe('OpenWrt', () => {
  // applying waits for the router's rollback window; skip the real waiting
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const settle = async <T>(p: Promise<T>) => (await Promise.all([p, vi.runAllTimersAsync()]))[0];

  test('firewall rules read with their origin', async () => {
    const fw = await settle(api.openwrt.firewall());
    expect(fw.zones.map((z) => z.name)).toContain('wan');
    expect(fw.rules.every((r) => ['service', 'default', 'custom'].includes(r.origin))).toBe(true);
  });

  test('a custom rule is added, edited and its blank options cleared', async () => {
    const input = {
      name: 'Block printer',
      src: 'lan',
      dest: 'wan',
      proto: 'tcp',
      destPort: '9100',
      srcIp: '192.168.8.60',
      destIp: '',
      target: 'REJECT' as const,
      family: 'ipv4' as const,
      enabled: true,
    };
    await settle(api.openwrt.saveRule(input));
    const rule = one((await settle(api.openwrt.firewall())).rules, (r) => r.name === 'Block printer');
    expect(rule).toMatchObject({ origin: 'custom', destPort: '9100', proto: 'tcp' });
    await settle(api.openwrt.saveRule({ ...input, destPort: '', enabled: false }, rule));
    const after = one((await settle(api.openwrt.firewall())).rules, (r) => r.id === rule.id);
    expect(after).toMatchObject({ destPort: '', enabled: false });
    await settle(api.openwrt.removeRules([after]));
    expect((await settle(api.openwrt.firewall())).rules.map((r) => r.id)).not.toContain(rule.id);
  });

  test('a failed staging step reverts and rethrows', async () => {
    const boom = api.openwrt.uci.change('firewall', () => Promise.reject(new Error('nope')));
    await expect(settle(boom)).rejects.toThrow('nope');
  });

  test('unsetting options on a missing section is a no-op', async () => {
    await settle(api.openwrt.uci.unset('firewall', 'missing', ['dest']));
    await settle(api.openwrt.uci.remove('nope', 'missing'));
    expect((await settle(api.openwrt.firewall())).zones).toHaveLength(3);
  });

  test('packages parse from opkg', async () => {
    const installed = await settle(api.openwrt.packages.installed());
    expect(one(installed, (p) => p.name === 'tailscale').version).toBe('1.84.0-1');
    expect(one(await settle(api.openwrt.packages.available()), (p) => p.name === 'iperf3').description).toBe('Throughput testing');
    await expect(settle(api.openwrt.packages.install('iperf3'))).resolves.toBe('');
  });

  test('parental pauses come back as firewall rules', async () => {
    const [leo] = (await settle(api.family.config())).profiles;
    if (!leo) throw new Error('no profile');
    const now = new Date(Date.UTC(2026, 9, 22, 18));
    await settle(api.family.pause(leo, now, null));
    await settle(api.family.pause(leo, now, new Date(Date.UTC(2026, 9, 22, 19))));
    const pauses = await settle(api.family.pauses());
    expect(pauses.map((p) => p.until)).toEqual([null, new Date(Date.UTC(2026, 9, 22, 19))]);
    await settle(api.family.resume(pauses));
    expect(await settle(api.family.pauses())).toEqual([]);
  });
});

describe('access rules', () => {
  test('ACL rules normalise ports and addresses', async () => {
    const [rule] = await api.security.accessRules();
    expect(rule).toMatchObject({ id: '1', destPort: '', srcIps: [], destIps: ['192.168.8.10'] });
  });
});

describe('bedtime', () => {
  const profile = (begin: string, end: string, week = 0): Profile => ({
    id: '1',
    name: 'Leo',
    enabled: true,
    macs: [],
    bedtimeOn: true,
    bedtimeDays: 'everyday',
    bedtimes: [{ week, enabled: true, begin, end }],
    categories: [],
    apps: [],
    sites: [],
  });
  // 2026-10-22 is a Thursday (weekday 4)
  const at = (hh: number, mm = 0, day = 22) => new Date(Date.UTC(2026, 9, day, hh, mm));

  test('a same-day window', () => {
    expect(bedtimeAt(profile('13:00', '15:30'), at(14))).toEqual({ until: 930 });
    expect(bedtimeAt(profile('13:00', '15:30'), at(16))).toBeNull();
  });

  test('a window across midnight, before and after it', () => {
    expect(bedtimeAt(profile('20:30', '07:00'), at(21))).toEqual({ until: 1860 });
    expect(bedtimeAt(profile('20:30', '07:00'), at(6))).toEqual({ until: 420 });
  });

  test('Monday mornings look back at Sunday night', () => {
    expect(bedtimeAt(profile('22:00', '06:00', 7), at(5, 0, 26))).toEqual({ until: 360 });
    expect(bedtimeAt({ ...profile('22:00', '06:00'), bedtimeOn: false }, at(23))).toBeNull();
  });
});
