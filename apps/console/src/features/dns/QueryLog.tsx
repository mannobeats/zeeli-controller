import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { DataTable } from '../../ui/DataTable.tsx';
import { FilterBar } from '../../ui/FilterBar.tsx';
import { facetOptions, matches } from '../../ui/filter.ts';
import { Empty, Panel } from '../../ui/Layout.tsx';
import { useDeviceName } from './names.ts';

/** AdGuard Home's live query log, filtered by words, device and result. Used wherever DNS activity shows. */
export function QueryLog() {
  const [q, setQ] = useState('');
  const [device, setDevice] = useState('');
  const [result, setResult] = useState('');
  const log = useQuery({ queryKey: ['adguard-log'], queryFn: () => api.dns.queryLog(200), refetchInterval: 10_000 });
  const nameOf = useDeviceName();
  const all = log.data ?? [];
  const rows = all.filter(
    (e) =>
      (!device || e.client === device) &&
      (!result || (result === 'blocked') === e.blocked) &&
      matches(q, [e.domain, nameOf(e.client), e.client, e.type]),
  );
  return (
    <Panel className="section" title="Live query log" note={`Last ${all.length} queries`}>
      <FilterBar
        search={{ value: q, onChange: setQ, placeholder: 'Domain or device', label: 'Filter the query log' }}
        facets={[
          { label: 'Device', value: device, onChange: setDevice, options: facetOptions(all, (e) => e.client, nameOf) },
          {
            label: 'Result',
            value: result,
            onChange: setResult,
            options: facetOptions(
              all,
              (e) => (e.blocked ? 'blocked' : 'allowed'),
              (v) => (v === 'blocked' ? 'Blocked' : 'Allowed'),
            ),
          },
        ]}
        shown={rows.length}
        total={all.length}
        onClear={() => {
          setQ('');
          setDevice('');
          setResult('');
        }}
      />
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
        <Empty>{all.length ? 'No queries match.' : 'No queries yet.'}</Empty>
      )}
    </Panel>
  );
}
