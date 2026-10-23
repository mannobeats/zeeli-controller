import type { Group, Policy, PolicyInput, PolicyWho } from '@zeeli/router-api';
import { siteOf } from '../family/profile.ts';
import { type Draft, type Names, suggestedName } from './sentence.ts';

export type WhatKind = 'internet' | 'sites' | 'network' | 'everything';
export type ActionKind = 'block' | 'allow' | 'limit';
/** How long a policy lasts: forever, as it is now, or a while from now. */
export type Ends = 'never' | 'keep' | '1h' | '4h' | '12h' | '1d' | '7d';
export type Preset = 'bedtime' | 'site' | 'pause' | 'limit' | '';

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
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

export function emptyForm(preset: Preset, groups: Group[]): PolicyForm {
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
  };
  if (preset === 'bedtime') form.scheduled = true;
  if (preset === 'site') form.whatKind = 'sites';
  if (preset === 'pause') form.ends = '1h';
  if (preset === 'limit') form.action = 'limit';
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
  };
}

const sitesOf = (text: string) =>
  text
    .split('\n')
    .map((line) => siteOf(line).toLowerCase())
    .filter(Boolean);

/** The parts a sentence is read from. `existing` is the end time to keep; `now` is the router's clock. */
export function partsOf(f: PolicyForm, existing: number | null, now: number): Draft {
  const what: Draft['what'] =
    f.action === 'limit' && f.whatKind !== 'everything'
      ? { kind: 'internet' }
      : f.whatKind === 'sites'
        ? { kind: 'sites', sites: sitesOf(f.sites) }
        : f.whatKind === 'network'
          ? { kind: 'network', network: f.network }
          : { kind: f.whatKind };
  const until = f.ends === 'never' ? null : f.ends === 'keep' ? existing : now + (SECONDS[f.ends] ?? 0);
  return {
    who: f.who,
    what,
    when: f.scheduled ? { kind: 'schedule', days: [...f.days].sort(), from: f.from, to: f.to } : { kind: 'always' },
    until,
    action: f.action === 'limit' ? { kind: 'limit', down: Number(f.down) || 0, up: Number(f.up) || 0 } : { kind: f.action },
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
