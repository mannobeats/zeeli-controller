import { type Client, inSubnet, type Network, type OwnWifi } from '@zeeli/router-api';
import { bandLink } from '../../lib/devices.ts';

/**
 * Online WiFi clients on a network made here. The firmware's client list says which band a device
 * is on but not which SSID, so this matches the band and the network’s subnet: a device on the
 * Kids network’s addresses, on a band the Kids WiFi uses. Two WiFi networks sharing a band and a
 * network are counted together.
 */
export function clientsOn(n: OwnWifi, clients: Client[], networks: Network[]): number {
  const net = networks.find((x) => x.id === n.network);
  if (!net) return 0;
  // the client list calls a device on a multi-link network "mlo", not by one of its bands
  const bands = n.mlo ? ['mlo'] : n.bands.map(bandLink);
  return clients.filter(
    (c) => c.online && c.link.medium === 'wifi' && bands.includes(c.link.band ?? undefined) && inSubnet(c.ip, net.ip, net.netmask),
  ).length;
}
