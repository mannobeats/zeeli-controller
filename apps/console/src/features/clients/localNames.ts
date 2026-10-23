import { useQuery } from '@tanstack/react-query';
import { type Client, inSubnet, type LocalNames, namesInSync } from '@zeeli/router-api';
import { LIVE, useAgent, useClients } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';

const FORTNIGHT = 14 * 24 * 3600 * 1000;

/**
 * What the agent knows about names, or undefined on a router without it. Reading it also puts
 * it right: if the router's device names aren't the agent's (a rename here or in GL's panel),
 * they're sent across, and AdGuard Home is told where `.lan` lives while names are on.
 * Writes that change a name just invalidate `['names']`.
 */
export const useLocalNames = () => {
  const agent = useAgent();
  return useQuery({
    queryKey: ['names'],
    enabled: Boolean(agent.data),
    staleTime: 60_000,
    queryFn: async (): Promise<LocalNames> => {
      const [known, clients] = await Promise.all([api.names.list(), api.clients.list()]);
      const names = namesInSync(known, clients) ? known : await api.names.sync(clients);
      if (names.enabled) await api.names.forwardToDnsmasq(names.zone).catch(() => null);
      return names;
    },
  });
};

/** Devices that joined in the last two weeks and haven't been named or dismissed. Empty without the agent's history. */
export function useNewDevices(): Client[] {
  const names = useLocalNames().data;
  const clients = useClients().data;
  const joined = useQuery({
    queryKey: ['new-devices'],
    enabled: Boolean(names),
    refetchInterval: LIVE.slow,
    queryFn: () => api.stats.events({ kinds: ['device.new'], since: new Date(Date.now() - FORTNIGHT), limit: 50 }),
  });
  const seen = new Set(joined.data?.map((e) => e.subject));
  const dismissed = new Set(names?.dismissed);
  return (clients ?? []).filter((c) => seen.has(c.mac) && !c.alias && !dismissed.has(c.mac));
}

/** Turn a device's current address into a DHCP reservation, filed under `name`. */
export async function keepIp(client: Client, name: string) {
  const nets = await api.networks.list();
  const net = nets.find((n) => inSubnet(client.ip, n.ip, n.netmask));
  if (!net) throw new Error('This device’s address isn’t in any of your networks.');
  return api.networks.reserve({ mac: client.mac, ip: client.ip, name, network: net.id });
}

/** Run a write and say how it went in a toast. */
export const attempt = (toast: (m: string) => void, w: { mutateAsync: (v: undefined) => Promise<unknown> }, done: string, failed = '') =>
  w.mutateAsync(undefined).then(
    () => toast(done),
    (e) => toast(`${failed}${errorMessage(e)}`),
  );
