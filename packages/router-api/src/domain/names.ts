import type { Transport } from '../transport/types.ts';
import type { Client } from './clients.ts';

/**
 * Local names: every named device answers as `<name>.lan` (`zeeli.names`). The agent keeps the
 * names, writes dnsmasq's address book and remembers which new devices a person has set up.
 */

export interface LocalName {
  mac: string;
  name: string;
  /** The name as a host name, `nas-01`; repeated names get `-2`. Empty when nothing usable is left. */
  host: string;
}

export interface LocalNames {
  enabled: boolean;
  /** The router's local zone, `lan`. */
  zone: string;
  devices: LocalName[];
  /** MACs of devices a person set up or dismissed. */
  dismissed: string[];
}

/** The address a named device answers on, or '' when it has no usable name or local names are off. */
export const localName = (names: LocalNames | undefined, mac: string): string => {
  const host = names?.enabled ? names.devices.find((d) => d.mac === mac.toUpperCase())?.host : '';
  return host ? `${host}.${names?.zone ?? 'lan'}` : '';
};

/** What the agent needs of each named device: its name and where it is now. */
export const namedDevices = (list: Client[]) => list.filter((c) => c.alias).map((c) => ({ mac: c.mac, name: c.alias, ip: c.ip }));

export const namesInSync = (names: LocalNames, list: Client[]) => {
  const named = list.filter((c) => c.alias);
  return named.length === names.devices.length && named.every((c) => names.devices.some((d) => d.mac === c.mac && d.name === c.alias));
};

/** The rule that sends `.lan` lookups from AdGuard Home to dnsmasq, which holds the names. */
export const forwardRule = (zone: string) => `[/${zone}/]127.0.0.1:53`;

export const names = (t: Transport) => {
  const list = () => t.zeeli<LocalNames>('names', 'list');
  /**
   * AdGuard Home answers every device's DNS when it is on, and has never heard of `.lan`;
   * one upstream rule sends those lookups to dnsmasq. Does nothing when AdGuard is off or has it.
   */
  const forwardToDnsmasq = async (zone: string) => {
    const rule = forwardRule(zone);
    const info = await t.adguard<{ upstream_dns?: string[] }>('dns_info').catch(() => null);
    if (!info?.upstream_dns || info.upstream_dns.includes(rule)) return;
    await t.adguard('dns_config', { method: 'POST', body: { upstream_dns: [rule, ...info.upstream_dns] } });
  };
  return {
    list,
    /** Hand the agent every named device, with the address each has now. */
    sync: (clients: Client[]) => t.zeeli<LocalNames>('names', 'sync', { devices: namedDevices(clients) }),
    setEnabled: (enabled: boolean) => t.zeeli<LocalNames>('names', 'set_enabled', { enabled }),
    /** Mark devices as set up. `false` makes them new again. */
    dismiss: (macs: string[], dismissed = true) => t.zeeli<LocalNames>('names', 'dismiss', { macs, dismissed }),
    forwardToDnsmasq,
  };
};
