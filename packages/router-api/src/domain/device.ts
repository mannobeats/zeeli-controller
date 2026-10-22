import { settings } from '../settings.ts';
import type { Transport } from '../transport/types.ts';
import { writeAndVerify } from '../verify.ts';

export interface Timezone {
  zonename: string;
  timezone: string;
}

export interface Addresses {
  domain?: string[];
  pub_ip?: string[];
  wan_ip?: string[];
}

export type LogKind = 'system' | 'kernel' | 'crash' | 'nginx';

export interface FirmwareCheck {
  current: string;
  currentType: string;
  built: string;
  available: string | null;
  notes: string;
}

/** upgrade.check_firmware_local status codes, from the stock panel. */
export const FIRMWARE_CHECK: Record<number, { text: string; blocks: boolean }> = {
  1: { text: 'This is older than the installed firmware.', blocks: false },
  2: { text: 'Keeping settings isn’t advised with this file.', blocks: false },
  3: { text: 'The router can’t tell this file’s version.', blocks: false },
  4: { text: 'The file is too large for this router.', blocks: true },
  5: { text: 'This isn’t a firmware file.', blocks: true },
  6: { text: 'The router’s install test failed for this file.', blocks: true },
  7: { text: 'This firmware isn’t supported on this router.', blocks: true },
  8: { text: 'This firmware is for a different router.', blocks: true },
  9: { text: 'This isn’t GL.iNet firmware. GL features won’t be there after installing.', blocks: false },
  10: { text: 'The check failed for an unknown reason.', blocks: true },
  11: { text: 'This firmware is too old for this router.', blocks: false },
};

export interface WifiTimer {
  func: string;
  band: string;
  guest: number;
  enable: boolean;
  week: number[];
  turnoff_hour: string;
  turnoff_min: string;
  turnon_hour: string;
  turnon_min: string;
}

export const device = (t: Transport) => ({
  load: () =>
    t.call<{ memory_total: number; memory_free: number; memory_buff_cache: number; load_average: number[] }>('system', 'get_load'),
  fan: settings<{ temperature: number; warn_temperature?: number }>(t, 'fan'),
  led: settings<{ led_enable: boolean }>(t, 'led'),
  usb: settings<{ protocol: string }>(t, 'system', { get: 'get_usb_config', set: 'set_usb_config' }),
  usbChoices: () => t.call<{ value: string; label: string }[]>('system', 'get_usb_info').catch(() => []),

  timezone: settings<{ zonename: string; timezone: string; autotimezone_enabled: boolean; localtime?: number; tzoffset?: string }>(
    t,
    'system',
    { get: 'get_timezone_config', set: 'set_timezone_config' },
  ),
  timezones: async () => (await t.call<{ timezone_list?: Timezone[] }>('system', 'get_timezone_list')).timezone_list ?? [],

  changePassword: (oldPassword: string, newPassword: string) =>
    t.call('system', 'set_password', { username: 'root', old_password: oldPassword, new_password: newPassword }),

  log: async (kind: LogKind) => (await t.call<{ log?: string }>('logread', `get_${kind}_log`, {}, 30_000)).log ?? '',

  ddns: settings<{ enable_ddns: boolean; device_id?: string }>(t, 'ddns'),
  addresses: () => t.call<Addresses>('network', 'get_available_address_list').catch((): Addresses => ({})),
  bark: settings<{ enable: boolean; ipv6_enable: boolean }>(t, 'bark'),
  barkStatus: () =>
    t.call<{ pairing_code?: string; status?: number }>('bark', 'get_status').catch((): { pairing_code?: string; status?: number } => ({})),
  luciInstalled: async () => (await t.call<{ status?: number }>('luci', 'get_status').catch(() => ({ status: 0 }))).status === 2,
  installLuci: () => t.call('luci', 'install_luci', {}, 180_000),
  reset: () => t.call('system', 'reset_firmware'),

  /* firmware */
  async firmware(): Promise<FirmwareCheck> {
    const r = await t
      .call<{ current_version: string; current_type: string; current_compile_time: string; version_new?: string; release_note?: string }>(
        'upgrade',
        'check_firmware_online',
        {},
        30_000,
      )
      .catch(() => null);
    return {
      current: r?.current_version ?? '',
      currentType: r?.current_type ?? '',
      built: r?.current_compile_time ?? '',
      available: r?.version_new || null,
      notes: r?.release_note ?? '',
    };
  },
  firmwareChecks: settings<{ upgrade_enable: boolean; prompt: boolean }>(t, 'upgrade'),
  installOnline: () => t.call('upgrade', 'upgrade_online', { keep_config: true, keep_package: true }, 60_000),
  async checkFile(file: File) {
    await t.upload('/tmp/firmware.img', file, file.name);
    return t.call<{ version?: string; firmware_type?: string; sha256?: string; status: number }>(
      'upgrade',
      'check_firmware_local',
      {},
      180_000,
    );
  },
  installFile: (keep: boolean) => t.call('upgrade', 'upgrade_local', { keep_config: keep, keep_package: keep }, 60_000),

  /* schedules */
  reboot: settings<{ enable: boolean; hour?: string; min?: string; week?: number[] }>(t, 'timer', {
    get: 'get_reboot',
    set: 'set_reboot',
  }),
  ledTimer: settings<{
    enable: boolean;
    week: number[];
    turnoff_hour?: string;
    turnoff_min?: string;
    turnon_hour?: string;
    turnon_min?: string;
  }>(t, 'timer', { get: 'get_led', set: 'set_led' }),
  wifiTimers: async () =>
    ((await t.call<{ wifi?: WifiTimer[] }>('timer', 'get_wifi').catch(() => ({}) as { wifi?: WifiTimer[] })).wifi ?? []).filter(
      (w) => w.func === 'turn_onoff',
    ),
  /** The stock panel sends a band's main and guest entries together; guest passes through unchanged. */
  setWifiTimer: (all: WifiTimer[], next: WifiTimer) =>
    writeAndVerify(
      () =>
        t.call('timer', 'set_wifi', {
          wifi: all.filter((w) => w.band === next.band).map((w) => (w.guest ? w : next)),
        }),
      () => t.call<{ wifi?: WifiTimer[] }>('timer', 'get_wifi'),
      (r) => r.wifi?.find((w) => w.func === 'turn_onoff' && w.band === next.band && !w.guest)?.enable === next.enable,
      'the WiFi schedule',
    ),
});
