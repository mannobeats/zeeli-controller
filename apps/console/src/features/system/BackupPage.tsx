import { IconPlus } from '@tabler/icons-react';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import type { BackupInspection, Snapshot, SnapshotChange } from '@zeeli/router-api';
import { type ReactNode, useState } from 'react';
import { useAgent, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { saveBlob } from '../../lib/files.ts';
import { ago, bytes, plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { TextField } from '../../ui/fields.tsx';
import { Chip, Note, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const CHANGE: Record<SnapshotChange['change'], string> = { added: 'new since', removed: 'missing now', changed: 'changed' };

export default function BackupPage() {
  const agent = useAgent();
  if (agent.data === undefined)
    return (
      <>
        <PageHeader title="Backup and restore" />
        <output className="panel skeleton" aria-busy="true" aria-label="Loading" />
      </>
    );
  if (agent.data === null)
    return (
      <>
        <PageHeader title="Backup and restore" />
        <div className="panel notice">
          <h2>The Zeeli agent isn’t on this router yet</h2>
          <p className="kicker">
            Snapshots and backups are made by the agent, a small part of Zeeli Controller that runs on the router. Install the latest Zeeli
            Controller release to add it, then come back.
          </p>
          <div className="row-actions start">
            <Button onClick={() => navigate('firmware')}>Go to Firmware</Button>
          </div>
        </div>
      </>
    );
  return <BackupBody />;
}

function BackupBody() {
  const { toast } = useFeedback();
  const [taking, setTaking] = useState(false);
  const [looking, setLooking] = useState<Snapshot | null>(null);
  const [restart, setRestart] = useState<string | null>(null);
  const [change, setChange] = useState<Change>(null);
  const query = useQuery({ queryKey: ['snapshots'], queryFn: api.safety.backup.snapshots.list });
  const reboot = useWrite(() => api.system.reboot(), []);

  return (
    <>
      <PageHeader
        title="Backup and restore"
        sub="Restore points for the router’s settings, and a backup file you can keep elsewhere."
        actions={
          <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setTaking(true)}>
            Take a snapshot
          </Button>
        }
      />
      <ChangeNotice change={change} dismiss={() => setChange(null)} />
      {restart ? (
        <div className="panel notice">
          <h2>Restart the router to finish</h2>
          <p className="kicker">{restart}</p>
          <div className="row-actions start">
            <Button
              variant="strong"
              busy={reboot.isPending}
              onClick={() =>
                reboot.mutateAsync(undefined).then(
                  () => toast('Rebooting. This page reconnects when the router is back.'),
                  (e) => toast(errorMessage(e)),
                )
              }
            >
              Restart now
            </Button>
          </div>
        </div>
      ) : null}
      <SnapshotsPanel query={query} onLook={setLooking} onRestart={setRestart} onChange={setChange} />
      <BackupFilePanel onRestart={setRestart} />
      {taking ? <TakeSheet onClose={() => setTaking(false)} /> : null}
      {looking ? <ChangesSheet snapshot={looking} onClose={() => setLooking(null)} /> : null}
    </>
  );
}

/** A restore that touches the network or firewall is kept only if this page reaches the router afterwards. */
type Change = { kind: 'confirming' } | { kind: 'rolledBack' | 'unknown'; message: string } | null;

function ChangeNotice({ change, dismiss }: { change: Change; dismiss: () => void }) {
  if (!change) return null;
  if (change.kind === 'confirming') return <p className="kicker">Confirming your change…</p>;
  return (
    <div className="panel notice" role="alert">
      <h2>{change.kind === 'rolledBack' ? 'The router undid the restore' : 'Couldn’t confirm the restore'}</h2>
      <p className="kicker">{change.message}</p>
      <div className="row-actions start">
        <Button onClick={dismiss}>Dismiss</Button>
      </div>
    </div>
  );
}

/* ---------- snapshots ---------- */

function SnapshotsPanel({
  query,
  onLook,
  onRestart,
  onChange,
}: {
  query: UseQueryResult<{ snapshots: Snapshot[]; keep: number; autoKeep: number }>;
  onLook: (s: Snapshot) => void;
  onRestart: (why: string) => void;
  onChange: (c: Change) => void;
}) {
  const { toast, confirm } = useFeedback();
  const remove = useWrite((id: string) => api.safety.backup.snapshots.remove(id), [['snapshots']]);
  const restore = useWrite((id: string) => api.safety.backup.snapshots.restore(id), [['snapshots'], ['firewall'], ['agent-firewall']]);
  const list = query.data?.snapshots ?? [];
  const automatic = list.filter((x) => x.kind === 'auto').length;

  async function restoreOne(s: Snapshot) {
    try {
      const files = await api.safety.backup.snapshots.diff(s.id);
      if (!files.length) return toast('The router already matches that snapshot.');
      const names = files.map((f) => f.name).join(', ');
      const network = files.some((f) => f.name === 'network' || f.name === 'wireless');
      if (
        !(await confirm({
          title: `Go back to ${when(s.time)}?`,
          body: `This writes back ${names}, so any change made to ${files.length === 1 ? 'it' : 'them'} since then is lost. The router saves the current settings as a snapshot first, so you can undo this. ${
            network
              ? 'WiFi and the network restart for a moment, and devices reconnect.'
              : 'What can be reloaded takes effect straight away.'
          }`,
          confirm: 'Restore',
          danger: false,
        }))
      )
        return;
      onChange({ kind: 'confirming' });
      const r = await restore.mutateAsync(s.id);
      if (r.outcome.state === 'confirmed') {
        onChange(null);
        toast(r.summary);
        if (r.rebootNeeded) onRestart(r.summary);
      } else onChange({ kind: r.outcome.state, message: r.outcome.message });
    } catch (err) {
      onChange(null);
      toast(`Couldn’t restore: ${errorMessage(err)}`);
    }
  }

  async function removeOne(s: Snapshot) {
    if (
      !(await confirm({ title: 'Delete this snapshot?', body: `${s.reason}, ${when(s.time)}. You can’t get it back.`, confirm: 'Delete' }))
    )
      return;
    try {
      await remove.mutateAsync(s.id);
      toast('Snapshot deleted');
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  return (
    <Panel
      title="Snapshots"
      note={
        query.data
          ? `${list.length - automatic} of ${query.data.keep} kept${automatic ? `, ${automatic} automatic (the newest ${query.data.autoKeep} are kept)` : ''}`
          : undefined
      }
    >
      {query.isError ? <p className="form-error">{errorMessage(query.error)}</p> : null}
      {query.data && !list.length ? (
        <Note>No snapshots yet. The router takes one before a firewall change, or you can take one now.</Note>
      ) : query.data ? (
        <DataTable
          label="Snapshots"
          rows={list}
          rowKey={(s) => s.id}
          columns={[
            {
              key: 'when',
              header: 'Taken',
              phone: 'title',
              cell: (s) => (
                <>
                  <span className="name">{ago(s.time)}</span> <span className="muted">{when(s.time)}</span>
                </>
              ),
            },
            {
              key: 'why',
              header: 'Why',
              phone: 'sub',
              cell: (s) => (
                <>
                  {s.reason} {s.kind === 'auto' ? <span className="muted">Automatic</span> : null}
                </>
              ),
            },
            { key: 'size', header: 'Size', align: 'end', cell: (s) => <span className="num">{bytes(s.size)}</span> },
            {
              key: 'act',
              header: '',
              align: 'end',
              phone: 'end',
              cell: (s) => (
                <span className="row-actions">
                  <Button variant="ghost" onClick={() => onLook(s)} aria-label={`Changes since ${s.reason}`}>
                    Changes
                  </Button>
                  <Button variant="ghost" onClick={() => restoreOne(s)} aria-label={`Restore ${s.reason}`}>
                    Restore
                  </Button>
                  <Button variant="ghost" onClick={() => removeOne(s)} aria-label={`Delete ${s.reason}`}>
                    Delete
                  </Button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
    </Panel>
  );
}

function TakeSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const [reason, setReason] = useState('');
  const create = useWrite(() => api.safety.backup.snapshots.create(reason.trim()), [['snapshots']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Take a snapshot"
      sub="A copy of the router’s settings you can go back to. The router keeps the newest ten."
      save="Take snapshot"
      onSave={async () => {
        if (!reason.trim()) throw new Error('Say what it’s for, like “Before the holiday”.');
        await create.mutateAsync(undefined);
        toast('Snapshot taken');
      }}
    >
      <TextField label="What is it for?" value={reason} onChange={setReason} placeholder="Before trying a new firewall rule" />
    </Sheet>
  );
}

function ChangesSheet({ snapshot, onClose }: { snapshot: Snapshot; onClose: () => void }) {
  const diff = useQuery({ queryKey: ['snapshot-diff', snapshot.id], queryFn: () => api.safety.backup.snapshots.diff(snapshot.id) });
  let body: ReactNode;
  if (diff.isError) body = <p className="form-error">{errorMessage(diff.error)}</p>;
  else if (!diff.data) body = <Note>Comparing…</Note>;
  else if (!diff.data.length) body = <Note>The settings are the same as in this snapshot.</Note>;
  else
    body = diff.data.map((f) => (
      <div className="group" key={f.name}>
        <p>
          <b>{f.name}</b> <Chip tone={f.change === 'changed' ? undefined : 'warn'}>{CHANGE[f.change]}</Chip>
        </p>
        {f.sections.length ? (
          <ul className="release-notes">
            {f.sections.map((s) => (
              <li key={s.section}>
                {s.section} {s.change === 'changed' ? `(${s.options.join(', ')})` : `(${CHANGE[s.change]})`}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ));
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Changes since this snapshot"
      sub={`${snapshot.reason}, ${when(snapshot.time)}. Restoring would undo what’s listed. Values stay on the router.`}
    >
      {body}
    </Sheet>
  );
}

/* ---------- backup file ---------- */

function BackupFilePanel({ onRestart }: { onRestart: (why: string) => void }) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState<'download' | 'check' | 'restore' | null>(null);
  const [problem, setProblem] = useState('');

  async function download() {
    setBusy('download');
    try {
      const f = await api.safety.backup.download();
      saveBlob(f.blob, f.filename);
      toast(`Saved ${f.filename}`);
    } catch (err) {
      toast(`Couldn’t make the backup: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function pick(file: File) {
    setProblem('');
    setBusy('check');
    let info: BackupInspection;
    try {
      info = await api.safety.backup.inspect(file, 'restore.tar.gz');
    } catch (err) {
      setProblem(errorMessage(err));
      setBusy(null);
      return;
    }
    const ok = await confirm({
      title: 'Restore this backup file?',
      body: `${file.name} holds ${plural(info.files, 'file')}, ${info.configs} of them router settings. Everything in it replaces what’s on the router now. The router saves a snapshot of the current settings first, and it must restart afterwards: devices are offline for about two minutes.`,
      confirm: 'Restore',
      danger: true,
    });
    if (!ok) {
      await api.safety.backup.discard().catch(() => undefined);
      setBusy(null);
      return;
    }
    setBusy('restore');
    try {
      await api.safety.backup.restoreFile(info.token);
      toast('Backup restored');
      onRestart('The backup file is restored, but the router only reads some of it when it starts. Restart it to finish.');
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Panel title="Backup file" note="Everything the router keeps in /etc, as one file">
        <Note>
          The file holds passwords and WiFi keys, so keep it somewhere private. The router deletes its copy as soon as it has been
          downloaded.
        </Note>
        <div className="row-actions start">
          <Button busy={busy === 'download'} onClick={download}>
            Download backup
          </Button>
        </div>
      </Panel>
      <Panel title="Restore from a file" note="Replaces the router’s settings with the file’s">
        <Note>
          Restoring a file from another router model can leave this one unreachable; take a snapshot first and keep the file only for the
          router it came from.
        </Note>
        <label className="input">
          Backup file
          <span className="box">
            <input
              type="file"
              accept=".gz,.tar.gz,application/gzip"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) pick(f);
              }}
            />
          </span>
        </label>
        {busy === 'check' ? <Note>Sending the file to the router and checking it…</Note> : null}
        {busy === 'restore' ? <Note>Restoring…</Note> : null}
        {problem ? (
          <p className="form-error" role="alert">
            {problem}
          </p>
        ) : null}
      </Panel>
    </>
  );
}
