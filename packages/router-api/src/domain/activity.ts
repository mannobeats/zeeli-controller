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
  [/\[error\]/, (_m, p) => ({ kind: 'service.error', subject: p, detail: 'Reported an error' })],
];

type Found = Omit<ActivityEvent, 'time' | 'count'>;

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

const same = (a: Found, b: Found) => a.kind === b.kind && a.subject === b.subject && a.detail === b.detail;

/** Parse logread output into events, newest first, folding identical neighbours. */
export function parseActivity(log: string): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const line of log.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [, mon = '', day, hh, mm, ss, year, program = '', message = ''] = m;
    const ev = classify(message, program);
    if (!ev) continue;
    const time = new Date(Number(year), MONTHS.indexOf(mon), Number(day), Number(hh), Number(mm), Number(ss));
    const last = out.at(-1);
    if (last && same(last, ev)) {
      last.count++;
      last.time = time;
    } else out.push({ ...ev, time, count: 1 });
  }
  return out.reverse();
}

export const activity = (t: Transport) => ({
  async recent(): Promise<ActivityEvent[]> {
    const r = await t.call<{ log?: string }>('logread', 'get_system_log', {}, 30_000);
    return parseActivity(r.log ?? '');
  },
});
