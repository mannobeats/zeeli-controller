import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRouterApi, type RouterApi } from '../api.ts';
import { RouterError } from '../errors.ts';
import { createMockTransport } from '../mock/transport.ts';
import { APP_CATALOG } from './apps.ts';
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
    expect(s.services).toContainEqual({ name: 'adguard', running: true });
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
    expect([app('iperf3').installed, app('vnstat2').installed]).toEqual([true, false]);
    expect(app('iperf3').versions).toEqual({ iperf3: '3.16-1' });
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

  test('packages parse from opkg, and installs are read back', async () => {
    const installed = await settle(api.openwrt.packages.installed());
    expect(one(installed, (p) => p.name === 'tailscale').version).toBe('1.84.0-1');
    const available = await settle(api.openwrt.packages.available());
    expect(one(available, (p) => p.name === 'iperf3').description).toMatch(/^Iperf is a modern alternative/);
    await settle(api.openwrt.packages.install(['vnstat2']));
    expect((await settle(api.openwrt.packages.installed())).map((p) => p.name)).toContain('vnstat2');
    await expect(settle(api.openwrt.packages.install(['nope']))).rejects.toThrow('opkg_install_cmd: Cannot install package nope.');
    await settle(api.openwrt.packages.upgrade(one(available, (p) => p.name === 'tailscale')));
    expect(one(await settle(api.openwrt.packages.installed()), (p) => p.name === 'tailscale').version).toBe('1.86.2-1');
    await settle(api.openwrt.packages.remove(['vnstat2']));
    expect((await settle(api.openwrt.packages.installed())).map((p) => p.name)).not.toContain('vnstat2');
  });

  test('app services go through LuCI when rc is not allowed', async () => {
    expect(await settle(api.apps.service('minidlna'))).toEqual({ enabled: true, running: null });
    expect(await settle(api.apps.service('vnstat'))).toBeNull();
    expect(await settle(api.apps.serviceAction('samba4', 'enable'))).toEqual({ enabled: true, running: null });
    await expect(settle(api.apps.serviceAction('vnstat', 'start'))).rejects.toThrow('The router couldn’t start vnstat.');
  });

  test('app settings are read from UCI, written and read back', async () => {
    const dlna = one(APP_CATALOG, (a) => a.id === 'minidlna');
    const before = await settle(api.apps.config(dlna));
    expect(before.values).toEqual({
      'minidlna.config.enabled': false,
      'minidlna.config.friendly_name': 'Zeeli DLNA Server',
      'minidlna.config.media_dir': ['/tmp/mountd/disk1_part1'],
    });
    const after = await settle(
      api.apps.saveConfig(dlna, { 'minidlna.config.enabled': true, 'minidlna.config.media_dir': ['/mnt/a', '/mnt/b'] }),
    );
    expect(after.values).toMatchObject({ 'minidlna.config.enabled': true, 'minidlna.config.media_dir': ['/mnt/a', '/mnt/b'] });
    const samba = await settle(api.apps.config(one(APP_CATALOG, (a) => a.id === 'samba')));
    expect(samba).toMatchObject({ values: { 'nas.conf.samba_enable': false, 'samba4.samba.workgroup': 'WORKGROUP' }, records: [] });
    expect(await settle(api.apps.drives())).toEqual([]);
  });

  test('without the agent, parental pauses come back as firewall rules', async () => {
    const old = createRouterApi(
      Object.assign(Object.create(createMockTransport({ latencyMs: 0 })), {
        zeeli: () => Promise.reject(new RouterError('failed', 'The Zeeli agent has no system.version.')),
      }),
    );
    await settle(old.session.login('demo'));
    await old.session.unlockAdvanced('demo');
    const [leo] = (await settle(old.family.config())).profiles;
    if (!leo) throw new Error('no profile');
    const now = new Date(Date.UTC(2026, 9, 22, 18));
    await settle(old.family.pause(leo, now, null));
    await settle(old.family.pause(leo, now, new Date(Date.UTC(2026, 9, 22, 19))));
    const pauses = await settle(old.family.pauses());
    expect(pauses.map((p) => p.until)).toEqual([null, new Date(Date.UTC(2026, 9, 22, 19))]);
    expect(pauses.some((p) => p.agent)).toBe(false);
    await settle(old.family.resume(pauses));
    expect(await settle(old.family.pauses())).toEqual([]);
  });

  test('with the agent, a pause is a policy that needs no unlock', async () => {
    const locked = createRouterApi(createMockTransport({ latencyMs: 0 }));
    await settle(locked.session.login('demo'));
    const [leo] = (await settle(locked.family.config())).profiles;
    if (!leo) throw new Error('no profile');
    const now = new Date(Date.UTC(2026, 9, 22, 18));
    await settle(locked.family.pause(leo, now, new Date(Date.UTC(2026, 9, 22, 18, 30))));
    const [timed] = await settle(locked.family.pauses());
    expect(timed).toMatchObject({ profileId: leo.id, agent: true });
    expect(timed?.until).toBeInstanceOf(Date);
    // pausing again restarts the one pause rather than adding another
    await settle(locked.family.pause(leo, now, null, timed));
    const [forever, ...rest] = await settle(locked.family.pauses());
    expect(rest).toEqual([]);
    expect(forever).toMatchObject({ profileId: leo.id, until: null, agent: true });
    await settle(locked.family.resume([forever as NonNullable<typeof forever>]));
    expect(await settle(locked.family.pauses())).toEqual([]);
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
