import { useQuery } from '@tanstack/react-query';
import type { MeshMember } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { BAND_LABEL, duration, signal } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { TextField } from '../../ui/fields.tsx';
import { Address, Chip, Note, Panel } from '../../ui/Layout.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

function backhaul(n: MeshMember) {
  if (n.backhaul === 'wired') return 'Wired';
  if (n.backhaul === null) return <span className="muted">Unknown</span>;
  const s = signal(n.signal);
  return (
    <>
      WiFi{n.band ? ` ${BAND_LABEL[n.band.toUpperCase()] ?? n.band}` : ''}
      {n.signal === null ? null : (
        <span className={s.weak ? 'tone-warn' : undefined}>
          {' · '}
          {String(n.signal).replace('-', '−')} dBm, {s.word}
        </span>
      )}
    </>
  );
}

/** The nodes in the mesh, from GL’s own topology: what they are, how they connect, and the actions GL offers. */
export function MeshNodes() {
  const { toast, confirm } = useFeedback();
  const query = useQuery({ queryKey: ['mesh-nodes'], queryFn: api.networkExtras.mesh.nodes, refetchInterval: 15_000 });
  const [naming, setNaming] = useState<MeshMember | null>(null);
  const reboot = useWrite((n: MeshMember) => api.networkExtras.mesh.reboot([n.mac]), [['mesh-nodes']]);
  const remove = useWrite((n: MeshMember) => api.networkExtras.mesh.remove([n.mac]), [['mesh-nodes']]);
  const nodes = (query.data ?? []).filter((n) => !n.self);
  const label = (n: MeshMember) => n.name || n.model;

  async function rebootNode(n: MeshMember) {
    if (
      !(await confirm({
        title: `Reboot ${label(n)}?`,
        body: 'Devices connected through it lose their connection for a minute or two while it restarts.',
        confirm: 'Reboot',
      }))
    )
      return;
    try {
      await reboot.mutateAsync(n);
      toast(`${label(n)} is rebooting`);
    } catch (err) {
      toast(`Couldn’t reboot ${label(n)}: ${errorMessage(err)}`);
    }
  }

  async function removeNode(n: MeshMember) {
    if (
      !(await confirm({
        title: `Remove ${label(n)} from the mesh?`,
        body: 'It stops extending your WiFi and devices connected through it roam to the closest other node. To use it again, add it from a scan.',
        confirm: 'Remove',
      }))
    )
      return;
    try {
      await remove.mutateAsync(n);
      toast(`Removed ${label(n)}`);
    } catch (err) {
      toast(`Couldn’t remove ${label(n)}: ${errorMessage(err)}`);
    }
  }

  return (
    <Panel title="Nodes" note={query.data ? `${nodes.length} in the mesh` : undefined}>
      {query.isError ? <p className="form-error">{errorMessage(query.error)}</p> : null}
      {query.data && !nodes.length ? (
        <Note>No nodes yet. Use Add nodes to scan for a GL.iNet router you’ve reset.</Note>
      ) : query.data ? (
        <DataTable
          label="Mesh nodes"
          rows={nodes}
          rowKey={(n) => n.mac}
          onRowClick={setNaming}
          columns={[
            {
              key: 'node',
              header: 'Node',
              phone: 'title',
              cell: (n) => (
                <>
                  <span className="name">{label(n)}</span> <span className="muted">{n.name ? n.model : ''}</span>
                </>
              ),
            },
            {
              key: 'state',
              header: 'State',
              phone: 'sub',
              cell: (n) => (n.online ? <Chip tone="ok">Online</Chip> : <Chip tone="off">Offline</Chip>),
            },
            { key: 'ip', header: 'Address', cell: (n) => <Address value={n.ip} /> },
            { key: 'back', header: 'Backhaul', cell: backhaul },
            { key: 'clients', header: 'Clients', align: 'end', cell: (n) => <span className="num">{n.clients}</span> },
            {
              key: 'up',
              header: 'Up for',
              align: 'end',
              cell: (n) => (n.uptime === null ? <span className="muted">—</span> : <span className="num">{duration(n.uptime)}</span>),
            },
            {
              key: 'act',
              header: '',
              align: 'end',
              phone: 'end',
              cell: (n) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: keeps the row from opening when a button is used
                // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside handle keys
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" onClick={() => rebootNode(n)} aria-label={`Reboot ${label(n)}`}>
                    Reboot
                  </Button>
                  <Button variant="ghost" onClick={() => removeNode(n)} aria-label={`Remove ${label(n)}`}>
                    Remove
                  </Button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {naming ? <NameSheet key={naming.mac} node={naming} onClose={() => setNaming(null)} /> : null}
    </Panel>
  );
}

function NameSheet({ node, onClose }: { node: MeshMember; onClose: () => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState(node.name);
  const save = useWrite(() => api.networkExtras.mesh.rename(node.mac, name.trim()), [['mesh-nodes']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={node.name || node.model}
      sub={`${node.model} · ${node.mac}`}
      save="Save"
      onSave={async () => {
        if (!name.trim()) throw new Error('Give the node a name.');
        await save.mutateAsync(undefined);
        toast(`Renamed to ${name.trim()}`);
      }}
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="Upstairs" />
    </Sheet>
  );
}
