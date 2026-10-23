import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Figure } from '../../ui/Figure.tsx';
import { Empty, Grid, Panel } from '../../ui/Layout.tsx';

import { share, trimLeading, useDeviceName } from './names.ts';

/** AdGuard Home's numbers: totals, queries over time, and the top lists. */
export function DnsStats() {
  const stats = useQuery({ queryKey: ['adguard-stats'], queryFn: api.dns.adguardStats, refetchInterval: 30_000 });
  const nameOf = useDeviceName();
  const s = stats.data;
  if (stats.isError) return <Empty>Couldn’t read AdGuard Home: {errorMessage(stats.error)}</Empty>;
  if (!s) return <output className="panel skeleton" aria-busy="true" aria-label="Loading DNS statistics" />;
  const from = trimLeading(s.series);
  const series = s.series.slice(from);
  const blockedSeries = s.blockedSeries.slice(from);
  const unit = s.bucket === 'hour' ? 'hours' : 'days';
  const max = Math.max(1, ...series);
  return (
    <>
      <Panel title={`Last ${series.length} ${unit}`}>
        <div className="figures">
          <Figure label="Queries" value={s.queries.toLocaleString()} />
          <Figure label="Blocked" value={s.blocked.toLocaleString()} sub={`${share(s.blocked, s.queries)} of queries`} tone="bad" />
          <Figure label="Malware and phishing" value={s.malware.toLocaleString()} />
          <Figure label="Average answer time" value={`${s.avgMs} ms`} />
        </div>
        <div className="qbars" role="img" aria-label={`Queries per ${s.bucket}, blocked in red`}>
          {series.map((q, i) => {
            const b = blockedSeries[i] ?? 0;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: one bar per time bucket, in order
              <div className="qbar" key={i} title={`${q.toLocaleString()} queries, ${b.toLocaleString()} blocked`}>
                <i style={{ height: `${(q / max) * 100}%` }}>
                  <b style={{ height: `${q ? (b / q) * 100 : 0}%` }} />
                </i>
              </div>
            );
          })}
        </div>
        <div className="qaxis" aria-hidden>
          <span>
            {series.length} {unit} ago
          </span>
          <span>{s.bucket === 'hour' ? 'This hour' : 'Today'}</span>
        </div>
      </Panel>
      <div className="section-gap">
        <Grid cols={3}>
          <TopList title="Most asked for" rows={s.topQueried} />
          <TopList title="Most blocked" rows={s.topBlocked} tone="bad" />
          <TopList title="Busiest devices" rows={s.topClients.map(([ip, n]) => [nameOf(ip), n])} />
        </Grid>
      </div>
    </>
  );
}

function TopList({ title, rows, tone }: { title: string; rows: [string, number][]; tone?: 'bad' }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <Panel title={title}>
      {rows.length ? (
        <ol className="toplist">
          {rows.slice(0, 8).map(([name, n]) => (
            <li key={name}>
              <span className="tl-name">{name}</span>
              <span className="tl-n num">{n.toLocaleString()}</span>
              <span className={`tl-bar${tone ? ` ${tone}` : ''}`}>
                <i style={{ width: `${(n / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>Nothing yet.</Empty>
      )}
    </Panel>
  );
}
