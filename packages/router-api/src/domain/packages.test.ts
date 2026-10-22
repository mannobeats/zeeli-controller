import { describe, expect, test } from 'vitest';
import { RouterError } from '../errors.ts';
import type { Transport } from '../transport/types.ts';
import { apps } from './apps.ts';
import { compareVersions, openwrt, opkgResult, parseAvailable, parseInstalled } from './openwrt.ts';

// Trimmed from a real /usr/lib/opkg/status: stanzas, continuation lines, blank-line separated.
const STATUS = `Package: libiperf3
Version: 3.10-1
Depends: libc
Status: install hold installed
Architecture: aarch64_cortex-a53_neon-vfpv4
Installed-Time: 1789727886
Auto-Installed: yes

Package: minidlna
Version: 1.3.2-1
Depends: libc, libpthread, libexif
Status: install user installed
Architecture: aarch64_cortex-a53_neon-vfpv4
Conffiles:
 /etc/config/minidlna 5945ac3ce12ff81417a6ed1dfdecbda807feafe510a775844066e6da220c71c9
Installed-Time: 1789727886

Package: vnstat2
Version: 2.11-1
Status: deinstall user config-files
Architecture: aarch64_cortex-a53_neon-vfpv4

Package: banip
Version: 0.9.4-3
Status: install user not-installed
`;

// Trimmed from the feed lists that list-available prints.
const FEED = `Package: banip
Version: 0.9.4-3
Depends: libc, jshn
Section: net
Architecture: all
Installed-Size: 21362
Description:  banIP blocks IPs via named nftables Sets.
 banIP supports many IP blocklist feeds.


Package: iperf3
Version: 3.16-1
Section: net
Installed-Size: 2507
Description:  Iperf is a modern alternative for measuring TCP and UDP bandwidth
 performance.

Package: iperf3
Version: 3.9-1
Section: net
Description:  An older build in another feed.
`;

describe('opkg stanzas', () => {
  test('only packages whose status is installed count', () => {
    expect(parseInstalled(STATUS)).toEqual([
      { name: 'libiperf3', version: '3.10-1', description: '' },
      { name: 'minidlna', version: '1.3.2-1', description: '' },
    ]);
  });

  test('feed descriptions join their lines, and each name keeps its newest version', () => {
    expect(parseAvailable(FEED)).toEqual([
      {
        name: 'banip',
        version: '0.9.4-3',
        description: 'banIP blocks IPs via named nftables Sets. banIP supports many IP blocklist feeds.',
        section: 'net',
        size: 21362,
      },
      {
        name: 'iperf3',
        version: '3.16-1',
        description: 'Iperf is a modern alternative for measuring TCP and UDP bandwidth performance.',
        section: 'net',
        size: 2507,
      },
    ]);
  });

  test('versions compare by number, not by text', () => {
    expect(compareVersions('3.16-1', '3.9-1')).toBeGreaterThan(0);
    expect(compareVersions('1.84.0-1', '1.86.2-1')).toBeLessThan(0);
    expect(compareVersions('2.11-1', '2.11-1')).toBe(0);
    expect(compareVersions('2.11-1a', '2.11-1b')).toBeLessThan(0);
  });
});

describe('opkg results', () => {
  test('code 0 returns its output', () => {
    expect(opkgResult('{"code":0,"stdout":"Installing iperf3 (3.16-1) to root..."}')).toMatch(/^Installing/);
    expect(opkgResult('{"code":0}')).toBe('');
  });

  test('a failing code throws opkg’s last stderr line', () => {
    const out = JSON.stringify({
      code: 255,
      stderr: "Unknown package 'nope'.\nCollected errors:\n * opkg_install_cmd: Cannot install package nope.",
    });
    expect(() => opkgResult(out)).toThrow('opkg_install_cmd: Cannot install package nope.');
    expect(() => opkgResult('{"code":1}')).toThrow('opkg failed with code 1.');
    expect(() => opkgResult('Usage: opkg-call')).toThrow(RouterError);
  });
});

/** A transport that answers ubus calls from a table, for the paths the mock router doesn't take. */
function stub(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: string[] = [];
  const t = {
    async ubus(object: string, method: string, args: Record<string, unknown> = {}) {
      calls.push(`${object}.${method}`);
      const h = answers[`${object}.${method}`];
      if (!h) throw new RouterError('failed', 'Method not found');
      return h(args);
    },
  } as unknown as Transport;
  return { t, calls };
}

describe('package changes are read back', () => {
  test('an install that opkg reports but the status file lacks is an error', async () => {
    const { t } = stub({
      'file.exec': (a) => ({
        code: 0,
        stdout: (a.params as string[])[0] === 'install' ? '{"code":0}' : STATUS,
      }),
    });
    await expect(openwrt(t).packages.install(['iperf3'])).rejects.toThrow('opkg finished, but iperf3 didn’t change.');
  });
});

describe('services with rc allowed', () => {
  test('running comes from rc list and actions go through rc init', async () => {
    let running = false;
    const { t, calls } = stub({
      'session.access': () => ({ access: true }),
      'luci.getInitList': () => ({ minidlna: { enabled: true } }),
      'rc.list': () => ({ minidlna: { running } }),
      'rc.init': (a) => {
        running = a.action !== 'stop';
        return {};
      },
    });
    const a = apps(t, openwrt(t));
    expect(await a.service('minidlna')).toEqual({ enabled: true, running: false });
    expect(await a.serviceAction('minidlna', 'start')).toEqual({ enabled: true, running: true });
    expect(calls).toContain('rc.init');
    expect(calls).not.toContain('luci.setInitAction');
  });

  test('a start the service doesn’t keep is reported', async () => {
    const { t } = stub({
      'session.access': () => ({ access: true }),
      'luci.getInitList': () => ({ minidlna: { enabled: true } }),
      'rc.list': () => ({ minidlna: { running: false } }),
      'rc.init': () => ({}),
    });
    await expect(apps(t, openwrt(t)).serviceAction('minidlna', 'start')).rejects.toThrow('The router didn’t keep minidlna running.');
  });
});

test('wake refuses anything that isn’t a MAC address', async () => {
  const { createRouterApi } = await import('../api.ts');
  const { createMockTransport } = await import('../mock/transport.ts');
  const api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
  await api.session.unlockAdvanced('demo');
  await expect(api.apps.wake('02:5E:E1:00:00:01; reboot')).rejects.toThrow('isn’t a MAC address');
  await expect(api.apps.wake('02:5e:e1:00:00:01')).resolves.toBeUndefined();
});
