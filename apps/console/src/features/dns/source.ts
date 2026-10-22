import type { DnsConfig, DnsMode, DnsProvider } from '@zeeli/router-api';

export interface SecureChoice {
  provider: string;
  proto: string;
  server: string;
  nextdns: string;
}

/** The settings the firmware wants for a DNS source, built the way its own panel builds them. */
export function sourceSettings(dns: DnsConfig, mode: DnsMode, c: SecureChoice, info: DnsProvider | undefined): Partial<DnsConfig> {
  const body: Partial<DnsConfig> = { ...dns, mode };
  if (mode === 'manual' && !dns.manual_list.length) body.manual_list = ['1.1.1.1', '1.0.0.1'];
  if (mode !== 'secure') return body;
  const protocols = info?.protocols ?? ['dot'];
  const server = c.server || info?.servers[0]?.name || '';
  body.provider = c.provider;
  body.proto = protocols.includes(c.proto) ? c.proto : (protocols[0] ?? 'dot');
  if (c.provider === 'nextdns') {
    if (!/^[0-9a-f]{6}$/i.test(c.nextdns.trim())) throw new Error('Enter the six-character ID from your NextDNS dashboard.');
    body.nextdns_id = c.nextdns.trim();
  } else if (c.provider === 'controld') Object.assign(body, { controld_type: 1, servers_list: [server] });
  else body.servers_list = [server];
  return body;
}
