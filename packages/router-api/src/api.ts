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
import { policies } from './domain/policies.ts';
import { security } from './domain/security.ts';
import { system } from './domain/system.ts';
import { traffic } from './domain/traffic.ts';
import { vpn } from './domain/vpn.ts';
import { wifi } from './domain/wifi.ts';
import type { Transport } from './transport/types.ts';

/** Everything the interface can ask a router, grouped by area. */
export function createRouterApi(transport: Transport) {
  const ow = openwrt(transport);
  const agentApi = agent(transport);
  const policyApi = policies(transport);
  const systemApi = system(transport);
  return {
    transport,
    session: transport.session,
    system: systemApi,
    device: device(transport),
    clients: clients(transport),
    networks: networks(transport),
    internet: internet(transport),
    wifi: wifi(transport),
    networkExtras: networkExtras(transport),
    openwrt: ow,
    security: security(transport),
    dns: dns(transport),
    vpn: vpn(transport),
    family: family(transport, ow, policyApi, systemApi, async () => (await agentApi.version()) !== null),
    traffic: traffic(transport),
    apps: apps(transport, ow),
    activity: activity(transport),
    agent: agentApi,
    policies: policyApi,
  };
}

export type RouterApi = ReturnType<typeof createRouterApi>;
