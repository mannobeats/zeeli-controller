import { type Client, type Group, type Network, type Policy, routerClock, zoneOf } from '@zeeli/router-api';

/** What a sentence is read against: the names behind the ids a policy holds. */
export interface Names {
  clients: Client[];
  groups: Group[];
  networks: Network[];
  /** The router's UTC offset like "-0400", to write an end time in its clock. */
  tzoffset?: string;
}

/** A piece of a sentence; the parts that are choices are bold. */
export interface Segment {
  id: number;
  text: string;
  strong?: boolean;
}

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Every name, as people say a list: "a", "a and b", "a, b and c". */
const joinAll = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** Join names as people say them, shortened: "a", "a and b", "a, b and 2 more". */
export function listed(names: string[], noun = ''): string {
  if (names.length <= 2) return names.join(' and ');
  const more = names.length - 2;
  return `${names.slice(0, 2).join(', ')} and ${more} more${noun ? ` ${noun}${more > 1 ? 's' : ''}` : ''}`;
}

/** The network's name, from its firewall zone. */
function networkName(zone: string, names: Pick<Names, 'networks'>): string {
  const n = names.networks.find((x) => zoneOf(x) === zone);
  return n?.label ?? zone;
}

/** The parts of a policy a sentence is made from; a draft in the editor has no id yet. */
export type Draft = Pick<Policy, 'who' | 'what' | 'when' | 'until' | 'action'>;

function whoNames(p: Draft, names: Names): string[] {
  return p.who.map((w) => {
    if (w.type === 'client') return names.clients.find((c) => c.mac === w.id.toUpperCase())?.name ?? w.id;
    if (w.type === 'group') return names.groups.find((g) => g.id === w.id)?.name ?? 'a deleted group';
    return `everyone on ${networkName(w.id, names)}`;
  });
}

/** "the internet", "tiktok.com and 1 more site", "Guest". */
export function whatText(p: Pick<Draft, 'what'>, names: Pick<Names, 'networks'>): string {
  const w = p.what;
  if (w.kind === 'internet') return 'the internet';
  if (w.kind === 'everything') return 'everything';
  if (w.kind === 'sites') return listed(w.sites, 'site');
  return networkName(w.network, names);
}

/** "every day", "weekdays", "Monday, Wednesday and Friday". */
export function daysText(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  const key = set.join();
  if (key === '1,2,3,4,5,6,7') return 'every day';
  if (key === '1,2,3,4,5') return 'weekdays';
  if (key === '6,7') return 'weekends';
  const names = set.map((d) => FULL_DAYS[d - 1] ?? '');
  return names.length === 1 ? `every ${names[0]}` : joinAll(names);
}

/** "every day 22:00–07:00"; empty for a policy that always applies. */
export function whenText(p: Pick<Draft, 'when'>): string {
  const w = p.when;
  if (w.kind !== 'schedule') return '';
  const days = daysText(w.days);
  return w.from === w.to ? `${days}, all day` : `${days} ${w.from}–${w.to}`;
}

/** "5 Mbps down, 1 up", "2.5 Mbps up". */
export function speedText(down: number, up: number): string {
  if (down && up) return `${down} Mbps down, ${up} up`;
  return down ? `${down} Mbps down` : `${up} Mbps up`;
}

/** When an end time falls on the router's clock: "14:15" today, "Fri 14:15" another day. */
export function untilText(until: number, tzoffset: string | undefined, nowSec: number): string {
  const at = routerClock(until, tzoffset ?? '+0000', 0, 0);
  const today = routerClock(nowSec, tzoffset ?? '+0000', 0, 0);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  if (at.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) return time;
  const day = at.toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });
  return `${day} ${time}`;
}

/** The policy as one sentence, in pieces: "Block **Kids** from **the internet** **every day 22:00–07:00**". */
export function sentence(p: Draft, names: Names, nowSec = Math.floor(Date.now() / 1000)): Segment[] {
  const who = { text: listed(whoNames(p, names)) || 'nobody', strong: true };
  const parts: Omit<Segment, 'id'>[] = [];
  const a = p.action;
  if (a.kind === 'limit') {
    parts.push({ text: 'Limit ' }, who, { text: ' to ' }, { text: speedText(a.down, a.up), strong: true });
  } else {
    const what = { text: whatText(p, names), strong: true };
    if (a.kind === 'allow') parts.push({ text: 'Allow ' }, who, { text: ' to reach ' }, what);
    else parts.push({ text: 'Block ' }, who, { text: p.what.kind === 'network' ? ' from reaching ' : ' from ' }, what);
  }
  const when = whenText(p);
  if (when) parts.push({ text: ' ' }, { text: when, strong: true });
  if (p.until !== null) parts.push({ text: ' until ' }, { text: untilText(p.until, names.tzoffset, nowSec), strong: true });
  return parts.map((part, id) => ({ ...part, id }));
}

export const plain = (parts: Segment[]) => parts.map((s) => s.text).join('');

/** The most a policy's name can be, which is what the router accepts. */
const NAME_MAX = 40;

/** Cut a name to `max` characters at a word, with an ellipsis. */
function shorten(text: string, max = NAME_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/** A policy's name when the person doesn't give one: its sentence, without the schedule or end time. */
export function suggestedName(p: Draft, names: Names): string {
  return shorten(plain(sentence({ ...p, when: { kind: 'always' }, until: null }, names)));
}
