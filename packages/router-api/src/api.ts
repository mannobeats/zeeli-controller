import { activity } from './domain/activity.ts';
import { agent } from './domain/agent.ts';
import { apps } from './domain/apps.ts';
import { clients } from './domain/clients.ts';
import { device } from './domain/device.ts';
import { dns } from './domain/dns.ts';
import { family } from './domain/family.ts';
import { internet } from './domain/internet.ts';
import { networkExtras } from './domain/network-extras.ts';
import { networks } from './domain/networks.ts';
import { openwrt } from './domain/openwrt.ts';
import { safety } from './domain/safety.ts';
import { security } from './domain/security.ts';
import { stats } from './domain/stats.ts';
import { system } from './domain/system.ts';
import { traffic } from './domain/traffic.ts';
import { vpn } from './domain/vpn.ts';
import { wifi } from './domain/wifi.ts';
import { wifiNetworks } from './domain/wifi-networks.ts';
import type { Transport } from './transport/types.ts';

/** Everything the interface can ask a router, grouped by area. */
export function createRouterApi(transport: Transport) {
  const ow = openwrt(transport);
  return {
    transport,
    session: transport.session,
    system: system(transport),
    device: device(transport),
    clients: clients(transport),
    networks: networks(transport),
    internet: internet(transport),
    wifi: wifi(transport),
    wifiNetworks: wifiNetworks(transport),
    networkExtras: networkExtras(transport),
    openwrt: ow,
    security: security(transport),
    dns: dns(transport),
    vpn: vpn(transport),
    family: family(transport, ow),
    traffic: traffic(transport),
    apps: apps(transport, ow),
    activity: activity(transport),
    agent: agent(transport),
    safety: safety(transport),
    stats: stats(transport),
  };
}

export type RouterApi = ReturnType<typeof createRouterApi>;
