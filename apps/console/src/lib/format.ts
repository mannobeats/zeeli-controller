// Display helpers. Router rates are bytes per second; totals are bytes.

export interface Rate {
  value: string;
  unit: string;
}

export function rate(bytesPerSec: number): Rate {
  const bits = (bytesPerSec || 0) * 8;
  if (bits >= 1e9) return { value: (bits / 1e9).toFixed(2), unit: 'Gbps' };
  if (bits >= 1e6) return { value: (bits / 1e6).toFixed(bits >= 1e8 ? 0 : 1), unit: 'Mbps' };
  if (bits >= 1e3) return { value: (bits / 1e3).toFixed(bits >= 1e5 ? 0 : 1), unit: 'Kbps' };
  return { value: bits.toFixed(0), unit: 'bps' };
}
export const rateText = (b: number) => {
  const r = rate(b);
  return `${r.value} ${r.unit}`;
};

export function bytes(input: number | string): string {
  let n = Number(input) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ago(unixSeconds: number, now = Date.now() / 1000): string {
  const s = now - unixSeconds;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86_400);
  if (days < 14) return `${days} days ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "19h,46m,18s" (repeater status) -> "19h 46m" */
export const connectedFor = (s: string | undefined) => (s ?? '').split(',').slice(0, 2).join(' ');

export function signal(dbm: number | null | undefined): { word: string; weak: boolean } {
  if (dbm == null) return { word: '', weak: false };
  if (dbm >= -60) return { word: 'good', weak: false };
  if (dbm >= -70) return { word: 'fair', weak: true };
  return { word: 'weak', weak: true };
}

export const BAND_LABEL: Record<string, string> = {
  '2G': '2.4 GHz',
  '2g': '2.4 GHz',
  '5G': '5 GHz',
  '5g': '5 GHz',
  '6G': '6 GHz',
  '6g': '6 GHz',
  MLD: 'MLO',
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Line weight in path diagrams: log scale so 5 Kbps and 500 Mbps both read. */
export const wireWidth = (bytesPerSec: number) => Math.min(14, 1.5 + 2.4 * Math.log10(1 + (bytesPerSec * 8) / 1000));
