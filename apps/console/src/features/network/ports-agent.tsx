import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { EthernetPort, Network, PortProfile } from '@zeeli/router-api';
import { useState } from 'react';
import { useAgent, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { ChipPicker, SelectField, TextField } from '../../ui/fields.tsx';
import { Note, Panel } from '../../ui/Layout.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import type { PortLinks } from './port-links.tsx';

/** Wired devices the switch chip can't place, said once under the ports table. */
export function UnplacedNote({ links }: { links?: PortLinks }) {
  if (!links?.unplaced.length) return null;
  return (
    <Note>
      {plural(links.unplaced.length, 'wired device')} ({links.unplaced.join(', ')}) sit behind the LAN switch. This router’s switch chip
      doesn’t say which port each is on, so they’re shown once only one LAN port has a cable.
    </Note>
  );
}

/** Port profiles, when the router has the agent. */
export function PortProfiles({ ports, networks }: { ports: EthernetPort[]; networks: Network[] }) {
  const agent = useAgent();
  if (!agent.data) return null;
  return <Profiles ports={ports} networks={networks} />;
}

/* ---------- profiles ---------- */

function Profiles({ ports, networks }: { ports: EthernetPort[]; networks: Network[] }) {
  const { toast, confirm } = useFeedback();
  const query = useQuery({ queryKey: ['port-profiles'], queryFn: api.safety.ports.profiles });
  const [editing, setEditing] = useState<PortProfile | 'new' | null>(null);
  const [applying, setApplying] = useState<PortProfile | null>(null);
  const remove = useWrite((id: string) => api.safety.ports.removeProfile(id), [['port-profiles']]);
  const label = (id: string) => networks.find((n) => n.id === id)?.label ?? id;

  async function removeProfile(p: PortProfile) {
    if (!(await confirm({ title: `Delete ${p.name}?`, body: 'Ports already set up with it keep their settings.', confirm: 'Delete' })))
      return;
    try {
      await remove.mutateAsync(p.id);
      toast(`Deleted ${p.name}`);
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  return (
    <Panel
      title="Port profiles"
      note="A name for a set of networks, to put on any LAN port"
      actions={
        <Button icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
          New profile
        </Button>
      }
    >
      {query.data && !query.data.length ? (
        <Note>No profiles yet. A profile is one untagged network plus any tagged ones, like “Camera port” or “Access point”.</Note>
      ) : (
        <DataTable
          label="Port profiles"
          rows={query.data ?? []}
          rowKey={(p) => p.id}
          onRowClick={setEditing}
          columns={[
            { key: 'name', header: 'Profile', phone: 'title', cell: (p) => <span className="name">{p.name}</span> },
            { key: 'untagged', header: 'Untagged', phone: 'sub', cell: (p) => label(p.untagged) },
            {
              key: 'tagged',
              header: 'Tagged',
              cell: (p) => (p.tagged.length ? p.tagged.map(label).join(', ') : <span className="muted">None</span>),
            },
            {
              key: 'act',
              header: '',
              align: 'end',
              phone: 'end',
              cell: (p) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: keeps the row from opening when a button is used
                // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside handle keys
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" onClick={() => setApplying(p)} aria-label={`Apply ${p.name}`}>
                    Apply to ports
                  </Button>
                  <Button variant="ghost" onClick={() => removeProfile(p)} aria-label={`Delete ${p.name}`}>
                    Delete
                  </Button>
                </span>
              ),
            },
          ]}
        />
      )}
      {editing ? (
        <ProfileSheet
          key={editing === 'new' ? 'new' : editing.id}
          profile={editing === 'new' ? null : editing}
          networks={networks}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {applying ? <ApplySheet profile={applying} ports={ports} networks={networks} onClose={() => setApplying(null)} /> : null}
    </Panel>
  );
}

function ProfileSheet({ profile, networks, onClose }: { profile: PortProfile | null; networks: Network[]; onClose: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState(profile?.name ?? '');
  const [untagged, setUntagged] = useState(profile?.untagged ?? networks[0]?.id ?? 'main');
  const [tagged, setTagged] = useState(profile?.tagged ?? []);
  const save = useWrite(
    () => api.safety.ports.saveProfile({ ...(profile ? { id: profile.id } : {}), name, untagged, tagged }),
    [['port-profiles']],
  );
  const options = networks.map((n) => [n.id, n.label] as const);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={profile ? profile.name : 'New port profile'}
      sub="One network goes through the port untagged; the tagged ones ride along for devices that understand VLANs."
      save={profile ? 'Save' : 'Add profile'}
      onSave={async () => {
        if (!name.trim()) throw new Error('Give the profile a name.');
        await save.mutateAsync(undefined);
        toast(profile ? `Saved ${name}` : `Added ${name}`);
      }}
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="Camera port" />
      <SelectField label="Untagged network" value={untagged} options={options} onChange={setUntagged} />
      <ChipPicker
        legend="Tagged networks"
        options={options.filter(([id]) => id !== untagged)}
        value={tagged.filter((t) => t !== untagged)}
        onChange={setTagged}
      />
    </Sheet>
  );
}

/** Putting a profile on ports is GL’s own port setting, so the page and the stock panel always agree. */
function ApplySheet({
  profile,
  ports,
  networks,
  onClose,
}: {
  profile: PortProfile;
  ports: EthernetPort[];
  networks: Network[];
  onClose: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const lan = ports.filter((p) => p.role === 'lan');
  const [picked, setPicked] = useState<string[]>([]);
  const apply = useWrite(
    async (chosen: EthernetPort[]) => {
      const vlan = (id: string) => networks.find((n) => n.id === id)?.vlanId ?? (id === 'main' ? 1 : null);
      const untagged = vlan(profile.untagged);
      const tagged = profile.tagged.map(vlan);
      if (untagged === null || tagged.includes(null))
        throw new Error('One of the profile’s networks has no VLAN, so it can’t be put on a port.');
      const vlans = tagged.filter((v): v is number => v !== null);
      // one port at a time: GL reconfigures the switch for each
      await chosen.reduce(
        (done, port) => done.then(() => api.internet.setPortVlans(port, vlans.length ? 'Multiple VLANs' : 'Standard', untagged, vlans)),
        Promise.resolve<unknown>(undefined),
      );
    },
    [['ports'], ['port-status']],
  );
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Apply ${profile.name}`}
      sub="The ports take this profile’s networks. Devices plugged in move to them straight away."
      save="Apply"
      onSave={async () => {
        if (!picked.length) throw new Error('Pick at least one port.');
        const wanted = new Set(picked);
        const chosen = lan.filter((p) => wanted.has(p.name));
        const labels = chosen.map((p) => p.label);
        if (
          !(await confirm({
            title: `Put ${profile.name} on ${labels.join(', ')}?`,
            body: `Whatever is plugged into ${plural(labels.length, 'this port', 'these ports')} changes network. A device on a port you’re using to reach the router may need to reconnect.`,
            confirm: 'Apply',
            danger: false,
          }))
        )
          return false;
        await apply.mutateAsync(chosen);
        toast(`${profile.name} is on ${labels.join(', ')}`);
      }}
    >
      <ChipPicker legend="LAN ports" options={lan.map((p) => [p.name, p.label] as const)} value={picked} onChange={setPicked} />
    </Sheet>
  );
}
