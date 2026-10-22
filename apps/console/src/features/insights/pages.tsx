import { useQuery } from '@tanstack/react-query';
import { STAT_PERIODS, type StatPeriod } from '@zeeli/router-api';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { bytes } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SelectField, SwitchRow } from '../../ui/fields.tsx';
import { Empty, Grid, Note, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { DnsStats } from '../dns/DnsStats.tsx';
import { QueryLog } from '../dns/QueryLog.tsx';
import { WhenAdguardOn } from '../dns/WhenAdguardOn.tsx';

/* ======================= Traffic ======================= */

export function TrafficPage() {
  const { toast, confirm } = useFeedback();
  const rule = useSettings('flow-rule', api.traffic.rule);
  const usage = useQuery({ queryKey: ['flow-usage'], queryFn: api.traffic.usage, refetchInterval: 60_000 });
  const clear = useWrite(() => api.traffic.clear(), [['flow-usage']]);
  const clients = useClients().data ?? [];
  const byDevice = [...clients].sort((a, b) => b.totalRx + b.totalTx - (a.totalRx + a.totalTx)).filter((c) => c.totalRx + c.totalTx > 0);

  return (
    <Loaded query={rule.query} title="Traffic">
      {(r) => (
        <>
          <PageHeader
            title="Traffic"
            sub={r.enable ? STAT_PERIODS[r.time] : 'Per-app counting is off'}
            actions={
              <Button
                variant="danger"
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: 'Clear traffic statistics?',
                      body: 'All per-app and per-day totals are erased. Counting starts again from zero.',
                      confirm: 'Clear statistics',
                    }))
                  )
                    return;
                  try {
                    await clear.mutateAsync(undefined);
                    toast('Statistics cleared');
                  } catch (err) {
                    toast(errorMessage(err));
                  }
                }}
              >
                Clear statistics
              </Button>
            }
          />
          <Grid cols={2}>
            <Panel title="Total">
              {usage.data ? (
                <>
                  <div className="rates">
                    <div className="rate down">
                      <span className="label">Download</span>
                      <span className="value num">{bytes(usage.data.total.download)}</span>
                    </div>
                    <div className="rate up">
                      <span className="label">Upload</span>
                      <span className="value num">{bytes(usage.data.total.upload)}</span>
                    </div>
                  </div>
                  <DayBars days={usage.data.days} />
                </>
              ) : (
                <div className="skeleton" />
              )}
            </Panel>
            <RuleForm enable={r.enable} time={r.time} save={rule.save} />
          </Grid>
          <Panel className="section" title="By app" note={usage.data ? `${usage.data.apps.length} apps` : undefined}>
            {usage.data?.apps.length ? (
              <BarTable
                rows={usage.data.apps
                  .slice(0, 50)
                  .map((a) => ({ key: a.name, name: a.name, down: a.download, up: a.upload, total: a.total }))}
                label="Traffic by app"
              />
            ) : (
              <Empty>No traffic counted yet.</Empty>
            )}
          </Panel>
          <Panel className="section" title="By device" note="Since the router started counting">
            {byDevice.length ? (
              <BarTable
                label="Traffic by device"
                rows={byDevice
                  .slice(0, 50)
                  .map((c) => ({ key: c.mac, name: c.name, down: c.totalRx, up: c.totalTx, total: c.totalRx + c.totalTx }))}
                onRow={(mac) => navigate(`clients?device=${encodeURIComponent(mac)}`)}
              />
            ) : (
              <Empty>No usage yet.</Empty>
            )}
            <Note>For history across reboots, install Traffic history or Per-device usage from the App store.</Note>
          </Panel>
        </>
      )}
    </Loaded>
  );
}

function RuleForm({
  enable,
  time,
  save,
}: {
  enable: boolean;
  time: StatPeriod;
  save: (v: { enable: boolean; time: StatPeriod; type: 'app' }, what?: string) => Promise<unknown>;
}) {
  const form = useForm({ enable, time });
  return (
    <SettingsForm
      title="Counting"
      form={form}
      onSave={async () => {
        await save({ ...form.values, type: 'app' }, 'that statistics period');
        return 'Statistics settings saved';
      }}
    >
      <SwitchRow label="Count traffic per app" checked={form.values.enable} onChange={(x) => form.set('enable', x)} />
      <SelectField
        label="Period"
        value={form.values.time}
        options={Object.entries(STAT_PERIODS) as [StatPeriod, string][]}
        onChange={(x) => form.set('time', x)}
      />
    </SettingsForm>
  );
}

function DayBars({ days }: { days: { start: number; total: number }[] }) {
  if (!days.length) return null;
  const max = Math.max(1, ...days.map((d) => d.total));
  return (
    <div className="daybars" role="img" aria-label="Traffic per day">
      {days.map((d) => (
        <div
          className="daybar"
          key={d.start}
          title={`${new Date(d.start * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}: ${bytes(d.total)}`}
        >
          <i style={{ height: `${Math.max(3, (d.total / max) * 100)}%` }} />
          <span>{new Date(d.start * 1000).toLocaleDateString([], { weekday: 'short' })}</span>
        </div>
      ))}
    </div>
  );
}

interface BarRow {
  key: string;
  name: string;
  down: number;
  up: number;
  total: number;
}
function BarTable({ rows, label, onRow }: { rows: BarRow[]; label: string; onRow?: (key: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <DataTable
      label={label}
      rows={rows}
      rowKey={(r) => r.key}
      onRowClick={onRow ? (r) => onRow(r.key) : undefined}
      columns={[
        {
          key: 'name',
          header: 'Name',
          phone: 'title',
          cell: (r) => (
            <div className="bar-cell start">
              <span className="name">{r.name}</span>
              <span className="bar">
                <i style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }} />
              </span>
            </div>
          ),
        },
        { key: 'down', header: 'Download', align: 'end', phone: 'sub', cell: (r) => bytes(r.down) },
        { key: 'up', header: 'Upload', align: 'end', cell: (r) => bytes(r.up) },
        { key: 'total', header: 'Total', align: 'end', phone: 'end', cell: (r) => bytes(r.total) },
      ]}
    />
  );
}

/* ======================= DNS queries ======================= */

export function DnsInsightsPage() {
  return (
    <>
      <PageHeader title="DNS queries" sub="What devices look up, from AdGuard Home." />
      <WhenAdguardOn>
        <DnsStats />
        <QueryLog />
      </WhenAdguardOn>
    </>
  );
}
