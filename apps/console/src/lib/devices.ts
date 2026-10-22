import {
  type Icon,
  IconBulb,
  IconCamera,
  IconDatabase,
  IconDeviceDesktop,
  IconDeviceGamepad2,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDeviceSpeaker,
  IconDeviceTablet,
  IconDeviceTv,
  IconDeviceWatch,
  IconNetwork,
  IconPlugConnected,
  IconPrinter,
  IconRouter,
  IconServer,
  IconWifi,
} from '@tabler/icons-react';
import type { Client, DeviceClass } from '@zeeli/router-api';

const CLASS_ICON: Record<string, Icon> = {
  computer: IconDeviceDesktop,
  laptop: IconDeviceLaptop,
  phone: IconDeviceMobile,
  pad: IconDeviceTablet,
  watch: IconDeviceWatch,
  television: IconDeviceTv,
  sound: IconDeviceSpeaker,
  camera: IconCamera,
  printer: IconPrinter,
  games: IconDeviceGamepad2,
  smartappliances: IconBulb,
  nas: IconDatabase,
  server: IconServer,
  switch: IconNetwork,
  gateway: IconRouter,
};

export const DEVICE_CLASS_LABELS: [DeviceClass, string][] = [
  ['', 'Not set'],
  ['computer', 'Computer'],
  ['laptop', 'Laptop'],
  ['phone', 'Phone'],
  ['pad', 'Tablet'],
  ['watch', 'Watch'],
  ['television', 'TV'],
  ['sound', 'Speaker'],
  ['camera', 'Camera'],
  ['printer', 'Printer'],
  ['games', 'Game console'],
  ['smartappliances', 'Smart home'],
  ['nas', 'NAS'],
  ['server', 'Server'],
  ['switch', 'Switch'],
  ['gateway', 'Gateway'],
];

export const iconFor = (c: Pick<Client, 'deviceClass' | 'link'>): Icon =>
  CLASS_ICON[c.deviceClass] ?? (c.link.medium === 'wired' ? IconPlugConnected : IconWifi);

/** Colour category for how a client connects: wired, 2.4, 5, 6 GHz or MLO. */
export type Category = 'wired' | '24' | '5' | '6' | 'mlo';
export const CATEGORIES: [Category, string][] = [
  ['wired', 'Wired'],
  ['24', '2.4 GHz WiFi'],
  ['5', '5 GHz WiFi'],
  ['6', '6 GHz WiFi'],
  ['mlo', 'MLO WiFi'],
];
export const categoryOf = (c: Pick<Client, 'link'>): Category =>
  c.link.medium === 'wired' ? 'wired' : c.link.band === '2.4' ? '24' : ((c.link.band ?? 'wired') as Category);

// The firmware names a radio "2G", "5G", "6G" or "MLD" (the demo writes them lowercase).
const RADIO: Record<string, { category: Category; link: string }> = {
  '2G': { category: '24', link: '2.4' },
  '5G': { category: '5', link: '5' },
  '6G': { category: '6', link: '6' },
  MLD: { category: 'mlo', link: 'mlo' },
};
/** Colour category for a radio band, the same one its clients get. */
export const bandCategory = (band: string): Category => RADIO[band.toUpperCase()]?.category ?? 'wired';
/** The `link.band` a client on this radio reports, so radios and clients can be matched. */
export const bandLink = (band: string): string | undefined => RADIO[band.toUpperCase()]?.link;
