import { RouterError } from '../errors.ts';
import type { Transport } from '../transport/types.ts';
import { writeAndVerify } from '../verify.ts';
import type { openwrt as openwrtFactory, Package, UciSection } from './openwrt.ts';

/**
 * One UCI option an app's page can edit. `key` is `config.section.option`, where the
 * section is a section name or, failing that, the first section of that type.
 */
export interface AppField {
  key: string;
  label: string;
  kind: 'switch' | 'text' | 'list';
  hint?: string;
}

/**
 * The app catalog. Built-in apps ship with the firmware and are switched on or off in
 * their own page; package apps install from the OpenWrt repository and get a generic
 * page built from the fields below. Adding an app is one entry here.
 */
export interface AppDefinition {
  id: string;
  name: string;
  summary: string;
  category: 'Privacy and security' | 'Remote access' | 'Network tools' | 'Home and media' | 'Monitoring';
  /** Console page with the app's settings, if any. */
  page?: string;
  /** Present in the firmware; `service` is its name in system status. */
  builtIn?: { service?: string };
  /** opkg packages that make up the app. */
  packages?: string[];
  /** Its init script in /etc/init.d, when it runs as a service. */
  service?: string;
  /** Settings shown on its page. */
  fields?: AppField[];
  /** UCI sections listed on its page, like file shares: `config.type`, with option columns. */
  records?: { key: string; title: string; columns: [option: string, label: string][]; empty: string };
  /** It works on files from a USB drive. */
  needsDrive?: boolean;
  /** Short steps for using it; `{router}` becomes the router's LAN address. */
  usage?: string[];
  /** What the page can't show yet, and why. */
  comingNext?: string;
  /** A one-off command the page offers as a button, like starting a test server. */
  run?: { title: string; label: string; command: string; params: string[]; done: string };
  /** The page offers to wake a sleeping device by its MAC address. */
  wake?: boolean;
}

/**
 * Commands beyond the stock LuCI permissions. They work once the Zeeli permission file
 * (tools/router/zeeli-controller.acl.json, installed by `pnpm deploy:router`) is on the router;
 * pages ask first and explain when it isn't.
 */
export const WAKE_COMMAND = ['/usr/bin/etherwake', '-i', 'br-lan'] as const;
const MAC_ADDRESS = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i;

export const APP_CATALOG: AppDefinition[] = [
  {
    id: 'adguard',
    name: 'AdGuard Home',
    summary: 'Blocks ads, trackers and malware for every device, with per-query statistics.',
    category: 'Privacy and security',
    page: 'adguard',
    builtIn: { service: 'adguard' },
  },
  {
    id: 'tailscale',
    name: 'Tailscale',
    summary: 'Reach your home network from anywhere over WireGuard, without opening ports.',
    category: 'Remote access',
    page: 'tailscale',
    builtIn: { service: 'tailscale' },
  },
  {
    id: 'zerotier',
    name: 'ZeroTier',
    summary: 'Join this router to a ZeroTier virtual network.',
    category: 'Remote access',
    page: 'zerotier',
    builtIn: { service: 'zerotier' },
  },
  {
    id: 'tor',
    name: 'Tor',
    summary: 'Send traffic through the Tor network for anonymity. Much slower.',
    category: 'Privacy and security',
    page: 'tor',
    builtIn: {},
  },
  {
    id: 'ddns',
    name: 'Dynamic DNS',
    summary: 'A stable name for your home connection, even when its address changes.',
    category: 'Remote access',
    page: 'ddns',
    builtIn: {},
  },
  {
    id: 'bark',
    name: 'Bark',
    summary: 'Bark’s parental monitoring service, linked to your Bark account.',
    category: 'Privacy and security',
    page: 'bark',
    builtIn: {},
  },
  {
    id: 'dpi',
    name: 'App detection',
    summary: 'Recognises apps in traffic, for per-app statistics, QoS and blocking.',
    category: 'Monitoring',
    page: 'dpi',
    builtIn: {},
  },
  {
    id: 'samba',
    name: 'File sharing (SMB)',
    summary: 'Share a USB drive with computers on your network.',
    category: 'Home and media',
    packages: ['samba4-server'],
    service: 'samba4',
    needsDrive: true,
    fields: [
      {
        key: 'nas.conf.samba_enable',
        label: 'Sharing on',
        kind: 'switch',
        hint: 'GL.iNet firmware only starts file sharing while this is on.',
      },
      { key: 'samba4.samba.name', label: 'Name on the network', kind: 'text' },
      { key: 'samba4.samba.workgroup', label: 'Workgroup', kind: 'text', hint: 'Windows uses WORKGROUP unless you changed it.' },
      { key: 'samba4.samba.description', label: 'Description', kind: 'text' },
    ],
    records: {
      key: 'samba4.sambashare',
      title: 'Shares',
      columns: [
        ['name', 'Name'],
        ['path', 'Folder'],
        ['read_only', 'Read only'],
        ['guest_ok', 'Guests'],
      ],
      empty: 'No shared folders yet. A share needs a folder on a USB drive.',
    },
    usage: [
      'On Windows, open File Explorer and type \\\\{router} in the address bar.',
      'On a Mac, choose Go > Connect to Server in the Finder and enter smb://{router}.',
      'Shares appear once a USB drive is plugged in and a folder on it is shared.',
    ],
  },
  {
    id: 'minidlna',
    name: 'Media server (DLNA)',
    summary: 'Stream music and video from a USB drive to TVs and speakers.',
    category: 'Home and media',
    packages: ['minidlna'],
    service: 'minidlna',
    needsDrive: true,
    fields: [
      { key: 'minidlna.config.enabled', label: 'Media server on', kind: 'switch' },
      { key: 'minidlna.config.friendly_name', label: 'Name TVs show', kind: 'text' },
      {
        key: 'minidlna.config.media_dir',
        label: 'Media folders',
        kind: 'list',
        hint: 'Folders on the USB drive, comma separated, like /tmp/mountd/disk1_part1/Videos.',
      },
    ],
    usage: [
      'Turn the media server on and point it at folders on a USB drive.',
      'TVs, consoles and speakers on your network find it under the name above, usually in their Media or Sources menu.',
      'New files show up after the server rescans, or after a restart.',
    ],
  },
  {
    id: 'vnstat',
    name: 'Traffic history',
    summary: 'Keeps internet usage by hour, day and month, across reboots.',
    category: 'Monitoring',
    packages: ['vnstat2'],
    service: 'vnstat',
    fields: [
      {
        key: 'vnstat.vnstat.interface',
        label: 'Interfaces to count',
        kind: 'list',
        hint: 'Comma separated, like eth0 for the internet port. Empty counts what vnStat picks.',
      },
    ],
    usage: ['vnStat counts traffic from the start, so history builds up over days.', 'Keep it on and enabled at boot.'],
    comingNext:
      'Charts of the history. Reading it needs `vnstat --json`, which the router’s LuCI permissions don’t allow the console to run.',
  },
  {
    id: 'nlbwmon',
    name: 'Per-device usage',
    summary: 'Records how much each device downloads and uploads over time.',
    category: 'Monitoring',
    packages: ['nlbwmon'],
    service: 'nlbwmon',
    fields: [
      {
        key: 'nlbwmon.nlbwmon.database_directory',
        label: 'Keep data in',
        kind: 'text',
        hint: '/var/lib/nlbwmon lives in memory and is lost at reboot; a folder on a USB drive keeps it.',
      },
      { key: 'nlbwmon.nlbwmon.commit_interval', label: 'Save every', kind: 'text', hint: 'Like 24h or 1h.' },
    ],
    usage: ['nlbwmon counts per device from when it starts.', 'Keep it on and enabled at boot.'],
    comingNext:
      'The per-device table. Reading it needs `nlbw -c json`, which the router’s LuCI permissions don’t allow the console to run.',
  },
  {
    id: 'iperf3',
    name: 'Speed test server',
    summary: 'Measure real throughput between any device and the router.',
    category: 'Network tools',
    packages: ['iperf3'],
    run: {
      title: 'Test server',
      label: 'Start a test server',
      command: '/usr/bin/iperf3',
      params: ['-s', '-1', '-D'],
      done: 'Test server ready on port 5201 for one test',
    },
    usage: [
      'Start a test server here. It answers one test, then stops by itself.',
      'On a computer on your network, run `iperf3 -c {router}` to measure upload from that computer, or `iperf3 -c {router} -R` for download.',
      'The test uses port 5201. Phones can use any iperf3 app pointed at {router}.',
    ],
  },
  {
    id: 'wol',
    name: 'Wake on LAN',
    summary: 'Wake sleeping computers on your network.',
    category: 'Network tools',
    packages: ['etherwake'],
    wake: true,
    usage: [
      'The computer has to have Wake on LAN switched on in its firmware and network settings, and be wired to the router or its network.',
      'Pick it below and press Wake. It starts up within a few seconds if Wake on LAN is set up on it.',
    ],
  },
  {
    id: 'banip',
    name: 'IP blocklists',
    summary: 'Drops traffic to and from known-bad addresses using community lists.',
    category: 'Privacy and security',
    packages: ['banip'],
    service: 'banip',
    fields: [{ key: 'banip.global.ban_enabled', label: 'Blocking on', kind: 'switch' }],
    usage: [
      'Turn blocking on, then start the service. banIP downloads its lists and loads them into the firewall.',
      'If a site you need stops working, turn blocking off to check whether a list caused it.',
    ],
    comingNext:
      'Which lists are loaded and what they blocked. That needs `/etc/init.d/banip report json`, which the router’s LuCI permissions don’t allow.',
  },
];

export interface AppState extends AppDefinition {
  installed: boolean;
  running: boolean | null;
  /** Installed version of each of its packages. */
  versions: Record<string, string>;
}

/** An init script's state. `running` is null when the router doesn't let the console see it. */
export interface AppService {
  enabled: boolean;
  running: boolean | null;
}
export type ServiceAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable';

export type FieldValue = boolean | string | string[];
export interface AppConfig {
  /** Only fields whose UCI section exists on this router. */
  values: Record<string, FieldValue>;
  records: Record<string, string>[];
}

export interface Drive {
  mount: string;
  size: number;
  free: number;
}

const text = (v: unknown) => (Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v));
const ON = new Set(['1', 'true', 'on', 'yes', 'enabled']);

function readField(kind: AppField['kind'], raw: unknown): FieldValue {
  if (kind === 'switch') return ON.has(text(raw));
  if (kind === 'list') return Array.isArray(raw) ? raw.map(String) : raw == null || raw === '' ? [] : [String(raw)];
  return text(raw);
}
const splitKey = (key: string) => {
  const [config = '', section = '', option = ''] = key.split('.');
  return { config, section, option };
};
const findSection = (all: UciSection[], section: string) =>
  all.find((x) => x['.name'] === section) ?? all.find((x) => x['.type'] === section);

export const apps = (t: Transport, ow: ReturnType<typeof openwrtFactory>) => {
  /** `rc` isn't in the stock LuCI ACLs; asking first avoids an Access denied, which reads as signed out. */
  const rcAllowed = (fn: 'list' | 'init') =>
    t
      .ubus<{ access?: boolean }>('session', 'access', { scope: 'ubus', object: 'rc', function: fn })
      .then((r) => Boolean(r.access))
      .catch(() => false);

  async function service(name: string): Promise<AppService | null> {
    const init = await t.ubus<Record<string, { enabled?: boolean }>>('luci', 'getInitList', { name });
    const found = init[name];
    if (!found) return null;
    let running: boolean | null = null;
    if (await rcAllowed('list')) {
      const rc = await t.ubus<Record<string, { running?: boolean }>>('rc', 'list', { name });
      running = rc[name]?.running ?? null;
    }
    return { enabled: Boolean(found.enabled), running };
  }

  /** Set one option; an empty value removes it, so the service falls back to its default. */
  async function writeOption(c: string, sec: UciSection, option: string, v: FieldValue | undefined) {
    if (v === undefined) return;
    if (v !== '' && !(Array.isArray(v) && !v.length))
      return ow.uci.set(c, sec['.name'], { [option]: typeof v === 'boolean' ? (v ? '1' : '0') : v });
    if (sec[option] !== undefined) await ow.uci.unset(c, sec['.name'], [option]);
  }

  async function config(app: AppDefinition): Promise<AppConfig> {
    const configs = [...new Set([...(app.fields ?? []), ...(app.records ? [app.records] : [])].map((f) => splitKey(f.key).config))];
    const loaded = new Map(await Promise.all(configs.map(async (c) => [c, await ow.uci.sections(c).catch(() => [])] as const)));
    const values: Record<string, FieldValue> = {};
    for (const f of app.fields ?? []) {
      const { config: c, section, option } = splitKey(f.key);
      const sec = findSection(loaded.get(c) ?? [], section);
      if (sec) values[f.key] = readField(f.kind, sec[option]);
    }
    const r = app.records && splitKey(app.records.key);
    const records = r
      ? (loaded.get(r.config) ?? [])
          .filter((x) => x['.type'] === r.section)
          .map((x) => Object.fromEntries(app.records?.columns.map(([o]) => [o, text(x[o])]) ?? []))
      : [];
    return { values, records };
  }

  return {
    /** Every catalog app with whether it is present and, for services, running. */
    async list(): Promise<AppState[]> {
      const [status, installed] = await Promise.all([
        t.call<{ service?: { name: string; status: number }[] }>('system', 'get_status'),
        ow.packages.installed().catch(() => [] as Package[]),
      ]);
      const versions = new Map(installed.map((p) => [p.name, p.version]));
      const svc = (n?: string) => (n ? (status.service ?? []).find((s) => s.name === n) : undefined);
      return APP_CATALOG.map((a) => {
        const s = svc(a.builtIn?.service);
        const mine = (a.packages ?? []).filter((p) => versions.has(p));
        return {
          ...a,
          installed: a.builtIn ? true : mine.length === (a.packages ?? []).length,
          running: s ? s.status === 1 : null,
          versions: Object.fromEntries(mine.map((p) => [p, versions.get(p) ?? ''])),
        };
      });
    },
    /** Whether the router lets this session run a command (the Zeeli permission file grants a few). */
    canRun: (command: readonly string[]) =>
      t
        .ubus<{ access?: boolean }>('session', 'access', { scope: 'file', object: command.join(' '), function: 'exec' })
        .then((r) => Boolean(r.access))
        .catch(() => false),
    /** Run an app's one-off command; fails with the command's own error output. */
    async run(app: AppDefinition) {
      if (!app.run) return;
      const r = await t.ubus<{ code?: number; stderr?: string }>('file', 'exec', { command: app.run.command, params: app.run.params });
      if (r.code) throw new RouterError('failed', (r.stderr ?? '').trim().split('\n').pop() || `${app.name} didn’t start.`);
    },
    /** Send a Wake on LAN packet to a device on the main network. */
    async wake(mac: string) {
      if (!MAC_ADDRESS.test(mac)) throw new RouterError('failed', `${mac} isn’t a MAC address.`);
      const [command, ...params] = WAKE_COMMAND;
      const r = await t.ubus<{ code?: number; stderr?: string }>('file', 'exec', { command, params: [...params, mac.toUpperCase()] });
      if (r.code) throw new RouterError('failed', (r.stderr ?? '').trim() || 'The wake packet wasn’t sent.');
    },
    install: (a: AppDefinition) => ow.packages.install(a.packages ?? []),
    remove: (a: AppDefinition) => ow.packages.remove([...(a.packages ?? [])].reverse()),

    service,
    /** Start, stop or restart a service, or set whether it starts at boot, and read it back. */
    async serviceAction(name: string, action: ServiceAction): Promise<AppService | null> {
      const write = async () => {
        if (await rcAllowed('init')) return t.ubus('rc', 'init', { name, action });
        const r = await t.ubus<{ result?: boolean; error?: string }>('luci', 'setInitAction', { name, action });
        if (r.error || r.result === false) throw new RouterError('failed', `The router couldn’t ${action} ${name}.`, r);
      };
      const want: Partial<Record<ServiceAction, Partial<AppService>>> = {
        enable: { enabled: true },
        disable: { enabled: false },
        start: { running: true },
        restart: { running: true },
        stop: { running: false },
      };
      return writeAndVerify(
        write,
        () => service(name),
        (now) =>
          now !== null &&
          Object.entries(want[action] ?? {}).every(([k, v]) => {
            const got = now[k as keyof AppService];
            // without rc the running state can't be read, so only the init script's answer counts
            return got === null || got === v;
          }),
        `${name} ${{ enable: 'starting at boot', disable: 'off at boot', start: 'running', restart: 'running', stop: 'stopped' }[action]}`,
      );
    },

    config,
    /** Write changed fields, one apply per UCI config, then read them all back. */
    async saveConfig(app: AppDefinition, values: Record<string, FieldValue>): Promise<AppConfig> {
      const fields = (app.fields ?? []).filter((f) => f.key in values);
      const before = await config(app);
      for (const c of new Set(fields.map((f) => splitKey(f.key).config))) {
        const all = await ow.uci.sections(c);
        await ow.uci.change(c, async () => {
          for (const f of fields.filter((x) => splitKey(x.key).config === c)) {
            const { section, option } = splitKey(f.key);
            const sec = findSection(all, section);
            if (sec) await writeOption(c, sec, option, values[f.key]);
          }
        });
      }
      const after = await config(app);
      const lost = fields.find((f) => f.key in before.values && JSON.stringify(after.values[f.key]) !== JSON.stringify(values[f.key]));
      if (lost) throw new RouterError('notKept', `The router didn’t keep ${lost.label.toLowerCase()}.`, after);
      return after;
    },

    /** USB drives and other storage the router mounted for sharing. */
    async drives(): Promise<Drive[]> {
      const r = await t.ubus<{ result?: { mount: string; size: number; avail: number }[] }>('luci', 'getMountPoints');
      return (r.result ?? [])
        .filter((m) => /^\/(mnt|tmp\/mountd)\//.test(m.mount))
        .map((m) => ({ mount: m.mount, size: m.size, free: m.avail }));
    },
  };
};
