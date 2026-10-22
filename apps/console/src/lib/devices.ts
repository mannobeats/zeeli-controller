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
