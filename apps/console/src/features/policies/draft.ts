import type { Group, Policy, PolicyInput, PolicyWho, RouteFallback, RouteTarget } from '@zeeli/router-api';
import { siteOf } from '../family/profile.ts';
import { type Draft, type Names, suggestedName } from './sentence.ts';

export type WhatKind = 'internet' | 'sites' | 'network' | 'everything';
export type ActionKind = 'block' | 'allow' | 'limit' | 'route';
/** How long a policy lasts: forever, as it is now, or a while from now. */
export type Ends = 'never' | 'keep' | '1h' | '4h' | '12h' | '1d' | '7d';
export type Preset = 'bedtime' | 'site' | 'pause' | 'limit' | 'route' | '';

export const ENDS: [Ends, string][] = [
  ['never', 'Never'],
  ['keep', 'Keep the current end time'],
  ['1h', 'In 1 hour'],
  ['4h', 'In 4 hours'],
  ['12h', 'In 12 hours'],
  ['1d', 'In 1 day'],
  ['7d', 'In 7 days'],
];
const SECONDS: Record<string, number> = { '1h': 3600, '4h': 4 * 3600, '12h': 12 * 3600, '1d': 86_400, '7d': 7 * 86_400 };

/** Everything the editor holds, with text as typed. */
export interface PolicyForm {
  name: string;
  enabled: boolean;
  who: PolicyWho[];
  whatKind: WhatKind;
  sites: string;
  network: string;
  scheduled: boolean;
  days: number[];
  from: string;
  to: string;
  ends: Ends;
  action: ActionKind;
  down: string;
  up: string;
  /** For a route: a `RouteTarget` id, and what happens while it is down. */
  target: string;
  fallback: RouteFallback;
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

export function emptyForm(preset: Preset, groups: Group[], targets: RouteTarget[] = []): PolicyForm {
  const first = groups[0];
  const form: PolicyForm = {
    name: '',
    enabled: true,
    who: first ? [{ type: 'group', id: first.id }] : [],
    whatKind: 'internet',
    sites: '',
    network: '',
    scheduled: false,
    days: EVERY_DAY,
    from: '22:00',
    to: '07:00',
    ends: 'never',
    action: 'block',
    down: '',
    up: '',
    target: targets[0]?.id ?? '',
    fallback: 'block',
  };
  if (preset === 'bedtime') form.scheduled = true;
  if (preset === 'site') form.whatKind = 'sites';
  if (preset === 'pause') form.ends = '1h';
  if (preset === 'limit') form.action = 'limit';
  if (preset === 'route') form.action = 'route';
  return form;
}

export function formOf(p: Policy): PolicyForm {
  return {
    name: p.name,
    enabled: p.enabled,
    who: p.who,
    whatKind: p.what.kind,
    sites: p.what.kind === 'sites' ? p.what.sites.join('\n') : '',
    network: p.what.kind === 'network' ? p.what.network : '',
    scheduled: p.when.kind === 'schedule',
    days: p.when.kind === 'schedule' ? p.when.days : EVERY_DAY,
    from: p.when.kind === 'schedule' ? p.when.from : '22:00',
    to: p.when.kind === 'schedule' ? p.when.to : '07:00',
    ends: p.until === null ? 'never' : 'keep',
    action: p.action.kind,
    down: p.action.kind === 'limit' && p.action.down ? String(p.action.down) : '',
    up: p.action.kind === 'limit' && p.action.up ? String(p.action.up) : '',
    target: p.action.kind === 'route' ? p.action.target : '',
    fallback: p.action.kind === 'route' ? p.action.fallback : 'block',
  };
}

const sitesOf = (text: string) =>
  text
    .split('\n')
    .map((line) => siteOf(line).toLowerCase())
    .filter(Boolean);

/** A limit covers all of a device's traffic and a route only the internet or sites; the editor hides the other choices. */
function whatOf(f: PolicyForm): Draft['what'] {
  if (f.action === 'limit' && f.whatKind !== 'everything') return { kind: 'internet' };
  if (f.action === 'route') return f.whatKind === 'sites' ? { kind: 'sites', sites: sitesOf(f.sites) } : { kind: 'internet' };
  if (f.whatKind === 'sites') return { kind: 'sites', sites: sitesOf(f.sites) };
  return f.whatKind === 'network' ? { kind: 'network', network: f.network } : { kind: f.whatKind };
}

function actionOf(f: PolicyForm): Draft['action'] {
  if (f.action === 'limit') return { kind: 'limit', down: Number(f.down) || 0, up: Number(f.up) || 0 };
  if (f.action === 'route') return { kind: 'route', target: f.target, fallback: f.fallback };
  return { kind: f.action };
}

/** The parts a sentence is read from. `existing` is the end time to keep; `now` is the router's clock. */
export function partsOf(f: PolicyForm, existing: number | null, now: number): Draft {
  const what = whatOf(f);
  const until = f.ends === 'never' ? null : f.ends === 'keep' ? existing : now + (SECONDS[f.ends] ?? 0);
  return {
    who: f.who,
    what,
    when: f.scheduled ? { kind: 'schedule', days: [...f.days].sort(), from: f.from, to: f.to } : { kind: 'always' },
    until,
    action: actionOf(f),
  };
}

/** What to send the router. A new policy sends no end time unless it has one; an edited one sends 0 to remove it. */
export function inputOf(f: PolicyForm, names: Names, existing: Policy | null, now: number): PolicyInput {
  const parts = partsOf(f, existing?.until ?? null, now);
  const name = f.name.trim() || suggestedName(parts, names);
  const input: PolicyInput = { name, enabled: f.enabled, who: parts.who, what: parts.what, when: parts.when, action: parts.action };
  if (f.ends !== 'keep' && (parts.until !== null || existing)) input.until = parts.until ?? 0;
  return input;
}
