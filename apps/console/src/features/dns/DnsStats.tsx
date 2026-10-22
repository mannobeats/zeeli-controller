import { useQuery } from '@tanstack/react-query';
import { useClients } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Empty, Grid, Panel } from '../../ui/Layout.tsx';

const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '0%');

/** AdGuard Home's numbers: totals, queries over time, and the top lists. */
export function DnsStats() {
  const stats = useQuery({ queryKey: ['adguard-stats'], queryFn: api.dns.adguardStats, refetchInterval: 30_000 });
  const clients = useClients().data ?? [];
  const nameOf = (ip: string) => clients.find((c) => c.ip === ip)?.name ?? ip;
  const s = stats.data;
  if (stats.isError) return <Empty>Couldn’t read AdGuard Home: {errorMessage(stats.error)}</Empty>;
  if (!s)
    return stats.isLoading ? (
      <output className="panel skeleton" aria-busy="true" />
    ) : (
      <Empty>AdGuard Home isn’t answering. Turn it on in Apps → AdGuard Home.</Empty>
    );
  const max = Math.max(1, ...s.series);
  return (
    <>
      <Panel title={`Last ${s.series.length} ${s.bucket === 'hour' ? 'hours' : 'days'}`}>
        <div className="figures">
          <Figure label="Queries" value={s.queries.toLocaleString()} />
          <Figure label="Blocked" value={s.blocked.toLocaleString()} sub={pct(s.blocked, s.queries)} tone="bad" />
          <Figure label="Malware and phishing" value={s.malware.toLocaleString()} />
          <Figure label="Average answer time" value={`${s.avgMs} ms`} />
        </div>
        <div className="qbars" role="img" aria-label={`Queries per ${s.bucket}, blocked in red`}>
          {s.series.map((q, i) => {
            const b = s.blockedSeries[i] ?? 0;
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

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'bad' }) {
  return (
    <div className="figure">
      <span className="label">{label}</span>
      <span className={`value num${tone ? ` tone-${tone}` : ''}`}>{value}</span>
      {sub ? <span className="sub num">{sub}</span> : null}
    </div>
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
