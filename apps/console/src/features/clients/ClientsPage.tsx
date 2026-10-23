import { IconSearch } from '@tabler/icons-react';
import type { Client } from '@zeeli/router-api';
import { useState } from 'react';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { hashParams } from '../../app/useHashRoute.ts';
import { CATEGORIES, type Category, categoryOf } from '../../lib/devices.ts';
import { errorMessage } from '../../lib/errors.ts';
import { ago, bytes, plural, rateText } from '../../lib/format.ts';
import { DataTable } from '../../ui/DataTable.tsx';
import { DeviceIcon, Swatch } from '../../ui/DeviceIcon.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Chip, PageHeader, Panel } from '../../ui/Layout.tsx';
import { SectionPanel } from '../../ui/SectionPanel.tsx';
import { PolicyNote } from '../policies/AgentNote.tsx';
import { ClientPages } from './ClientPages.tsx';
import { DeviceSheet } from './DeviceSheet.tsx';

type Status = 'all' | 'online' | 'offline' | 'blocked';
const STATUS: [Status, string, (c: Client) => boolean][] = [
  ['all', 'All', () => true],
  ['online', 'Online', (c) => c.online],
  ['offline', 'Offline', (c) => !c.online],
  ['blocked', 'Blocked', (c) => c.blocked],
];

/** Block/unblock and forget, each with its confirm and toast. */
function useClientActions() {
  const { toast, confirm } = useFeedback();
  const block = useWrite(({ macs, on }: { macs: string[]; on: boolean }) => api.clients.setBlocked(macs, on), [['clients']]);
  const forget = useWrite((macs: string[]) => api.clients.forget(macs), [['clients']]);

  async function setBlocked(list: Client[], on: boolean) {
    const names = list.length === 1 ? list[0]?.name : plural(list.length, 'device');
    if (
      on &&
      !(await confirm({
        title: `Block ${names}?`,
        body: 'They lose network and internet access right away, on WiFi and wired, until you unblock them.',
        confirm: 'Block',
      }))
    )
      return;
    const macs = list.map((c) => c.mac);
    try {
      await block.mutateAsync({ macs, on });
      toast(on ? `Blocked ${names}` : `Unblocked ${names}`, () => block.mutateAsync({ macs, on: !on }));
    } catch (err) {
      toast(`Couldn’t change the block list: ${errorMessage(err)}`);
    }
  }

  async function forgetAll(list: Client[]) {
    const offline = list.filter((c) => !c.online);
    if (!offline.length) return toast('Only offline devices can be forgotten.');
    const names = offline.length === 1 ? offline[0]?.name : plural(offline.length, 'offline device');
    if (
      !(await confirm({
        title: `Forget ${names}?`,
        body: 'Their names, types and usage history are erased. If they connect again they show up as new devices.',
        confirm: 'Forget',
      }))
    )
      return;
    try {
      await forget.mutateAsync(offline.map((c) => c.mac));
      toast(`Forgot ${names}`);
    } catch (err) {
      toast(`Couldn’t forget: ${errorMessage(err)}`);
    }
  }

  return { setBlocked, forgetAll };
}

export default function ClientsPage() {
  const query = useClients();
  const [status, setStatus] = useState<Status>('all');
  const [cats, setCats] = useState<Set<Category>>(() => new Set());
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(() => hashParams().get('device'));
  const { setBlocked, forgetAll } = useClientActions();

  const all = query.data ?? [];
  const inCat = (c: Client) => !cats.size || cats.has(categoryOf(c));
  const statusFilter = STATUS.find(([k]) => k === status)?.[2] ?? (() => true);
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter(statusFilter)
    .filter(inCat)
    .filter((c) => !needle || [c.name, c.ip, c.mac].some((v) => v.toLowerCase().includes(needle)))
    .sort((a, b) => Number(b.online) - Number(a.online) || b.rx + b.tx - (a.rx + a.tx) || b.since - a.since);
  const max = Math.max(1, ...rows.map((c) => c.rx));
  const current = all.find((c) => c.mac === open) ?? null;

  return (
    <>
      <PageHeader title="Clients" sub={`${all.filter((c) => c.online).length} online of ${all.length} known`} />
      <ClientPages current="clients" />
      <ClientFilters
        all={all}
        status={status}
        setStatus={setStatus}
        cats={cats}
        setCats={setCats}
        q={q}
        setQ={setQ}
        inCat={inCat}
        statusFilter={statusFilter}
      />
      <Panel>
        {rows.length ? (
          <DataTable
            label="Clients"
            rows={rows}
            rowKey={(c) => c.mac}
            selectedKey={open}
            onRowClick={(c) => setOpen(c.mac)}
            rowClass={(c) => (c.online ? undefined : 'off')}
            bulk={[
              { label: 'Block', danger: true, run: (l) => setBlocked(l, true), when: (l) => l.some((c) => !c.blocked) },
              { label: 'Unblock', run: (l) => setBlocked(l, false), when: (l) => l.some((c) => c.blocked) },
              { label: 'Forget', danger: true, run: forgetAll, when: (l) => l.some((c) => !c.online) },
            ]}
            columns={[
              {
                key: 'dev',
                header: 'Device',
                phone: 'title',
                cell: (c) => (
                  <div className="dev-cell">
                    <span className={`mark${c.online ? ' ok' : ''}`} />
                    <DeviceIcon client={c} />
                    {c.name}
                    {c.blocked ? <Chip tone="bad">Blocked</Chip> : null}
                    {c.limitRx || c.limitTx ? <Chip>Limited</Chip> : null}
                  </div>
                ),
              },
              {
                key: 'conn',
                header: 'Connected to',
                phone: 'sub',
                cell: (c) => (
                  <span className="conn">
                    <Swatch category={categoryOf(c)} />
                    {c.online ? c.link.label : `${c.link.label} · ${ago(c.since)}`}
                  </span>
                ),
              },
              { key: 'ip', header: 'IP address', cell: (c) => <span className="mono">{c.ip}</span> },
              { key: 'mac', header: 'MAC', cell: (c) => <span className="mono muted">{c.mac}</span> },
              {
                key: 'down',
                header: 'Down',
                align: 'end',
                phone: 'end',
                cell: (c) =>
                  c.online ? (
                    <div className="bar-cell">
                      <span className="bar">
                        <i style={{ width: `${Math.max(2, (c.rx / max) * 100)}%` }} />
                      </span>
                      {rateText(c.rx)}
                    </div>
                  ) : (
                    '—'
                  ),
              },
              { key: 'up', header: 'Up', align: 'end', cell: (c) => (c.online ? rateText(c.tx) : '—') },
              { key: 'total', header: 'Usage', align: 'end', cell: (c) => bytes(c.totalRx + c.totalTx) },
            ]}
          />
        ) : (
          <NoClients needle={needle} q={q} status={status} filtered={cats.size > 0} clear={() => setQ('')} />
        )}
      </Panel>
      <PolicyNote>Blocking here is on or off. For bedtimes, timed pauses and whole groups of devices, see</PolicyNote>
      <DeviceSheet
        client={current}
        onClose={() => setOpen(null)}
        onBlock={(c) => setBlocked([c], !c.blocked)}
        onForget={(c) => forgetAll([c])}
      />
    </>
  );
}

interface FilterProps {
  all: Client[];
  status: Status;
  setStatus: (s: Status) => void;
  cats: Set<Category>;
  setCats: (c: Set<Category>) => void;
  q: string;
  setQ: (q: string) => void;
  inCat: (c: Client) => boolean;
  statusFilter: (c: Client) => boolean;
}

function ClientFilters({ all, status, setStatus, cats, setCats, q, setQ, inCat, statusFilter }: FilterProps) {
  return (
    <SectionPanel label="Filters">
      <label className="search">
        <IconSearch size={16} stroke={1.75} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, IP or MAC" aria-label="Search clients" />
      </label>
      <div className="ctx-sub">Status</div>
      <div className="ctx-list">
        {STATUS.map(([k, label, f]) => (
          <button key={k} type="button" className="ctx-item" aria-current={status === k ? 'page' : undefined} onClick={() => setStatus(k)}>
            {label}
            <span className="n">{all.filter(f).filter(inCat).length}</span>
          </button>
        ))}
      </div>
      <div className="ctx-sub">Connection</div>
      {CATEGORIES.map(([k, label]) => (
        <label className="ctx-check" key={k}>
          <input
            type="checkbox"
            checked={cats.has(k)}
            onChange={(e) => {
              const next = new Set(cats);
              e.target.checked ? next.add(k) : next.delete(k);
              setCats(next);
            }}
          />
          <Swatch category={k} />
          {label}
          <span className="n">{all.filter((c) => categoryOf(c) === k).filter(statusFilter).length}</span>
        </label>
      ))}
    </SectionPanel>
  );
}

function NoClients({
  needle,
  q,
  status,
  filtered,
  clear,
}: {
  needle: string;
  q: string;
  status: Status;
  filtered: boolean;
  clear: () => void;
}) {
  if (needle)
    return (
      <p className="empty">
        {`No client matches “${q}”.`}
        <button type="button" className="link" onClick={clear}>
          Clear search
        </button>
      </p>
    );
  const which = status === 'all' ? '' : `${status} `;
  return <p className="empty">{`No ${which}clients${filtered ? ' on this connection type' : ''}.`}</p>;
}
