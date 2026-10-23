import { isRouterError } from '../errors.ts';
import type { Transport } from '../transport/types.ts';

/* ---------- snapshots and backups ---------- */

export interface Snapshot {
  id: string;
  /** Unix seconds. */
  time: number;
  reason: string;
  /** Bytes of settings it holds. */
  size: number;
  configs: string[];
}

export interface SnapshotChange {
  name: string;
  /** Since the snapshot: added, removed or changed. */
  change: 'added' | 'removed' | 'changed';
  sections: { section: string; change: 'added' | 'removed' | 'changed'; options: string[] }[];
}

export interface RestoreResult {
  restored: string[];
  reloaded: string[];
  /** Some restored settings are only read at startup. */
  rebootNeeded: boolean;
  summary: string;
  /** The snapshot made just before, which undoes this restore. */
  undo: string | null;
}

export interface BackupFile {
  path: string;
  filename: string;
  size: number;
}

export interface BackupInspection {
  /** Names these exact bytes; restoring needs it. */
  token: string;
  bytes: number;
  files: number;
  configs: number;
}

/* ---------- firewall through the agent ---------- */

export type ZonePolicy = 'ACCEPT' | 'REJECT' | 'DROP';
/** `service` sections belong to router services and are read-only here. */
export type Owner = 'service' | 'default' | 'custom';

export interface AgentZone {
  name: string;
  input: ZonePolicy;
  output: ZonePolicy;
  forward: ZonePolicy;
  masquerade: boolean;
  mssClamp: boolean;
  networks: string[];
  owner: Owner;
  editable: boolean;
}
export interface AgentForwarding {
  id: string;
  src: string;
  dest: string;
  enabled: boolean;
  owner: Owner;
  editable: boolean;
}
export interface AgentRule {
  id: string;
  /** Position in the list, which is the order the firewall checks them. */
  index: number;
  name: string;
  src: string;
  dest: string;
  proto: string;
  destPort: string;
  srcIp: string;
  destIp: string;
  target: ZonePolicy;
  family: '' | 'ipv4' | 'ipv6';
  enabled: boolean;
  owner: Owner;
  editable: boolean;
}
export interface AgentNetwork {
  /** The interface’s UCI name: lan, wan, guest, iot, secondwan… */
  name: string;
  zone: string | null;
}
export type ZoneChange = Partial<Pick<AgentZone, 'input' | 'output' | 'forward' | 'masquerade' | 'mssClamp' | 'networks'>>;
export type RuleFields = Pick<
  AgentRule,
  'name' | 'src' | 'dest' | 'proto' | 'destPort' | 'srcIp' | 'destIp' | 'target' | 'family' | 'enabled'
>;

/** What happened to a change after the router applied it. */
export type ChangeOutcome =
  /** The console reached the router afterwards and the router kept the change. */
  | { state: 'confirmed' }
  /** The router put things back, because nobody confirmed in time. */
  | { state: 'rolledBack'; message: string }
  /** The console lost the router and couldn’t learn which; the router decides on its own. */
  | { state: 'unknown'; message: string };

interface Armed {
  token: string;
  seconds: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GRACE_MS = 5000;

/**
 * Confirm a change the agent armed with a rollback timer. Reaching the router again is the
 * proof the change didn’t cut the console off, so keep asking until it answers or the time
 * is up; if it never does, the router’s own timer has undone the change.
 */
export async function confirmChange(t: Transport, area: string, armed: Armed, retryMs = 1500): Promise<ChangeOutcome> {
  const deadline = Date.now() + armed.seconds * 1000 + GRACE_MS;
  const ask = () =>
    t.zeeli<{ state: string; message?: string }>(area, 'confirm', { token: armed.token }).catch((err: unknown) => {
      if (isRouterError(err) && (err.kind === 'offline' || err.kind === 'timeout')) return null;
      throw err;
    });
  for (let reply = await ask(); ; reply = await ask()) {
    if (reply) return outcomeOf(reply);
    if (Date.now() >= deadline)
      return {
        state: 'unknown',
        message: 'Lost contact with the router. If the change cut this page off, the router undoes it by itself within 30 seconds.',
      };
    await sleep(retryMs);
  }
}

function outcomeOf(r: { state: string; message?: string }): ChangeOutcome {
  if (r.state === 'confirmed') return { state: 'confirmed' };
  if (r.state === 'unknown') return { state: 'unknown', message: r.message ?? 'The router has no record of that change.' };
  return { state: 'rolledBack', message: r.message ?? 'The router undid the change.' };
}

/* ---------- ports ---------- */

export interface PortLink {
  name: string;
  label: string;
  role: 'wan' | 'lan';
  /** `switch` ports sit behind a hardware switch chip; `direct` ports are network devices of their own. */
  kind: 'switch' | 'direct';
  link: boolean | null;
  speedMbps: number | null;
  duplex: 'full' | 'half' | null;
  /** MACs seen behind the port. `inferred` ones follow from it being the only cable in its switch. */
  devices: { mac: string; inferred: boolean }[];
}
export interface PortsStatus {
  ports: PortLink[];
  /** Wired MACs on a switch with more than one cable: the chip doesn’t say which port. */
  unattributed: { mac: string }[];
}

export interface PortProfile {
  id: string;
  name: string;
  /** A network’s key, as in `Network.id`. */
  untagged: string;
  tagged: string[];
}
export interface PortProfileInput {
  id?: string;
  name: string;
  untagged: string;
  tagged: string[];
}

export const safety = (t: Transport) => {
  const z = <R>(area: string, method: string, args?: object, timeoutMs?: number) => t.zeeli<R>(area, method, args, timeoutMs);
  /** A firewall write: the agent applies it, then the console confirms it within the window. */
  async function change<R extends object>(method: string, args: object): Promise<{ result: R; outcome: ChangeOutcome }> {
    const result = await z<R & Partial<Armed>>('firewall', method, args, 30_000);
    // a change that changed nothing (moving a rule where it already is) arms no timer
    if (!result.token || !result.seconds) return { result, outcome: { state: 'confirmed' } };
    return { result, outcome: await confirmChange(t, 'firewall', { token: result.token, seconds: result.seconds }) };
  }

  const zones = () => z<{ zones: AgentZone[] }>('firewall', 'zones').then((r) => r.zones);
  const networks = () => z<{ networks: AgentNetwork[] }>('firewall', 'networks').then((r) => r.networks);
  const forwardings = () => z<{ forwardings: AgentForwarding[] }>('firewall', 'forwardings').then((r) => r.forwardings);
  const rules = () => z<{ rules: AgentRule[] }>('firewall', 'rules').then((r) => r.rules);

  return {
    backup: {
      snapshots: {
        list: () => z<{ snapshots: Snapshot[]; keep: number }>('backup', 'list'),
        create: (reason: string) => z<Snapshot>('backup', 'create', { reason }, 30_000),
        remove: (id: string) => z('backup', 'delete', { id }),
        restore: (id: string) => z<RestoreResult>('backup', 'restore', { id }, 90_000),
        diff: (id: string) => z<{ files: SnapshotChange[] }>('backup', 'diff', { id }, 30_000).then((r) => r.files),
      },
      /** Have the router make an archive and hand it to the browser. */
      async download(): Promise<{ blob: Blob; filename: string }> {
        const f = await z<BackupFile>('backup', 'download', {}, 60_000);
        return { blob: await t.download(f.path, f.filename), filename: f.filename };
      },
      /** Send an archive to the router and have it checked. Nothing is restored yet. */
      async inspect(file: Blob, filename: string): Promise<BackupInspection> {
        const { path } = await z<{ path: string; maxBytes: number }>('backup', 'prepare');
        await t.upload(path, file, filename);
        return z<BackupInspection>('backup', 'inspect', {}, 60_000);
      },
      /** Restore the archive `inspect` described, by its token. The router must restart afterwards. */
      restoreFile: (token: string) =>
        z<{ restored: number; rebootRequired: boolean; undo: string }>('backup', 'restore_file', { token }, 120_000),
      discard: () => z('backup', 'discard'),
    },

    firewall: {
      zones,
      networks,
      forwardings,
      rules,
      /** The one-call read the page needs. */
      all: async () => {
        const [z1, f, r, n] = await Promise.all([zones(), forwardings(), rules(), networks()]);
        return { zones: z1, forwardings: f, rules: r, networks: n };
      },
      updateZone: (name: string, values: ZoneChange) => change('zone_update', { name, ...values }),
      addForwarding: (src: string, dest: string) => change('forwarding_add', { src, dest }),
      removeForwarding: (f: AgentForwarding) => change('forwarding_remove', { id: f.id }),
      addRule: (fields: Partial<RuleFields>) => change('rule_add', fields),
      updateRule: (r: AgentRule, fields: Partial<RuleFields>) => change('rule_update', { id: r.id, current: r.name, ...fields }),
      setRuleEnabled: (r: AgentRule, enabled: boolean) => change('rule_enable', { id: r.id, current: r.name, enabled }),
      removeRule: (r: AgentRule) => change('rule_delete', { id: r.id, current: r.name }),
      /** Put a rule at `to` (0 is first) in the list `rules` returns. */
      moveRule: (r: AgentRule, to: number) => change('rule_move', { id: r.id, current: r.name, to }),
    },

    ports: {
      status: () => z<PortsStatus>('ports', 'status'),
      profiles: () => z<{ profiles: PortProfile[] }>('ports', 'profiles').then((r) => r.profiles),
      saveProfile: (p: PortProfileInput) => z<{ profile: PortProfile }>('ports', 'profile_save', { ...p }).then((r) => r.profile),
      removeProfile: (id: string) => z('ports', 'profile_delete', { id }),
    },
  };
};
