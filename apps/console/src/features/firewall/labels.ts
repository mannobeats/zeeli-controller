import type { FirewallRule, FirewallTarget } from '@zeeli/router-api';

/** Names and wording the firewall page and its agent version share. */

const ZONE_LABEL: Record<string, string> = { lan: 'Main LAN', wan: 'Internet', guest: 'Guest', iot: 'IoT', tailscale0: 'Tailscale' };
export const zoneLabel = (z: string) => (z === '*' ? 'Any zone' : (ZONE_LABEL[z] ?? z));

export const TARGETS: [FirewallTarget, string][] = [
  ['ACCEPT', 'Allow'],
  ['REJECT', 'Reject'],
  ['DROP', 'Drop'],
];
export const ORIGIN = { service: 'Router service', default: 'OpenWrt default', custom: 'Custom' } as const;

export function describe(r: Pick<FirewallRule, 'proto' | 'destPort' | 'srcIp' | 'destIp' | 'family'>) {
  const parts: string[] = [];
  if (r.proto !== 'tcp udp') parts.push(r.proto === 'all' ? 'any protocol' : r.proto.toUpperCase());
  if (r.destPort) parts.push(`port ${r.destPort}`);
  if (r.srcIp) parts.push(`from ${r.srcIp}`);
  if (r.destIp) parts.push(`to ${r.destIp}`);
  if (r.family) parts.push(r.family === 'ipv4' ? 'IPv4' : 'IPv6');
  return parts.join(', ') || 'All traffic';
}
