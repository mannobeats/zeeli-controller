// Demo answers for packages and app services, in the formats the real router uses:
// opkg-call prints /usr/lib/opkg/status and the feed lists as control stanzas, and
// install/remove/update print `{code, stdout, stderr}` JSON. Invented values only.
import type { MockState } from './seed.ts';

type Args = Record<string, unknown>;
type Handler = (state: MockState, args: Args) => unknown;

interface Pkg {
  name: string;
  version: string;
  description: string;
}

const FEED: Pkg[] = [
  { name: 'adguardhome', version: '0.107.55-1', description: 'Network-wide ads and trackers blocking DNS server.' },
  { name: 'banip', version: '0.9.4-3', description: 'banIP blocks IPs via named nftables Sets.' },
  { name: 'etherwake', version: '1.09-5', description: 'You can wake up WOL compliant Computers.' },
  { name: 'iperf3', version: '3.16-1', description: 'Iperf is a modern alternative for measuring TCP and UDP bandwidth.' },
  { name: 'libiperf3', version: '3.16-1', description: 'Iperf3 library.' },
  { name: 'minidlna', version: '1.3.2-1', description: 'MiniDLNA serves media files to DLNA clients.' },
  { name: 'nlbwmon', version: '2021-09-01-d82c910c-1', description: 'OpenWrt Traffic Usage Monitor' },
  { name: 'samba4-server', version: '4.18.8-1', description: 'The Samba software suite: the SMB file server.' },
  { name: 'tailscale', version: '1.86.2-1', description: 'Zero config VPN. It creates a secure network between your servers.' },
  { name: 'vnstat2', version: '2.11-1', description: 'vnStat is a network traffic monitor that keeps a log of network traffic.' },
  { name: 'wireguard-tools', version: '1.0.20210914-3', description: 'WireGuard userspace control program (wg).' },
  // filler, so the demo list is long enough to search and page through
  ...Array.from({ length: 140 }, (_, i) => ({
    name: `kmod-demo-${String(i + 1).padStart(3, '0')}`,
    version: '6.6.86-1',
    description: `Demo kernel module ${i + 1}.`,
  })),
];

const SERVICE_OF: Record<string, string> = {
  'samba4-server': 'samba4',
  minidlna: 'minidlna',
  vnstat2: 'vnstat',
  nlbwmon: 'nlbwmon',
  banip: 'banip',
};

const keep = <T>(s: MockState, key: string, init: () => T): T => {
  if (!s.extra.has(key)) s.extra.set(key, init());
  return s.extra.get(key) as T;
};
const installed = (s: MockState) =>
  keep<Pkg[]>(s, 'packages', () =>
    ['adguardhome', 'iperf3', 'libiperf3', 'minidlna', 'samba4-server', 'wireguard-tools']
      .map((n) => FEED.find((p) => p.name === n) as Pkg)
      .concat({ name: 'tailscale', version: '1.84.0-1', description: '' }),
  );
const services = (s: MockState) =>
  keep<Record<string, { enabled: boolean }>>(s, 'services', () => ({ samba4: { enabled: false }, minidlna: { enabled: true } }));

/** A description wrapped onto continuation lines, as the feeds have it. */
const wrapped = (text: string) => ` ${text.replace(/(.{1,60})(\s|$)/g, '$1\n ').trimEnd()}`;

const statusFile = (s: MockState) =>
  installed(s)
    .map((p) =>
      [
        `Package: ${p.name}`,
        `Version: ${p.version}`,
        'Depends: libc',
        `Status: install ${p.name.startsWith('lib') ? 'hold' : 'user'} installed`,
        'Architecture: aarch64_cortex-a53_neon-vfpv4',
        'Installed-Time: 1789727886',
        '',
      ].join('\n'),
    )
    .join('\n');

const feedLists = () =>
  FEED.map((p) =>
    [
      `Package: ${p.name}`,
      `Version: ${p.version}`,
      'Depends: libc',
      `Section: ${p.name.startsWith('kmod-') ? 'kernel' : 'net'}`,
      'Architecture: aarch64_cortex-a53_neon-vfpv4',
      `Installed-Size: ${2000 + p.name.length * 731}`,
      `Filename: ${p.name}_${p.version}_aarch64_cortex-a53_neon-vfpv4.ipk`,
      `Description: ${wrapped(p.description)}`,
      '',
    ].join('\n'),
  ).join('\n');

const result = (code: number, stdout: string, stderr = '') =>
  JSON.stringify({ code, ...(stdout ? { stdout } : {}), ...(stderr ? { stderr } : {}) });

function install(s: MockState, names: string[]) {
  const unknown = names.find((n) => !FEED.some((p) => p.name === n));
  if (unknown)
    return result(255, '', `Unknown package '${unknown}'.\nCollected errors:\n * opkg_install_cmd: Cannot install package ${unknown}.`);
  for (const n of names) {
    const pkg = FEED.find((p) => p.name === n) as Pkg;
    s.extra.set('packages', [...installed(s).filter((p) => p.name !== n), pkg]);
    const svc = SERVICE_OF[n];
    if (svc && !services(s)[svc]) services(s)[svc] = { enabled: true };
  }
  return result(0, names.map((n) => `Installing ${n} to root...`).join('\n'));
}

function remove(s: MockState, names: string[]) {
  s.extra.set(
    'packages',
    installed(s).filter((p) => !names.includes(p.name)),
  );
  return result(0, names.map((n) => `Removing package ${n} from root...`).join('\n'));
}

/** `/usr/libexec/opkg-call <action> …`, answered the way the router's script does. */
export function opkgCall(s: MockState, [action, ...names]: string[]) {
  if (action === 'list-installed') return statusFile(s);
  if (action === 'list-available') return feedLists();
  if (action === 'install') return install(s, names);
  if (action === 'remove') return remove(s, names);
  return result(0, 'Updated list of available packages.');
}

/** Init scripts that exist: those whose package is installed. */
const initScripts = (s: MockState) => new Set(installed(s).flatMap((p) => (SERVICE_OF[p.name] ? [SERVICE_OF[p.name] as string] : [])));

export const appsHandlers: Record<string, Handler> = {
  'ubus:luci.getInitList': (s, a) => {
    const name = String(a.name);
    if (!initScripts(s).has(name)) return { error: 'No such init script' };
    return { [name]: { index: 80, stop: null, enabled: services(s)[name]?.enabled ?? false } };
  },
  'ubus:luci.setInitAction': (s, a) => {
    const name = String(a.name);
    if (!initScripts(s).has(name)) return { error: 'No such init script' };
    const svc = services(s);
    if (a.action === 'enable' || a.action === 'disable') svc[name] = { enabled: a.action === 'enable' };
    return { result: true };
  },
  // no USB drive, like the router this was checked on
  'ubus:luci.getMountPoints': () => ({
    result: [
      { device: '/dev/root', mount: '/rom', size: 95420416, avail: 0, free: 0 },
      { device: 'tmpfs', mount: '/tmp', size: 452075520, avail: 439808000, free: 439808000 },
      { device: 'overlayfs:/overlay', mount: '/', size: 7204675584, avail: 6785085440, free: 7172911104 },
    ],
  }),
};

/** UCI configs of the package apps, as the router has them after install. */
export const appConfigs = () => ({
  samba4: {
    cfg01: {
      '.name': 'cfg01',
      '.type': 'samba',
      '.anonymous': true,
      '.index': 0,
      workgroup: 'WORKGROUP',
      charset: 'UTF-8',
      description: 'Zeeli demo router',
      name: 'Zeeli-Demo',
    },
  },
  nas: { conf: { '.name': 'conf', '.type': 'service', '.anonymous': false, '.index': 0, samba_is_init: '1' } },
  minidlna: {
    config: {
      '.name': 'config',
      '.type': 'minidlna',
      '.anonymous': false,
      '.index': 0,
      enabled: '0',
      port: '8200',
      interface: 'br-lan',
      friendly_name: 'Zeeli DLNA Server',
      media_dir: '/tmp/mountd/disk1_part1',
    },
  },
  vnstat: { cfg01: { '.name': 'cfg01', '.type': 'vnstat', '.anonymous': true, '.index': 0 } },
  nlbwmon: {
    cfg01: {
      '.name': 'cfg01',
      '.type': 'nlbwmon',
      '.anonymous': true,
      '.index': 0,
      database_directory: '/var/lib/nlbwmon',
      commit_interval: '24h',
      refresh_interval: '30s',
    },
  },
  banip: { global: { '.name': 'global', '.type': 'banip', '.anonymous': false, '.index': 0, ban_enabled: '0' } },
});
