import type { Transport } from '../transport/types.ts';

export const SECURITY: Record<string, string> = {
  none: 'Open',
  psk2: 'WPA2',
  'psk-mixed': 'WPA/WPA2',
  sae: 'WPA3',
  'sae-mixed': 'WPA2/WPA3',
};

export type WifiRole = 'main' | 'guest' | 'iot';

export interface Radio {
  device: string;
  band: string;
  channel: number | 'auto';
  channels: number[];
  htmode: string;
  htmodes: string[];
  hwmode: string;
  txpower: string;
}

export interface WifiNetwork {
  /** The firmware's interface name, the key for edits. */
  name: string;
  kind: 'band' | 'mlo';
  role: WifiRole;
  ssid: string;
  key: string;
  encryption: string;
  encryptions: string[];
  enabled: boolean;
  hidden: boolean;
  initialized: boolean;
  randomBssid: boolean;
  /** For a band network, its band; for MLO, the bands it joins. */
  bands: string[];
  radio: Radio | null;
}

interface RawIface {
  name: string;
  ssid: string;
  key?: string;
  encryption: string;
  enabled?: boolean;
  mlo_enable?: boolean;
  mlo_band?: string[];
  hidden: boolean;
  guest: boolean;
  iot?: boolean;
  init: boolean;
  random_bssid?: boolean;
}
interface RawRadio {
  device: string;
  band: string;
  channel: number | 'auto';
  channels?: number[];
  htmode: string;
  htmodes?: Record<string, unknown>;
  hwmode: string;
  txpower: string;
  encryptions?: string[];
  ifaces: RawIface[];
}

export interface WifiInput {
  ssid: string;
  key: string;
  encryption: string;
  hidden: boolean;
  channel?: number | 'auto';
  htmode?: string;
  txpower?: string;
}

const role = (i: RawIface): WifiRole => (i.guest ? 'guest' : i.iot ? 'iot' : 'main');

export const wifi = (t: Transport) => ({
  async list(): Promise<WifiNetwork[]> {
    const [cfg, mlo] = await Promise.all([
      t.call<{ res?: RawRadio[] }>('wifi', 'get_config'),
      t.call<{ res?: { ifaces?: RawIface[]; encryptions?: string[] } }>('wifi', 'get_mlo_config').catch(() => null),
    ]);
    const out: WifiNetwork[] = [];
    for (const i of mlo?.res?.ifaces ?? [])
      out.push({
        name: i.name,
        kind: 'mlo',
        role: role(i),
        ssid: i.ssid,
        key: i.key ?? '',
        encryption: i.encryption,
        encryptions: mlo?.res?.encryptions ?? Object.keys(SECURITY),
        enabled: Boolean(i.mlo_enable),
        hidden: i.hidden,
        initialized: i.init,
        randomBssid: Boolean(i.random_bssid),
        bands: i.mlo_band ?? [],
        radio: null,
      });
    // networks made through the Zeeli agent (`zeeli_*`) have their own list
    for (const r of cfg.res ?? [])
      for (const i of r.ifaces.filter((x) => !x.name.startsWith('zeeli_')))
        out.push({
          name: i.name,
          kind: 'band',
          role: role(i),
          ssid: i.ssid,
          key: i.key ?? '',
          encryption: i.encryption,
          encryptions: r.encryptions ?? Object.keys(SECURITY),
          enabled: Boolean(i.enabled),
          hidden: i.hidden,
          initialized: i.init,
          randomBssid: Boolean(i.random_bssid),
          bands: [r.band],
          radio: {
            device: r.device,
            band: r.band,
            channel: r.channel,
            channels: r.channels ?? [],
            htmode: r.htmode,
            htmodes: Object.keys(r.htmodes ?? {}),
            hwmode: r.hwmode,
            txpower: r.txpower,
          },
        });
    return out;
  },

  setEnabled: (n: WifiNetwork, enabled: boolean) =>
    n.kind === 'mlo'
      ? t.call('wifi', 'set_mlo_config', { init: n.initialized, name: n.name, mlo_enable: enabled }, 60_000)
      : t.call('wifi', 'set_config', { init: n.initialized, iface_name: n.name, enabled }, 60_000),

  save(n: WifiNetwork, input: WifiInput) {
    const base = {
      init: true,
      ssid: input.ssid,
      encryption: input.encryption,
      key: input.key,
      hidden: input.hidden,
      random_bssid: n.randomBssid,
    };
    if (n.kind === 'mlo')
      return t.call('wifi', 'set_mlo_config', { ...base, name: n.name, mlo_enable: n.enabled, mlo_band: n.bands }, 60_000);
    // radio settings only travel with the main network on each band
    const radio =
      n.role === 'main' && n.radio
        ? {
            device: n.radio.device,
            hwmode: n.radio.hwmode,
            txpower: input.txpower ?? n.radio.txpower,
            htmode: input.htmode ?? n.radio.htmode,
            channel: input.channel ?? n.radio.channel,
          }
        : {};
    return t.call('wifi', 'set_config', { ...base, ...radio, iface_name: n.name }, 60_000);
  },
});
