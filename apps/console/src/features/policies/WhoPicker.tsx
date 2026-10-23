import { IconNetwork, IconUsers, IconX } from '@tabler/icons-react';
import { type Client, type Group, type Network, type PolicyWho, zoneOf } from '@zeeli/router-api';
import { useState } from 'react';
import { plural } from '../../lib/format.ts';
import { Segmented } from '../../ui/fields.tsx';
import { DevicePick } from '../clients/DevicePick.tsx';

type Tab = 'groups' | 'devices' | 'networks';

interface Props {
  value: PolicyWho[];
  onChange: (who: PolicyWho[]) => void;
  clients: Client[];
  groups: Group[];
  networks: Network[];
  /** Speed limits are per device, so they can't be for a whole network. */
  allowNetworks: boolean;
}

const same = (a: PolicyWho, b: PolicyWho) => a.type === b.type && a.id === b.id;

/** Choose who a policy is for: groups, single devices, or whole networks. */
export function WhoPicker({ value, onChange, clients, groups, networks, allowNetworks }: Props) {
  const [tab, setTab] = useState<Tab>(groups.length ? 'groups' : 'devices');
  const shown = !allowNetworks && tab === 'networks' ? 'groups' : tab;
  const has = (w: PolicyWho) => value.some((x) => same(x, w));
  const toggle = (w: PolicyWho, on: boolean) => onChange(on ? [...value, w] : value.filter((x) => !same(x, w)));
  const label = (w: PolicyWho) =>
    w.type === 'client'
      ? (clients.find((c) => c.mac === w.id)?.name ?? w.id)
      : w.type === 'group'
        ? (groups.find((g) => g.id === w.id)?.name ?? 'Deleted group')
        : (networks.find((n) => zoneOf(n) === w.id)?.label ?? w.id);
  const tabs: [Tab, string][] = [
    ['groups', 'Groups'],
    ['devices', 'Devices'],
    ...(allowNetworks ? ([['networks', 'Networks']] as [Tab, string][]) : []),
  ];

  return (
    <section className="group">
      <h3>Who</h3>
      {value.length ? (
        <div className="app-chips">
          {value.map((w) => (
            <button
              type="button"
              className="chip chip-remove"
              key={`${w.type}:${w.id}`}
              aria-label={`Remove ${label(w)}`}
              onClick={() => toggle(w, false)}
            >
              {label(w)} <IconX size={12} />
            </button>
          ))}
        </div>
      ) : (
        <p className="kicker">Choose a group, devices or a network below.</p>
      )}
      <Segmented label="Who to add" value={shown} onChange={setTab} options={tabs} />
      {shown === 'devices' ? (
        <DevicePick
          clients={clients}
          value={value.filter((w) => w.type === 'client').map((w) => w.id)}
          onChange={(macs) =>
            onChange([...value.filter((w) => w.type !== 'client'), ...macs.map((id) => ({ type: 'client' as const, id }))])
          }
        />
      ) : shown === 'groups' ? (
        <GroupPick groups={groups} has={(id) => has({ type: 'group', id })} toggle={(id, on) => toggle({ type: 'group', id }, on)} />
      ) : (
        <NetworkPick
          networks={networks}
          has={(id) => has({ type: 'network', id })}
          toggle={(id, on) => toggle({ type: 'network', id }, on)}
        />
      )}
    </section>
  );
}

interface PickProps {
  has: (id: string) => boolean;
  toggle: (id: string, on: boolean) => void;
}

function GroupPick({ groups, has, toggle }: PickProps & { groups: Group[] }) {
  if (!groups.length) return <p className="kicker">No groups yet. Make one under Clients, Groups.</p>;
  return (
    <div className="dev-pick">
      {groups.map((g) => (
        <label key={g.id} className="pick">
          <input type="checkbox" checked={has(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} />
          <span />
          <IconUsers size={16} stroke={1.75} aria-hidden />
          <span className="pick-name">{g.name}</span>
          <span className="pick-sub">{plural(g.members.length, 'device')}</span>
        </label>
      ))}
    </div>
  );
}

function NetworkPick({ networks, has, toggle }: PickProps & { networks: Network[] }) {
  return (
    <div className="dev-pick">
      {networks.map((n) => (
        <label key={n.id} className="pick">
          <input type="checkbox" checked={has(zoneOf(n))} onChange={(e) => toggle(zoneOf(n), e.target.checked)} />
          <span />
          <IconNetwork size={16} stroke={1.75} aria-hidden />
          <span className="pick-name">{n.label}</span>
          <span className="pick-sub">Everyone on it</span>
        </label>
      ))}
    </div>
  );
}
