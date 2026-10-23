import { useQuery } from '@tanstack/react-query';
import { LIVE, useClients, useStatus } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import type { Names } from './sentence.ts';

/** The agent's version, or null on a router that doesn't have it (policies and groups need it). */
export const useAgentVersion = () => useQuery({ queryKey: ['agent'], queryFn: api.agent.version, staleTime: 60_000 });

export const usePolicyList = (enabled = true) =>
  useQuery({ queryKey: ['policies'], queryFn: api.policies.list, enabled, refetchInterval: LIVE.slow });
export const useGroupList = (enabled = true) => useQuery({ queryKey: ['groups'], queryFn: api.policies.groups.list, enabled });
/** What a route policy can go through; only asked of a router that has the agent. */
const useRouteTargets = (enabled = true) =>
  useQuery({ queryKey: ['routeTargets'], queryFn: api.policies.routeTargets, enabled, refetchInterval: LIVE.slow });
const useNetworkList = () => useQuery({ queryKey: ['networks'], queryFn: api.networks.list });

/** The names behind the ids in policies, as sentences read them. */
export function useNames(enabled = true): { names: Names; ready: boolean } {
  const clients = useClients();
  const groups = useGroupList(enabled);
  const networks = useNetworkList();
  const targets = useRouteTargets(enabled);
  const status = useStatus();
  const ready = Boolean(clients.data && groups.data && networks.data && (targets.data || targets.isError));
  const names: Names = {
    clients: clients.data ?? [],
    groups: groups.data ?? [],
    networks: networks.data ?? [],
    targets: targets.data ?? [],
  };
  if (status.data) names.tzoffset = status.data.tzoffset;
  return { names, ready };
}
