import { IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { cleanDomain, rewriteProblem } from '@zeeli/router-api';
import { type FormEvent, useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { FilterBar } from '../../ui/FilterBar.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { TextField } from '../../ui/fields.tsx';
import { matches } from '../../ui/filter.ts';
import { Address, Empty, Panel } from '../../ui/Layout.tsx';

type Rewrite = { domain: string; answer: string; enabled?: boolean };
const KEY = ['adguard-rewrites'];

/** DNS rewrites: answer a name with an address (or another name) instead of asking the internet. */
export function Rewrites() {
  const list = useQuery({ queryKey: KEY, queryFn: api.dns.rewrites });
  const { add, create, remove, drop } = useRewriteWrites();
  const all = list.data ?? [];
  return (
    <Panel title="DNS rewrites" note={all.length ? `${all.length} ${all.length === 1 ? 'name' : 'names'}` : undefined}>
      <AddRewrite exists={(r) => all.some((x) => x.domain === r.domain && x.answer === r.answer)} busy={add.isPending} onAdd={create} />
      {list.isError ? (
        <Empty>Couldn’t read AdGuard Home: {errorMessage(list.error)}</Empty>
      ) : (
        <RewriteList all={all} busy={remove.isPending} onDelete={drop} />
      )}
    </Panel>
  );
}

/** Adding and deleting, each with a toast that puts it back. */
function useRewriteWrites() {
  const { toast } = useFeedback();
  const add = useWrite((r: Rewrite) => api.dns.addRewrite(r.domain, r.answer), [KEY]);
  const remove = useWrite((r: Rewrite) => api.dns.deleteRewrite({ ...r, enabled: r.enabled !== false }), [KEY]);
  const create = (r: Rewrite) => add.mutateAsync(r).then(() => toast(`${r.domain} now answers ${r.answer}`, () => remove.mutateAsync(r)));
  const drop = (r: Rewrite) =>
    remove.mutateAsync(r).then(
      () => toast(`Deleted ${r.domain}`, () => add.mutateAsync(r)),
      (e) => toast(`Couldn’t delete: ${errorMessage(e)}`),
    );
  return { add, create, remove, drop };
}

function RewriteList({ all, busy, onDelete }: { all: Rewrite[]; busy: boolean; onDelete: (r: Rewrite) => void }) {
  const [q, setQ] = useState('');
  const rows = all.filter((r) => matches(q, [r.domain, r.answer]));
  return (
    <>
      {all.length > 8 ? (
        <FilterBar
          search={{ value: q, onChange: setQ, placeholder: 'Find a name', label: 'Find a rewrite' }}
          shown={rows.length}
          total={all.length}
          onClear={() => setQ('')}
        />
      ) : null}
      {rows.length ? (
        <RewriteTable rows={rows} busy={busy} onDelete={onDelete} />
      ) : (
        <Empty>{all.length ? 'No names match.' : 'No rewrites yet. Point a name like nas.home at a device on your network.'}</Empty>
      )}
    </>
  );
}

function RewriteTable({ rows, busy, onDelete }: { rows: Rewrite[]; busy: boolean; onDelete: (r: Rewrite) => void }) {
  return (
    <DataTable
      label="DNS rewrites"
      rows={rows}
      rowKey={(r) => `${r.domain} ${r.answer}`}
      columns={[
        { key: 'domain', header: 'Name', phone: 'title', cell: (r) => <span className="name">{r.domain}</span> },
        {
          key: 'answer',
          header: 'Answers with',
          phone: 'sub',
          cell: (r) => (
            <>
              <Address value={r.answer} />
              {r.enabled === false ? <span className="muted"> · off</span> : null}
            </>
          ),
        },
        {
          key: 'delete',
          header: <span className="sr-only">Delete</span>,
          align: 'end',
          phone: 'end',
          cell: (r) => (
            <IconButton label={`Delete ${r.domain}`} disabled={busy} onClick={() => onDelete(r)}>
              <IconTrash size={16} />
            </IconButton>
          ),
        },
      ]}
    />
  );
}

function AddRewrite({ exists, busy, onAdd }: { exists: (r: Rewrite) => boolean; busy: boolean; onAdd: (r: Rewrite) => Promise<unknown> }) {
  const [domain, setDomain] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = { domain: cleanDomain(domain), answer: answer.trim() };
    const problem = rewriteProblem(r.domain, r.answer) || (exists(r) ? `${r.domain} already answers ${r.answer}.` : '');
    setError(problem);
    if (problem) return;
    try {
      await onAdd(r);
      setDomain('');
      setAnswer('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="toolbar" onSubmit={submit} noValidate>
      <TextField label="Name" value={domain} onChange={setDomain} placeholder="nas.home" hint="*.home covers every name under it" />
      <TextField label="Answers with" value={answer} onChange={setAnswer} placeholder="192.168.8.20" hint="An IP address or another name" />
      <Button type="submit" variant="strong" busy={busy}>
        Add rewrite
      </Button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
