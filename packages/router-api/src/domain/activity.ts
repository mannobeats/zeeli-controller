import type { Transport } from '../transport/types.ts';

/**
 * Activity: the router's system log turned into events people care about. Codes are
 * stable strings, so saved filters and links keep meaning the same thing.
 */
export type ActivityKind =
  | 'device.joined'
  | 'device.left'
  | 'device.address'
  | 'uplink.up'
  | 'uplink.down'
  | 'internet.lost'
  | 'internet.back'
  | 'admin.ssh'
  | 'admin.failed'
  | 'firmware'
  | 'service.error';

export interface ActivityEvent {
  time: Date;
  kind: ActivityKind;
  /** The device MAC, interface or user the event is about. */
  subject: string;
  detail: string;
  /** How many identical events in a row were folded into this one. */
  count: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Thu Oct 22 18:42:04 2026 daemon.info hostapd: ..."
const LINE = /^\w{3} (\w{3})\s+(\d+) (\d\d):(\d\d):(\d\d) (\d{4}) \S+ ([\w.-]+)(?:\[\d+\])?: (.*)$/;
const MAC = /([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i;

type Rule = [RegExp, (m: RegExpMatchArray, program: string) => Omit<ActivityEvent, 'time' | 'count'> | null];

const RULES: Rule[] = [
  [/AP-STA-CONNECTED (\S+)/, (m) => ({ kind: 'device.joined', subject: (m[1] ?? '').toUpperCase(), detail: 'Joined WiFi' })],
  [/AP-STA-DISCONNECTED (\S+)/, (m) => ({ kind: 'device.left', subject: (m[1] ?? '').toUpperCase(), detail: 'Left WiFi' })],
  [
    /DHCPACK\(\S+\) (\S+) (\S+)(?: (\S+))?/,
    (m) => ({ kind: 'device.address', subject: (m[2] ?? '').toUpperCase(), detail: `Got ${m[1]}${m[3] ? ` as ${m[3]}` : ''}` }),
  ],
  [/Interface '(\S+)' is now up/, (m) => ({ kind: 'uplink.up', subject: m[1] ?? '', detail: 'Came up' })],
  [/Interface '(\S+)' is now down/, (m) => ({ kind: 'uplink.down', subject: m[1] ?? '', detail: 'Went down' })],
  [/Gateway unreachable/, () => ({ kind: 'internet.lost', subject: 'repeater', detail: 'Upstream gateway stopped answering' })],
  [/Gateway reachable/, () => ({ kind: 'internet.back', subject: 'repeater', detail: 'Upstream gateway answering again' })],
  [/Pubkey auth succeeded for '(\S+)'/, (m) => ({ kind: 'admin.ssh', subject: m[1] ?? '', detail: 'Signed in over SSH with a key' })],
  [
    /Password auth succeeded for '(\S+)'/,
    (m) => ({ kind: 'admin.ssh', subject: m[1] ?? '', detail: 'Signed in over SSH with a password' }),
  ],
  [/Bad password attempt for '(\S+)'/, (m) => ({ kind: 'admin.failed', subject: m[1] ?? '', detail: 'Wrong SSH password' })],
  [
    /Login attempt for nonexistent user/,
    () => ({ kind: 'admin.failed', subject: 'unknown', detail: 'SSH sign-in for a user that doesn’t exist' }),
  ],
  [
    /(sysupgrade|Image metadata|upgrade)/i,
    (_m, p) => (p === 'upgrade' ? { kind: 'firmware', subject: 'firmware', detail: 'Firmware check or install' } : null),
  ],
  [/\[error\]\s*(.*)/, (m, p) => ({ kind: 'service.error', subject: p, detail: `Reported “${clip((m[1] ?? '').trim() || 'an error')}”` })],
];

type Found = Omit<ActivityEvent, 'time' | 'count'>;

const clip = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The first rule that recognises `message`, with the subject filled in from a MAC or the program. */
function classify(message: string, program: string): Found | null {
  for (const [re, make] of RULES) {
    const hit = re.exec(message);
    const ev = hit && make(hit, program);
    if (!ev) continue;
    if (!ev.subject) ev.subject = MAC.exec(message)?.[1]?.toUpperCase() ?? program;
    return ev;
  }
  return null;
}

/** Identical events this close together read as one line with a count, even with others in between. */
const FOLD_MS = 10 * 60_000;

/** Parse logread output into events, newest first, folding repeats of the same event. */
export function parseActivity(log: string): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const lastOf = new Map<string, ActivityEvent>();
  for (const line of log.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, mon = '', day, hh, mm, ss, year, program = '', message = ''] = m;
    const ev = classify(message, program);
    if (!ev) continue;
    const time = new Date(Number(year), MONTHS.indexOf(mon), Number(day), Number(hh), Number(mm), Number(ss));
    const key = `${ev.kind}|${ev.subject}|${ev.detail}`;
    const last = lastOf.get(key);
    if (last && time.getTime() - last.time.getTime() <= FOLD_MS) {
      last.count++;
      last.time = time;
    } else {
      const next = { ...ev, time, count: 1 };
      out.push(next);
      lastOf.set(key, next);
    }
  }
  // a folded event takes its latest time, so order by that
  return out.sort((a, b) => b.time.getTime() - a.time.getTime());
}

export const activity = (t: Transport) => ({
  async recent(): Promise<ActivityEvent[]> {
    const r = await t.call<{ log?: string }>('logread', 'get_system_log', {}, 30_000);
    return parseActivity(r.log ?? '');
  },
});
