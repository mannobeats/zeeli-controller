import { isIpv4, type Network, type NetworkInput, type WanAccess } from '@zeeli/router-api';

export interface NetworkFormValues {
  label: string;
  enabled: boolean;
  ip: string;
  netmask: string;
  vlanId: string;
  wanAccess: WanAccess;
  isolate: boolean;
  dhcp: boolean;
  dhcpStart: string;
  dhcpEnd: string;
  leaseTime: string;
  dns1: string;
  dns2: string;
}

const BLANK: NetworkFormValues = {
  label: '',
  enabled: true,
  ip: '',
  netmask: '255.255.255.0',
  vlanId: '',
  wanAccess: 0,
  isolate: false,
  dhcp: true,
  dhcpStart: '',
  dhcpEnd: '',
  leaseTime: '12h',
  dns1: '',
  dns2: '',
};

/** The form for `n`, or a blank one. Fields the firmware left out fall back to the blank form's. */
export function formValues(n: Network | null): NetworkFormValues {
  if (!n) return { ...BLANK };
  const or = <K extends keyof NetworkFormValues & keyof Network>(k: K) => (n[k] ?? BLANK[k]) as NetworkFormValues[K];
  return {
    label: or('label'),
    enabled: or('enabled'),
    ip: or('ip'),
    netmask: or('netmask'),
    vlanId: n.vlanId?.toString() ?? '',
    wanAccess: or('wanAccess'),
    isolate: or('isolate'),
    dhcp: or('dhcp'),
    dhcpStart: or('dhcpStart'),
    dhcpEnd: or('dhcpEnd'),
    leaseTime: or('leaseTime'),
    dns1: n.dns[0] ?? '',
    dns2: n.dns[1] ?? '',
  };
}

/** Check the form and turn it into what the router stores. The main network has no VLAN. */
export function toNetworkInput(v: NetworkFormValues, network: Network | null): NetworkInput {
  const main = network?.id === 'main';
  if (!isIpv4(v.ip)) throw new Error('Gateway IP isn’t a valid address.');
  if (!isIpv4(v.netmask)) throw new Error('Netmask isn’t a valid address.');
  if (v.dhcp && !(isIpv4(v.dhcpStart) && isIpv4(v.dhcpEnd))) throw new Error('Enter the first and last DHCP address.');
  if (!main && !(Number(v.vlanId) >= 2 && Number(v.vlanId) <= 4094)) throw new Error('VLAN ID must be between 2 and 4094.');
  if (!network?.fixed && !v.label.trim()) throw new Error('Give the network a name.');
  return {
    label: v.label.trim(),
    enabled: v.enabled,
    ip: v.ip,
    netmask: v.netmask,
    vlanId: main ? null : Number(v.vlanId),
    wanAccess: v.wanAccess,
    isolate: v.isolate,
    dhcp: v.dhcp,
    dhcpStart: v.dhcpStart,
    dhcpEnd: v.dhcpEnd,
    leaseTime: v.leaseTime,
    dns: [v.dns1, v.dns2].filter(Boolean),
  };
}
