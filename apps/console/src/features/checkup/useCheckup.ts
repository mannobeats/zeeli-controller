import { useQuery } from '@tanstack/react-query';
import { cidrOf, parseCidr } from '@zeeli/router-api';
import { api } from '../../api/router.ts';
import { type CheckupData, runCheckup } from './checks.ts';

/** A read that failed counts as “couldn’t say”, so that check is skipped rather than guessed. */
const maybe = async <T>(read: Promise<T>): Promise<T | null> => {
  try {
    return await read;
  } catch {
    return null;
  }
};

async function load(): Promise<CheckupData> {
  const [networks, reservations, clients, wifi, wan, wg, ovpn, remote, adguard, firmware] = await Promise.all([
    maybe(api.networks.list()),
    maybe(api.networks.reservations()),
    maybe(api.clients.list()),
    maybe(api.wifiNetworks.overview().then((o) => o.networks)),
    maybe(api.internet.wan.get()),
    maybe(api.vpn.wireguard.config()),
    maybe(api.vpn.openvpn.config()),
    maybe(api.security.wanAccess.get()),
    maybe(api.dns.adguard.get()),
    maybe(api.device.firmware()),
  ]);
  const wanIp = wan?.protocol === 'static' ? wan.ipv4 : undefined;
  return {
    networks,
    reservations,
    clients,
    wifi,
    wan: wanIp?.ip && wanIp.netmask ? cidrOf(wanIp.ip, wanIp.netmask) : null,
    vpn: [
      ...(wg?.initialization && wg.address_v4 ? [{ label: 'the WireGuard server', cidr: parseCidr(wg.address_v4) }] : []),
      ...(ovpn?.initialization && ovpn.subnetv4 ? [{ label: 'the OpenVPN server', cidr: cidrOf(ovpn.subnetv4, ovpn.mask) }] : []),
    ].flatMap((v) => (v.cidr ? [{ label: v.label, cidr: v.cidr }] : [])),
    remote,
    adguard,
    firmware: firmware?.available || null,
  };
}

/** The checkup, run against the router. Shared by the page and the dashboard hint. */
export const useCheckup = () => useQuery({ queryKey: ['checkup'], queryFn: async () => runCheckup(await load()), staleTime: 60_000 });
