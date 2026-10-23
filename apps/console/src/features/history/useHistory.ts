import { useQuery } from '@tanstack/react-query';
import type { HistoryEventKind, HistoryRange, TrafficKind } from '@zeeli/router-api';
import { api } from '../../api/router.ts';
import { sumTraffic } from './sum.ts';

/** The agent records once a minute, so there is nothing newer to fetch sooner. */
const EVERY = 60_000;

/** The collector’s state: undefined while asking, null on a router whose agent can’t record history. */
export const useHistoryStatus = () =>
  useQuery({ queryKey: ['history-status'], queryFn: api.stats.status, refetchInterval: EVERY, staleTime: EVERY / 2 });

export const useTraffic = (kind: TrafficKind, id: string, range: HistoryRange) =>
  useQuery({ queryKey: ['history', kind, id, range], queryFn: () => api.stats.traffic(kind, id, range), refetchInterval: EVERY });

export const useSystemHistory = (range: HistoryRange) =>
  useQuery({ queryKey: ['history', 'system', range], queryFn: () => api.stats.system(range), refetchInterval: EVERY });

export const useHealth = (uplink: string, range: HistoryRange) =>
  useQuery({ queryKey: ['history', 'health', uplink, range], queryFn: () => api.stats.health(uplink, range), refetchInterval: EVERY });

export const useTop = (range: HistoryRange, limit = 10) =>
  useQuery({ queryKey: ['history', 'top', range, limit], queryFn: () => api.stats.top(range, limit), refetchInterval: EVERY });

/** Everything that went through the router’s uplinks: each uplink with history, added together. */
export const useInternetTraffic = (range: HistoryRange) =>
  useQuery({
    queryKey: ['history', 'internet', range],
    queryFn: async () => {
      const { wans } = await api.stats.top(range, 10);
      const all = await Promise.all(wans.map((w) => api.stats.traffic('wan', w.id, range)));
      return sumTraffic(all.flatMap((s) => s ?? []));
    },
    refetchInterval: EVERY,
  });

/** Events of some kinds that happened to one device or uplink, newest first. */
export const useSubjectEvents = (subject: string, kinds: HistoryEventKind[]) =>
  useQuery({
    queryKey: ['history', 'events', subject, kinds],
    queryFn: () => api.stats.events({ subject, kinds, limit: 200 }),
    refetchInterval: EVERY,
  });

/** Unread alerts. Not asked at all on a router that can’t record them. */
export function useAlerts() {
  const status = useHistoryStatus().data;
  return useQuery({ queryKey: ['alerts'], queryFn: api.stats.alerts, refetchInterval: 30_000, enabled: Boolean(status) });
}
