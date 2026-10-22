import { useClients } from '../../api/queries.ts';

/**
 * AdGuard names a client by IP, by MAC, or by the hostname it learned; turn any of
 * those into the name the rest of the console uses for that device.
 */
export function useDeviceName() {
  const clients = useClients().data ?? [];
  return (id: string) => {
    const key = id.toLowerCase();
    return clients.find((c) => c.ip === id || c.mac.toLowerCase() === key || c.hostname.toLowerCase() === key)?.name ?? id;
  };
}

/** Share of a whole, readable at any size: "20.5%", "0.4%", "under 0.1%". */
export function share(part: number, whole: number) {
  if (!whole || !part) return '0%';
  const p = (part / whole) * 100;
  return p < 0.1 ? 'under 0.1%' : `${p.toFixed(1)}%`;
}

/**
 * Drop the empty buckets before the first query, so a filter that started three days
 * into a 90-day window shows three days, not 87 empty slots. Keeps at least `min`.
 */
export function trimLeading(series: number[], min = 7) {
  const first = series.findIndex((n) => n > 0);
  const from = first < 0 ? 0 : Math.min(first, Math.max(0, series.length - min));
  return from;
}
