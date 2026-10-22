import type { NewTunnel, Tunnel, TunnelFrom, TunnelTo } from '@zeeli/router-api';

/** The first "Tunnel n" no existing tunnel uses. */
export function nextTunnelName(existing: Tunnel[]) {
  const names = new Set(existing.map((t) => t.name));
  let n = 1;
  while (names.has(`Tunnel ${n}`)) n++;
  return `Tunnel ${n}`;
}

export const byDevice = (from: TunnelFrom) => from === 'mac' || from === 'exclude_mac';

/** Who a tunnel covers, in the firmware's shape. Throws when the choice needs picks and has none. */
export function tunnelFrom(from: TunnelFrom, macs: string[], nets: string[]): Tunnel['from'] {
  if (byDevice(from)) {
    if (!macs.length) throw new Error('Pick at least one device.');
    return { type: from, [from === 'mac' ? 'mac_list' : 'exclude_mac_list']: macs };
  }
  if (from !== 'interface') return { type: from };
  if (!nets.length) throw new Error('Pick at least one network.');
  return { type: from, interface_list: nets };
}

/** Which sites a tunnel covers; `domains` is whitespace-separated. */
export function tunnelTo(to: TunnelTo, domains: string): NewTunnel['to'] {
  if (to === 'default') return { type: to };
  const list = domains
    .split(/\s+/)
    .map((d) => d.trim())
    .filter(Boolean);
  if (!list.length) throw new Error('Enter at least one site.');
  return { type: to, manual: true, domain_list: list.join('\n') };
}
