import {
  checkOwnWifi,
  type OwnBand,
  type OwnSecurity,
  type OwnWifi,
  type OwnWifiInput,
  type Weekday,
  type WifiSchedule,
} from '@zeeli/router-api';

/** Day numbers as the week picker uses them: the firmware's 0 = Sunday. */
const DAY_NAMES: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** What the add and edit sheet holds while it is open. Numbers are text until they are saved. */
export interface OwnForm {
  ssid: string;
  /** Empty while editing means "keep the current password". */
  password: string;
  bands: OwnBand[];
  network: string;
  security: OwnSecurity;
  hidden: boolean;
  isolate: boolean;
  fastRoaming: boolean;
  rrm: boolean;
  bssTransition: boolean;
  multicastToUnicast: boolean;
  maxClients: string;
  dtim: string;
  scheduled: boolean;
  days: number[];
  off: string;
  on: string;
}

export const blankForm = (network: string): OwnForm => ({
  ssid: '',
  password: '',
  bands: ['5g'],
  network,
  security: 'sae-mixed',
  hidden: false,
  isolate: false,
  fastRoaming: false,
  rrm: true,
  bssTransition: true,
  multicastToUnicast: false,
  maxClients: '',
  dtim: '',
  scheduled: false,
  days: EVERY_DAY,
  off: '22:00',
  on: '07:00',
});

export const formOf = (n: OwnWifi): OwnForm => ({
  ...blankForm(n.network),
  ssid: n.ssid,
  bands: n.bands,
  security: n.security,
  hidden: n.hidden,
  isolate: n.isolate,
  fastRoaming: n.options.fastRoaming,
  rrm: n.options.rrm,
  bssTransition: n.options.bssTransition,
  multicastToUnicast: n.options.multicastToUnicast,
  maxClients: n.options.maxClients ? String(n.options.maxClients) : '',
  dtim: n.options.dtim ? String(n.options.dtim) : '',
  scheduled: Boolean(n.schedule),
  days: n.schedule ? n.schedule.days.map((d) => DAY_NAMES.indexOf(d)) : EVERY_DAY,
  off: n.schedule?.off ?? '22:00',
  on: n.schedule?.on ?? '07:00',
});

const scheduleOf = (f: OwnForm): WifiSchedule | null =>
  f.scheduled ? { enabled: true, days: f.days.map((d) => DAY_NAMES[d] as Weekday), off: f.off, on: f.on } : null;

/** What stops a save, in words for the person, or null. The agent checks again. */
export function formProblem(f: OwnForm, editing: boolean): string | null {
  const base = checkOwnWifi({
    ssid: f.ssid,
    bands: f.bands,
    security: f.security,
    ...(editing && !f.password ? {} : { password: f.password }),
  });
  if (base) return base;
  const max = Number(f.maxClients);
  if (f.maxClients && !(Number.isInteger(max) && max >= 1 && max <= 128)) return 'Max devices must be 1 to 128.';
  if (f.scheduled && !f.days.length) return 'Pick at least one day for the schedule.';
  if (f.scheduled && f.off === f.on) return 'Pick different times to turn the network off and on.';
  return null;
}

const options = (f: OwnForm): OwnWifiInput['options'] => ({
  fastRoaming: f.fastRoaming,
  rrm: f.rrm,
  bssTransition: f.bssTransition,
  multicastToUnicast: f.multicastToUnicast,
  maxClients: f.maxClients ? Number(f.maxClients) : null,
  dtim: f.dtim ? Number(f.dtim) : null,
});

export const toInput = (f: OwnForm): OwnWifiInput => ({
  ssid: f.ssid,
  password: f.password,
  bands: f.bands,
  network: f.network,
  security: f.security,
  hidden: f.hidden,
  isolate: f.isolate,
  options: options(f),
  schedule: scheduleOf(f),
});

/** An edit: the password is only sent when a new one was typed. */
export const toPatch = (f: OwnForm) => {
  const { schedule: _schedule, password, ...rest } = toInput(f);
  return password ? { ...rest, password } : rest;
};

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Sixteen letters and digits that are hard to misread, in groups of four: `kd8s-mq2x-7tqa-b3nz`. */
export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
