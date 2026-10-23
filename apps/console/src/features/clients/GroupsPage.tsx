import { IconPlus } from '@tabler/icons-react';
import type { Client, Group, GroupKind, Policy } from '@zeeli/router-api';
import { useState } from 'react';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Segmented, TextField } from '../../ui/fields.tsx';
import { Chip, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { AgentMissing } from '../policies/AgentNote.tsx';
import { confirmedDelete } from '../policies/confirmedDelete.ts';
import { useAgentVersion, useGroupList, usePolicyList } from '../policies/queries.ts';
import { ClientPages } from './ClientPages.tsx';
import { DevicePick } from './DevicePick.tsx';

const KIND: [GroupKind, string][] = [
  ['person', 'A person'],
  ['devices', 'A set of devices'],
];

export default function GroupsPage() {
  const agent = useAgentVersion();
  return (
    <>
      <ClientPages current="groups" />
      <Loaded query={agent} title="Groups">
        {(version) => (version === null ? <AgentMissing title="Groups" what="Groups" /> : <GroupList />)}
      </Loaded>
    </>
  );
}

/** How many policies name each group, so deleting one says what it touches. */
const usedBy = (policies: Policy[], id: string) => policies.filter((p) => p.who.some((w) => w.type === 'group' && w.id === id));

function memberText(g: Group, clients: Client[]): string {
  const names = g.members.map((m) => clients.find((c) => c.mac === m)?.name ?? m);
  if (names.length <= 3) return names.join(', ') || 'No devices yet';
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

function GroupList() {
  const clientList = useClients();
  const clients = clientList.data ?? [];
  const policies = usePolicyList();
  // names and counts are ready before the list shows, so they don't flash as MAC addresses and dashes
  const groups = useGroupList(Boolean(clientList.data && (policies.data || policies.isError)));
  const feedback = useFeedback();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const remove = useWrite((list: Group[]) => api.policies.groups.removeMany(list.map((g) => g.id)), [['groups'], ['policies']]);
  const used = policies.data?.policies ?? [];

  const removeAll = (list: Group[]) => {
    const touched = new Set(list.flatMap((g) => usedBy(used, g.id).map((p) => p.id))).size;
    const body = touched
      ? `They are taken out of ${plural(touched, 'policy', 'policies')}; a policy left with nobody in it switches off. The devices themselves stay.`
      : 'The devices themselves stay.';
    return confirmedDelete(feedback, list.length === 1 ? (list[0]?.name ?? '') : plural(list.length, 'group'), body, () =>
      remove.mutateAsync(list),
    );
  };

  return (
    <Loaded query={groups} title="Groups">
      {(list) => (
        <>
          <PageHeader
            title="Groups"
            sub={
              list.length
                ? `${plural(list.length, 'group')}. Use them in Policies to block, pause or slow a whole set of devices at once.`
                : 'Put a person’s devices, or any set of devices, in a group, then use it in Policies.'
            }
            actions={
              <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                New group
              </Button>
            }
          />
          <Panel>
            {list.length ? (
              <DataTable
                label="Groups"
                rows={list}
                rowKey={(g) => g.id}
                onRowClick={setEditing}
                bulk={[{ label: 'Delete', danger: true, run: removeAll }]}
                columns={[
                  {
                    key: 'name',
                    header: 'Group',
                    phone: 'title',
                    cell: (g) => (
                      <span className="dev-cell">
                        {g.name}
                        <Chip>{g.kind === 'person' ? 'Person' : 'Devices'}</Chip>
                      </span>
                    ),
                  },
                  {
                    key: 'members',
                    header: 'Devices',
                    phone: 'sub',
                    cell: (g) => <span className="truncate">{memberText(g, clients)}</span>,
                  },
                  {
                    key: 'policies',
                    header: 'In policies',
                    align: 'end',
                    phone: 'end',
                    cell: (g) => (policies.data ? usedBy(used, g.id).length : '—'),
                  },
                ]}
              />
            ) : (
              <p className="empty">No groups yet. A group like “Kids” lets one policy cover all their devices.</p>
            )}
          </Panel>
          {editing ? (
            <GroupSheet
              key={editing === 'new' ? 'new' : editing.id}
              group={editing === 'new' ? null : editing}
              clients={clients}
              inPolicies={editing === 'new' ? 0 : usedBy(used, editing.id).length}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </>
      )}
    </Loaded>
  );
}

function GroupSheet({
  group,
  clients,
  inPolicies,
  onClose,
}: {
  group: Group | null;
  clients: Client[];
  inPolicies: number;
  onClose: () => void;
}) {
  const feedback = useFeedback();
  const { toast } = feedback;
  const [name, setName] = useState(group?.name ?? '');
  const [kind, setKind] = useState<GroupKind>(group?.kind ?? 'devices');
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const save = useWrite(
    () => (group ? api.policies.groups.update(group.id, { name, kind, members }) : api.policies.groups.create({ name, kind, members })),
    [['groups'], ['policies']],
  );
  const remove = useWrite(async () => {
    if (group) await api.policies.groups.remove(group.id);
  }, [['groups'], ['policies']]);

  async function deleteGroup() {
    if (!group) return;
    const body = inPolicies
      ? `It is taken out of ${plural(inPolicies, 'policy', 'policies')}; a policy left with nobody in it switches off. The devices themselves stay.`
      : 'The devices themselves stay.';
    if (await confirmedDelete(feedback, group.name, body, () => remove.mutateAsync(undefined), 'Delete group')) onClose();
  }

  return (
    <Sheet
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={group ? `Edit ${group.name}` : 'New group'}
      sub={group ? `${plural(inPolicies, 'policy', 'policies')} use this group` : undefined}
      save={group ? 'Save group' : 'Create group'}
      danger={group ? { label: 'Delete group', onClick: deleteGroup } : undefined}
      onSave={async () => {
        const saved = await save.mutateAsync(undefined);
        toast(group ? `Saved ${saved.name}` : `Created ${saved.name}`);
      }}
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="Kids" />
      <Segmented label="This group is" value={kind} onChange={setKind} options={KIND} />
      <section className="group">
        <h3>Devices ({members.length})</h3>
        <DevicePick clients={clients} value={members} onChange={setMembers} />
      </section>
    </Sheet>
  );
}
