import type { AccessCell, AgentForwarding, AgentZone } from '@zeeli/router-api';

/** The zones the grid covers: editable ones that don’t face the internet. */
export const gridZones = (zones: AgentZone[]) => zones.filter((z) => z.editable && !z.masquerade);

type Role = 'main' | 'guest' | 'iot' | 'other';
const roleOf = (z: string): Role => (z === 'lan' ? 'main' : z === 'guest' || z === 'iot' ? z : 'other');

const ROLE_COLOR = { main: '#3b82f6', guest: '#f59e0b', iot: '#22c55e' };
const EXTRA = ['#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#6366f1'];
export function zoneColor(z: string) {
  const role = roleOf(z);
  if (role !== 'other') return ROLE_COLOR[role];
  return EXTRA[[...z].reduce((n, ch) => n + ch.charCodeAt(0), 0) % EXTRA.length];
}

/** Who may start connections to whom, keyed `from>to`. */
export type Grid = Record<string, boolean>;
export const cellKey = (src: string, dest: string) => `${src}>${dest}`;
const ends = (k: string) => k.split('>') as [string, string];

/** Every ordered pair of different zones, set by `allowed`. */
const pairs = (zones: AgentZone[], allowed: (src: string, dest: string) => boolean): Grid =>
  Object.fromEntries(zones.flatMap((a) => zones.filter((b) => b !== a).map((b) => [cellKey(a.name, b.name), allowed(a.name, b.name)])));

export function currentGrid(zones: AgentZone[], forwardings: AgentForwarding[]): Grid {
  const on = new Set(forwardings.filter((f) => f.enabled).map((f) => cellKey(f.src, f.dest)));
  return pairs(zones, (a, b) => on.has(cellKey(a, b)));
}

/** Main may reach everything else; the others start nothing. IoT therefore only answers Main. */
export const recommendedGrid = (zones: AgentZone[]): Grid => pairs(zones, (a) => roleOf(a) === 'main');

/** The cells that differ between two grids, as the agent wants them. */
export function changes(from: Grid, to: Grid): AccessCell[] {
  return Object.entries(to)
    .filter(([k, allow]) => from[k] !== allow)
    .map(([k, allow]) => ({ src: ends(k)[0], dest: ends(k)[1], allow }));
}
