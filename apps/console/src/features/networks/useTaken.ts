import { useQuery } from '@tanstack/react-query';
import type { Network } from '@zeeli/router-api';
import { api } from '../../api/router.ts';
import { TAILSCALE, type Taken, takenFrom, takenFromMask } from './suggest.ts';

const orNull = <T>(p: Promise<T>) => p.catch(() => null);

interface TakenFacts {
  /** What the router's other networks can't share: WAN, VPN servers, Tailscale. */
  taken: Taken[];
  /** VLAN ID -> who uses it, from the networks and from ports. */
  vlans: Map<number, string>;
}

/** Reads everything outside the networks list that a new subnet or VLAN has to stay clear of. Each read may fail. */
async function readTaken(networks: Network[]): Promise<TakenFacts> {
  const [addresses, wan, repeater, wg, ovpn, ports] = await Promise.all([
    orNull(api.device.addresses()),
    orNull(api.internet.wan.get()),
    orNull(api.internet.repeater()),
    orNull(api.vpn.wireguard.config()),
    orNull(api.vpn.openvpn.config()),
    orNull(api.internet.ports()),
  ]);
  const found = [
    ...(addresses?.wan_ip ?? []).map((ip) => takenFrom('the internet connection', ip)),
    takenFromMask('the internet connection', wan?.ipv4?.ip, wan?.ipv4?.netmask),
    takenFrom('the Wi-Fi repeater uplink', repeater?.ip),
    takenFrom('the WireGuard server', wg?.address_v4),
    takenFromMask('the OpenVPN server', ovpn?.subnetv4, ovpn?.mask),
  ];
  const vlans = new Map<number, string>();
  for (const p of ports ?? []) for (const v of [p.untagged, ...p.tagged]) if (v && v > 1) vlans.set(v, `port ${p.label}`);
  for (const n of networks) if (n.vlanId) vlans.set(n.vlanId, n.label);
  return { taken: [...found.filter((t): t is Taken => t !== null), TAILSCALE], vlans };
}

export function useTaken(networks: Network[]) {
  return useQuery({ queryKey: ['network-taken', networks.map((n) => `${n.id}${n.vlanId}`).join()], queryFn: () => readTaken(networks) });
}
