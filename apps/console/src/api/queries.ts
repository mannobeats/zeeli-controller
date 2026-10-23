import { type QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './router.ts';

/** How often live data refreshes, in milliseconds. */
export const LIVE = { fast: 3000, normal: 6000, slow: 30_000 } as const;

export const useClients = () => useQuery({ queryKey: ['clients'], queryFn: api.clients.list, refetchInterval: LIVE.fast });
export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: api.system.status, refetchInterval: LIVE.normal });
/** The agent's version: undefined while asking, null on a router installed before the agent existed. */
export const useAgent = () => useQuery({ queryKey: ['agent-version'], queryFn: api.agent.version, staleTime: 60_000 });
export const useInfo = () => useQuery({ queryKey: ['info'], queryFn: api.system.info, staleTime: Number.POSITIVE_INFINITY });

/**
 * A write that refreshes the queries it touches. Errors surface where the caller
 * shows them (form, toast); nothing here swallows them.
 */
export function useWrite<TArgs, TResult = unknown>(fn: (args: TArgs) => Promise<TResult>, invalidates: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all(invalidates.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}
