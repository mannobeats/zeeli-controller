import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { DataTable } from '../../ui/DataTable.tsx';
import { Empty, Panel } from '../../ui/Layout.tsx';
import { useDeviceName } from './names.ts';

/** AdGuard Home's live query log with search and a blocked-only filter. Used wherever DNS activity shows. */
export function QueryLog() {
  const [q, setQ] = useState('');
  const [blockedOnly, setBlockedOnly] = useState(false);
  const log = useQuery({ queryKey: ['adguard-log'], queryFn: () => api.dns.queryLog(200), refetchInterval: 10_000 });
  const nameOf = useDeviceName();
  const needle = q.trim().toLowerCase();
  const rows = (log.data ?? []).filter(
    (e) => (!blockedOnly || e.blocked) && (!needle || e.domain.includes(needle) || nameOf(e.client).toLowerCase().includes(needle)),
  );
  return (
    <Panel
      className="section"
      title="Live query log"
      actions={
        <span className="row-actions">
          <label className="ctx-check">
            <input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} />
            Blocked only
          </label>
          <label className="search">
            <IconSearch size={16} stroke={1.75} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Domain or device"
              aria-label="Filter the query log"
            />
          </label>
        </span>
      }
    >
      {log.isError ? (
        <Empty>Couldn’t read the query log: {errorMessage(log.error)}</Empty>
      ) : rows.length ? (
        <DataTable
          label="DNS query log"
          rows={rows}
          rowKey={(e) => `${e.time}${e.domain}${e.client}`}
          rowClass={(e) => (e.blocked ? 'blocked' : undefined)}
          columns={[
            { key: 'domain', header: 'Domain', phone: 'title', cell: (e) => <span className="name">{e.domain}</span> },
            { key: 'client', header: 'Device', phone: 'sub', cell: (e) => nameOf(e.client) },
            { key: 'type', header: 'Type', cell: (e) => e.type },
            {
              key: 'time',
              header: 'Time',
              cell: (e) => new Date(e.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
            },
            {
              key: 'result',
              header: 'Result',
              align: 'end',
              phone: 'end',
              cell: (e) =>
                e.blocked ? <span className="tone-bad">Blocked</span> : <span className="tone-off">{e.elapsedMs.toFixed(1)} ms</span>,
            },
          ]}
        />
      ) : (
        <Empty>{needle || blockedOnly ? 'No queries match.' : 'No queries yet.'}</Empty>
      )}
    </Panel>
  );
}
