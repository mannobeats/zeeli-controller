import type { Transport } from '../transport/types.ts';
import type { Network } from './networks.ts';

/**
 * Groups and policies are the Zeeli agent's own objects (`zeeli.groups`, `zeeli.policies`).
 * A policy reads as one sentence: who, what, when, and the action. The agent compiles the
 * list to the firewall, dnsmasq and the per-device speed limits.
 */

export type GroupKind = 'person' | 'devices';

export interface Group {
  id: string;
  name: string;
  kind: GroupKind;
  /** MAC addresses, upper case. */
  members: string[];
}
export type GroupInput = Pick<Group, 'name' | 'kind' | 'members'>;

export interface PolicyWho {
  type: 'client' | 'group' | 'network';
  /** A MAC address, a group id, or a network's firewall zone (see `zoneOf`). */
  id: string;
}

export type PolicyWhat =
  | { kind: 'internet' }
  | { kind: 'everything' }
  | { kind: 'sites'; sites: string[] }
  | { kind: 'network'; network: string };

export type PolicyWhen = { kind: 'always' } | { kind: 'schedule'; days: number[]; from: string; to: string };

/**
 * What a route policy does while its target is down: `block` cuts the traffic off so it can’t leak
 * out another way, `normal` lets it take the normal route until the target is back.
 */
export type RouteFallback = 'block' | 'normal';

export type PolicyAction =
  | { kind: 'block' }
  | { kind: 'allow' }
  | { kind: 'limit'; down: number; up: number }
  /** Send the traffic through one VPN tunnel or internet uplink; `target` is a `RouteTarget` id. */
  | { kind: 'route'; target: string; fallback: RouteFallback };

/** Something a route policy can send traffic through: a VPN tunnel set up in the GL panel, or an internet uplink. */
export interface RouteTarget {
  /** `vpn:<GL tunnel id>` or `uplink:<interface>`. */
  id: string;
  kind: 'vpn' | 'uplink';
  /** What a sentence says: "UK VPN", "Ethernet 2". */
  name: string;
  /** What a list says: "UK VPN (WireGuard)", "Ethernet 2". */
  label: string;
  up: boolean;
}

export interface Policy {
  id: string;
  name: string;
  enabled: boolean;
  /** Policies apply top to bottom and the first match decides, so an allow above a block is an exception to it. */
  order: number;
  who: PolicyWho[];
  what: PolicyWhat;
  when: PolicyWhen;
  /** Seconds since epoch when the policy ends by itself, or null. */
  until: number | null;
  action: PolicyAction;
  /** Who made it: 'family:<profile id>' for a Family pause, 'pause:<mac>' for a device pause. */
  tag: string;
  /** Applies at this moment: switched on, inside its schedule, not ended. */
  active: boolean;
}

/** What you send to create or change a policy; leave out what stays. `until: 0` removes the end time. */
export type PolicyInput = Partial<Omit<Policy, 'id' | 'order' | 'active' | 'until'>> & { until?: number };

export interface PolicyList {
  policies: Policy[];
  /** The router's clock, seconds since epoch. */
  now: number;
  /** Parts of a policy the router skipped, in words. */
  warnings: string[];
}

/** Monday first; values are what the agent stores (1 Monday … 7 Sunday). */
export const POLICY_DAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
] as const;

/**
 * The firewall zone a network lives in, which is how policies name networks: Main is `lan`,
 * Guest and IoT keep their names and a custom VLAN is `vlan<id>`.
 */
export const zoneOf = (n: Pick<Network, 'id' | 'fixed' | 'vlanId'>): string =>
  n.id === 'main' ? 'lan' : n.fixed ? n.id : `vlan${n.vlanId ?? n.id}`;

export const policies = (t: Transport) => {
  const removeGroup = (id: string) => t.zeeli<{ affected: number }>('groups', 'delete', { id });
  const removePolicy = (id: string) => t.zeeli('policies', 'delete', { id }, 60_000);
  const updatePolicy = async (id: string, patch: PolicyInput): Promise<Policy> =>
    (await t.zeeli<{ policy: Policy }>('policies', 'update', { id, ...patch }, 60_000)).policy;

  const groups = {
    list: async (): Promise<Group[]> => (await t.zeeli<{ groups: Group[] }>('groups', 'list')).groups,
    create: async (g: GroupInput): Promise<Group> => (await t.zeeli<{ group: Group }>('groups', 'create', g)).group,
    update: async (id: string, patch: Partial<GroupInput>): Promise<Group> =>
      (await t.zeeli<{ group: Group }>('groups', 'update', { id, ...patch })).group,
    remove: removeGroup,
    /** Delete several, one after another: each is a firewall change the router applies before the next. */
    async removeMany(ids: string[]) {
      for (const id of ids) await removeGroup(id);
    },
    addMembers: (id: string, macs: string[]) => t.zeeli('groups', 'add_members', { id, macs }),
    removeMembers: (id: string, macs: string[]) => t.zeeli('groups', 'remove_members', { id, macs }),
  };

  return {
    groups,
    list: () => t.zeeli<PolicyList>('policies', 'list'),
    /** The VPN tunnels and internet uplinks a route policy can use, with whether each is up. */
    routeTargets: async (): Promise<RouteTarget[]> => (await t.zeeli<{ targets: RouteTarget[] }>('policies', 'route_targets')).targets,
    create: async (p: PolicyInput): Promise<Policy> => (await t.zeeli<{ policy: Policy }>('policies', 'create', p, 60_000)).policy,
    update: updatePolicy,
    remove: removePolicy,
    /** Switch several on or off, one after another. */
    async setEnabled(ids: string[], enabled: boolean) {
      for (const id of ids) await updatePolicy(id, { enabled });
    },
    async removeMany(ids: string[]) {
      for (const id of ids) await removePolicy(id);
    },
    /** Put the policies in this order (top first). */
    reorder: (ids: string[]) => t.zeeli('policies', 'reorder', { ids }, 60_000),
    /**
     * Block for a while; it ends on its own on the router. A pause with a `tag` replaces an
     * earlier one with the same tag.
     */
    pause: async (p: {
      who: PolicyWho[];
      minutes: number;
      name?: string;
      what?: 'internet' | 'everything';
      tag?: string;
    }): Promise<Policy> => (await t.zeeli<{ policy: Policy }>('policies', 'pause', p, 60_000)).policy,
  };
};
