import { IconX } from '@tabler/icons-react';
import type { Client, Group, Policy } from '@zeeli/router-api';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SelectField } from '../../ui/fields.tsx';
import { Chip } from '../../ui/Layout.tsx';
import { useAgentVersion, useGroupList, useNames, usePolicyList } from '../policies/queries.ts';
import { Sentence } from '../policies/Sentence.tsx';
import { untilText } from '../policies/sentence.ts';

/** The tag a device's own pause carries, so the sheet can show it and end it. */
const pauseTag = (c: Client) => `pause:${c.mac}`;

/** Policies that reach this device, directly or through one of its groups. */
const reaching = (policies: Policy[], mac: string, groups: Group[]) =>
  policies.filter((p) =>
    p.who.some(
      (w) => (w.type === 'client' && w.id === mac) || (w.type === 'group' && groups.some((g) => g.id === w.id && g.members.includes(mac))),
    ),
  );

/**
 * A device's groups and policies in its sheet: which groups it is in, the policies that
 * apply to it, and two quick actions. Shows nothing on a router without the Zeeli agent.
 */
export function DeviceGroups({ client }: { client: Client }) {
  const agent = useAgentVersion();
  return agent.data ? <DeviceGroupsBody client={client} /> : null;
}

function DeviceGroupsBody({ client }: { client: Client }) {
  const { toast } = useFeedback();
  const groupList = useGroupList();
  const policyList = usePolicyList();
  const { names } = useNames();
  const list = policyList.data;
  const groups = groupList.data ?? [];
  const mine = groups.filter((g) => g.members.includes(client.mac));
  const others = groups.filter((g) => !g.members.includes(client.mac));
  const policies = reaching(list?.policies ?? [], client.mac, mine);
  const pause = policies.find((p) => p.tag === pauseTag(client));
  const keys = [['groups'], ['policies']];

  const join = useWrite(
    ({ id, on }: { id: string; on: boolean }) =>
      on ? api.policies.groups.addMembers(id, [client.mac]) : api.policies.groups.removeMembers(id, [client.mac]),
    keys,
  );
  const quick = useWrite(async (what: 'pause' | 'block') => {
    const who = [{ type: 'client' as const, id: client.mac }];
    if (what === 'pause')
      return api.policies.pause({ who, minutes: 60, name: `${client.name} paused`, what: 'internet', tag: pauseTag(client) });
    return api.policies.create({
      name: `Block ${client.name}`,
      who,
      what: { kind: 'everything' },
      when: { kind: 'always' },
      action: { kind: 'block' },
    });
  }, keys);
  const resume = useWrite((id: string) => api.policies.remove(id), keys);

  async function change(id: string, on: boolean, name: string) {
    try {
      await join.mutateAsync({ id, on });
      toast(on ? `${client.name} added to ${name}` : `${client.name} removed from ${name}`);
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  async function run(what: 'pause' | 'block') {
    try {
      const p = await quick.mutateAsync(what);
      const end = p.until === null ? '' : ` until ${untilText(p.until, names.tzoffset, list?.now ?? Math.floor(Date.now() / 1000))}`;
      toast(what === 'pause' ? `${client.name} paused${end}` : `Blocked ${client.name} with a policy`, () => resume.mutateAsync(p.id));
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  if (!groupList.data || !list) return null;
  return (
    <section>
      <h3>Groups and policies</h3>
      <div className="stack-sm">
        <div className="app-chips">
          {mine.map((g) => (
            <button
              type="button"
              className="chip chip-remove"
              key={g.id}
              aria-label={`Remove from ${g.name}`}
              disabled={join.isPending}
              onClick={() => change(g.id, false, g.name)}
            >
              {g.name} <IconX size={12} />
            </button>
          ))}
          {mine.length ? null : <span className="muted">Not in a group</span>}
        </div>
        {others.length ? (
          <SelectField
            label="Add to a group"
            value=""
            onChange={(id) => {
              const g = others.find((x) => x.id === id);
              if (g) change(g.id, true, g.name);
            }}
            options={[['', 'Choose a group'], ...others.map((g) => [g.id, g.name] as const)]}
          />
        ) : null}
        <div className="pol-quick">
          {pause ? (
            <Button
              busy={resume.isPending}
              onClick={() =>
                resume.mutateAsync(pause.id).then(
                  () => toast(`${client.name} back online`),
                  (e) => toast(errorMessage(e)),
                )
              }
            >
              Resume internet
            </Button>
          ) : (
            <Button busy={quick.isPending} onClick={() => run('pause')}>
              Pause internet for 1 hour
            </Button>
          )}
          <Button busy={quick.isPending} onClick={() => run('block')}>
            Block as a policy
          </Button>
        </div>
        {policies.length ? (
          <ul className="pol-list">
            {policies.map((p) => (
              <li key={p.id}>
                <Sentence policy={p} names={names} now={list?.now} />
                {p.active ? <Chip tone="ok">Active</Chip> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <button type="button" className="link" onClick={() => navigate('policies')}>
          Open Policies
        </button>
      </div>
    </section>
  );
}
