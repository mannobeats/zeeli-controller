import { IconPlus } from '@tabler/icons-react';
import type { Policy } from '@zeeli/router-api';
import { type MouseEvent, useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Switch } from '../../ui/fields.tsx';
import { Chip, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { moved } from '../../ui/reorder.tsx';
import { AgentMissing } from './AgentNote.tsx';
import { confirmedDelete } from './confirmedDelete.ts';
import type { Preset } from './draft.ts';
import { PolicySheet } from './PolicySheet.tsx';
import { useAgentVersion, useNames, usePolicyList } from './queries.ts';
import { Sentence } from './Sentence.tsx';
import { type Names, suggestedName } from './sentence.ts';

const stop = (e: MouseEvent) => e.stopPropagation();

const PRESETS: [Preset, string, string][] = [
  ['bedtime', 'Bedtime', 'Block a group from the internet overnight, every day or on chosen days.'],
  ['pause', 'Pause for a while', 'Cut a device or group off now. The router lifts it by itself.'],
  ['site', 'Block a site', 'Keep chosen devices away from a website, such as TikTok.'],
  ['limit', 'Limit speed', 'Hold a device or group to a download and upload speed.'],
  ['route', 'Route through a VPN', 'Send a device or group out through a VPN tunnel or a chosen internet connection.'],
  ['', 'From scratch', 'Pick who, what, when and the action yourself.'],
];

export default function PoliciesPage() {
  const agent = useAgentVersion();
  return (
    <Loaded query={agent} title="Policies">
      {(version) => (version === null ? <AgentMissing title="Policies" what="Policies" /> : <PolicyList />)}
    </Loaded>
  );
}

function PolicyState({ policy: p, names }: { policy: Policy; names: Names }) {
  if (!p.enabled) return <Chip>Off</Chip>;
  if (!p.active) return <Chip>Not now</Chip>;
  const a = p.action;
  if (a.kind !== 'route') return <Chip tone="ok">Active</Chip>;
  const target = names.targets.find((t) => t.id === a.target);
  if (target?.up) return <Chip tone="ok">Active</Chip>;
  const name = target?.name ?? 'The connection';
  return a.fallback === 'block' ? <Chip tone="bad">Blocked: {name} is down</Chip> : <Chip tone="warn">{name} is down</Chip>;
}

/** Switching on and off, deleting and moving, each with its toast. */
function usePolicyActions(policies: Policy[]) {
  const feedback = useFeedback();
  const { toast } = feedback;
  const enable = useWrite(
    ({ list, on }: { list: Policy[]; on: boolean }) =>
      api.policies.setEnabled(
        list.map((p) => p.id),
        on,
      ),
    [['policies']],
  );
  const remove = useWrite((list: Policy[]) => api.policies.removeMany(list.map((p) => p.id)), [['policies']]);
  const reorder = useWrite((ids: string[]) => api.policies.reorder(ids), [['policies']]);

  async function setOn(list: Policy[], on: boolean) {
    try {
      await enable.mutateAsync({ list, on });
      toast(`${list.length === 1 ? list[0]?.name : plural(list.length, 'policy', 'policies')} turned ${on ? 'on' : 'off'}`);
    } catch (err) {
      toast(`Couldn’t change the policies: ${errorMessage(err)}`);
    }
  }

  const removeAll = (list: Policy[]) =>
    confirmedDelete(
      feedback,
      list.length === 1 ? (list[0]?.name ?? '') : plural(list.length, 'policy', 'policies'),
      'Their devices go back to what the other policies and the network allow.',
      () => remove.mutateAsync(list),
    );

  // the dropped order shows at once; it stays until the router has answered, and a refusal puts it back
  const [pending, setPending] = useState<Policy[] | null>(null);
  async function move(_: Policy, from: number, to: number) {
    const next = moved(policies, from, to);
    setPending(next);
    try {
      await reorder.mutateAsync(next.map((p) => p.id));
    } catch (err) {
      toast(`Couldn’t reorder: ${errorMessage(err)}`);
    } finally {
      setPending(null);
    }
  }

  return { shown: pending ?? policies, setOn, removeAll, move, busy: enable.isPending || reorder.isPending };
}

function PolicyList() {
  const { names, ready } = useNames();
  const list = usePolicyList(ready);
  const [editing, setEditing] = useState<{ policy: Policy | null; preset: Preset } | null>(null);

  return (
    <Loaded query={list} title="Policies">
      {({ policies, now, warnings }) => (
        <PolicyTable policies={policies} now={now} warnings={warnings} names={names} editing={editing} setEditing={setEditing} />
      )}
    </Loaded>
  );
}

interface TableProps {
  policies: Policy[];
  now: number;
  warnings: string[];
  names: Names;
  editing: { policy: Policy | null; preset: Preset } | null;
  setEditing: (e: { policy: Policy | null; preset: Preset } | null) => void;
}

function PolicyTable({ policies, now, warnings, names, editing, setEditing }: TableProps) {
  const { shown, setOn, removeAll, move, busy } = usePolicyActions(policies);
  const applying = policies.filter((p) => p.active).length;
  const current = editing?.policy ? (policies.find((p) => p.id === editing.policy?.id) ?? editing.policy) : null;

  return (
    <>
      <PageHeader
        title="Policies"
        sub={
          policies.length
            ? `${plural(policies.length, 'policy', 'policies')}, ${applying} applying now. Each one reads as who, what, when and what happens.`
            : 'Block, allow or slow down devices, groups and networks, always or on a schedule.'
        }
        actions={
          <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setEditing({ policy: null, preset: '' })}>
            New policy
          </Button>
        }
      />
      {warnings.map((w) => (
        <div className="panel notice" key={w}>
          {w}
        </div>
      ))}
      {policies.length ? (
        <Panel>
          <DataTable
            label="Policies"
            rows={shown}
            rowKey={(p) => p.id}
            reorder={{ onMove: move, label: (p) => p.name, disabled: busy }}
            onRowClick={(p) => setEditing({ policy: p, preset: '' })}
            rowClass={(p) => (p.enabled ? undefined : 'off')}
            bulk={[
              { label: 'Turn on', run: (l) => setOn(l, true), when: (l) => l.some((p) => !p.enabled) },
              { label: 'Turn off', run: (l) => setOn(l, false), when: (l) => l.some((p) => p.enabled) },
              { label: 'Delete', danger: true, run: removeAll },
            ]}
            columns={[
              {
                key: 'order',
                header: '#',
                size: 'xs',
                cell: (p) => <span className="num muted">{shown.indexOf(p) + 1}</span>,
              },
              {
                key: 'policy',
                header: 'Policy',
                phone: 'title',
                className: 'pol-cell',
                cell: (p) => (
                  <>
                    <Sentence policy={p} names={names} now={now} />
                    {p.name === suggestedName(p, names) ? null : <span className="pol-name">{p.name}</span>}
                  </>
                ),
              },
              { key: 'state', header: 'State', phone: 'sub', cell: (p) => <PolicyState policy={p} names={names} /> },
              {
                key: 'on',
                header: 'On',
                align: 'end',
                phone: 'end',
                cell: (p) => (
                  // biome-ignore lint/a11y/noStaticElementInteractions: keeps the row from opening when the switch is used
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the switch handles keys
                  <span onClick={stop}>
                    <Switch checked={p.enabled} label={`${p.name} on`} onChange={(on) => setOn([p], on)} disabled={busy} />
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      ) : (
        <Panel title="Start with a policy">
          <div className="presets">
            {PRESETS.map(([key, title, note]) => (
              <button type="button" className="preset" key={key || 'scratch'} onClick={() => setEditing({ policy: null, preset: key })}>
                <b>{title}</b>
                <span>{note}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}
      {editing ? (
        <PolicySheet
          key={current?.id ?? `new-${editing.preset}`}
          policy={current}
          preset={editing.preset}
          names={names}
          now={now}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
