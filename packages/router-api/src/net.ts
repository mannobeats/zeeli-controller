// Address helpers shared by validation and display.

export const isIpv4 = (v: string) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v);
export const isIpv6 = (v: string) => /^[0-9a-f:]+$/i.test(v) && v.includes(':');
export const isMac = (v: string) => /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(v);

/** 24 -> 255.255.255.0 */
export const prefixToMask = (p: number) =>
  [0, 1, 2, 3].map((i) => (p >= (i + 1) * 8 ? 255 : p <= i * 8 ? 0 : 256 - 2 ** (8 - (p - i * 8)))).join('.');

/** 255.255.255.0 -> 24 */
export const maskToPrefix = (m: string) => m.split('.').reduce((n, o) => n + (Number(o).toString(2).match(/1/g)?.length ?? 0), 0);

const toInt = (ip: string) => ip.split('.').reduce((x, o) => (x << 8) + Number(o), 0) >>> 0;

/** Is `ip` inside the network that `gateway`/`mask` describe? */
export const inSubnet = (ip: string, gateway: string, mask: string) => {
  const p = maskToPrefix(mask);
  const m = p ? (~0 << (32 - p)) >>> 0 : 0;
  return (toInt(ip) & m) === (toInt(gateway) & m);
};

export interface Route {
  type: string;
  dst: string;
  gateway?: string;
  dev?: string;
  table?: string;
  proto?: string;
  scope?: string;
  src?: string;
  metric?: number;
}

const ROUTE_TYPES = ['unicast', 'local', 'broadcast', 'multicast', 'unreachable', 'prohibit', 'blackhole', 'throw', 'anycast'];
const ROUTE_KEYS: Record<string, keyof Route> = {
  via: 'gateway',
  dev: 'dev',
  table: 'table',
  proto: 'proto',
  scope: 'scope',
  src: 'src',
  metric: 'metric',
};

/** One line of `ip -4 route show table all`. */
export function parseRoute(line: string): Route | null {
  const t = line.trim().split(/\s+/);
  if (!t[0]) return null;
  const type = ROUTE_TYPES.includes(t[0]) ? (t.shift() as string) : 'unicast';
  const r: Route = { type, dst: t.shift() ?? '' };
  for (let i = 0; i < t.length; i++) {
    const key = ROUTE_KEYS[t[i] ?? ''];
    const value = t[i + 1];
    if (!key || value === undefined) continue;
    i++;
    if (key === 'metric') r.metric = Number(value);
    else r[key] = value;
  }
  return r;
}
