import { type UseQueryResult, useQuery, useQueryClient } from '@tanstack/react-query';
import { APP_CATALOG, type AppConfig, type AppState, type ServiceAction } from '@zeeli/router-api';
import type { ReactNode } from 'react';
import { useStatus, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { appPageId } from '../../app/nav.ts';
import { useHashRoute } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { bytes } from '../../lib/format.ts';
import { AdvancedGate } from '../../ui/AdvancedGate.tsx';
import { Button } from '../../ui/Button.tsx';
import { type Column, DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, Empty, KeyValues, Note, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { RunPanel, WakePanel } from './AppActions.tsx';
import { AppIcon, useAppChange, WaitNote } from './common.tsx';

/** The page of a package app; which one comes from the route (`#app-iperf3`). */
export function AppPage() {
  const page = useHashRoute();
  const def = APP_CATALOG.find((a) => appPageId(a) === page);
  const query = useQuery({ queryKey: ['apps'], queryFn: api.apps.list });
  const title = def?.name ?? 'App';
  return (
    <AdvancedGate title={title}>
      <Loaded query={query} title={title}>
        {(list) => {
          const app = list.find((a) => a.id === def?.id);
          return app ? <AppDetail app={app} /> : <Empty>This app isn’t in the catalog.</Empty>;
        }}
      </Loaded>
    </AdvancedGate>
  );
}

function AppDetail({ app }: { app: AppState }) {
  const { run, busy } = useAppChange();
  const verb = app.installed ? ['Remove', 'Removing…'] : ['Install', 'Installing…'];
  return (
    <>
      <PageHeader
        title={app.name}
        sub={app.summary}
        actions={
          <Button variant={app.installed ? 'danger' : 'strong'} busy={busy !== null} onClick={() => run(app, app.installed)}>
            {busy ? verb[1] : verb[0]}
          </Button>
        }
      />
      <WaitNote busy={busy} />
      <AboutPanel app={app} />
      {app.installed ? <InstalledParts app={app} /> : null}
      <UsagePanels app={app} />
    </>
  );
}

function AboutPanel({ app }: { app: AppState }) {
  const versions = Object.entries(app.versions);
  return (
    <Panel title="About">
      <div className="app-about-row">
        <AppIcon id={app.id} />
        <KeyValues
          rows={[
            ['Status', <Chip key="s">{app.installed ? 'Installed' : 'Not installed'}</Chip>],
            [
              versions.length > 1 ? 'Versions' : 'Version',
              <span key="v" className="mono">
                {versions.map(([p, v]) => `${p} ${v}`).join(', ') || '–'}
              </span>,
            ],
            ['Category', app.category],
          ]}
        />
      </div>
    </Panel>
  );
}

function InstalledParts({ app }: { app: AppState }) {
  return (
    <>
      {app.service ? <ServicePanel app={app} name={app.service} /> : null}
      {app.run ? <RunPanel app={app} /> : null}
      {app.wake ? <WakePanel /> : null}
      {app.needsDrive ? <DrivePanel /> : null}
      {app.fields || app.records ? <AppSettings app={app} /> : null}
    </>
  );
}

function UsagePanels({ app }: { app: AppState }) {
  const status = useStatus();
  const router = status.data?.lanIp || 'the router’s address';
  return (
    <>
      <Panel title="How to use it">
        <ol className="app-steps">
          {(app.usage ?? []).map((step) => (
            <li key={step}>{withCode(step.replaceAll('{router}', router))}</li>
          ))}
        </ol>
      </Panel>
      {app.comingNext ? (
        <Panel title="Coming next">
          <Empty>{withCode(app.comingNext)}</Empty>
        </Panel>
      ) : null}
    </>
  );
}

/** `backticked` parts of a step become code. */
const withCode = (text: string) =>
  text.split(/`([^`]+)`/).map((part, i) =>
    i % 2 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed sentence never reorder
      <code key={i} className="mono">
        {part}
      </code>
    ) : (
      part
    ),
  );

/** A panel whose content needs its own query: loading, error and ready states. */
function QueryPanel<T>({ query, title, children }: { query: UseQueryResult<T>; title: string; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  return (
    <Panel title={title}>
      {query.isError ? (
        <Empty action={<Button onClick={() => query.refetch()}>Try again</Button>}>Couldn’t read this: {errorMessage(query.error)} </Empty>
      ) : (
        <output className="skeleton app-skeleton" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`} />
      )}
    </Panel>
  );
}

const VERB: Record<ServiceAction, [doing: string, done: string]> = {
  start: ['start', 'started'],
  stop: ['stop', 'stopped'],
  restart: ['restart', 'restarted'],
  enable: ['set to start at boot', 'starts at boot'],
  disable: ['set not to start at boot', 'no longer starts at boot'],
};

function ServicePanel({ app, name }: { app: AppState; name: string }) {
  const { toast } = useFeedback();
  const query = useQuery({ queryKey: ['service', name], queryFn: () => api.apps.service(name) });
  const act = useWrite((a: ServiceAction) => api.apps.serviceAction(name, a), [['service', name]]);
  async function go(a: ServiceAction) {
    const [doing, done] = VERB[a];
    try {
      await act.mutateAsync(a);
      toast(`${app.name} ${done}`);
    } catch (err) {
      toast(`Couldn’t ${doing} ${app.name}: ${errorMessage(err)}`);
    }
  }
  const button = (a: ServiceAction, label: string) => (
    <Button key={a} busy={act.isPending && act.variables === a} disabled={act.isPending} onClick={() => go(a)}>
      {label}
    </Button>
  );
  return (
    <QueryPanel query={query} title="Service">
      {(svc) =>
        svc === null ? (
          <Panel title="Service">
            <Empty>Its start-up script isn’t on the router, so there is nothing to start or stop.</Empty>
          </Panel>
        ) : (
          <Panel
            title="Service"
            actions={
              <span className="row-actions">
                {svc.running !== true ? button('start', 'Start') : null}
                {svc.running !== false ? button('stop', 'Stop') : null}
                {svc.running !== false ? button('restart', 'Restart') : null}
              </span>
            }
          >
            <KeyValues
              rows={[
                [
                  'Running',
                  svc.running === null ? (
                    <span key="r" className="muted">
                      Not shown: the router’s permissions hide it
                    </span>
                  ) : (
                    <Chip key="r" tone={svc.running ? 'ok' : undefined}>
                      {svc.running ? 'Running' : 'Stopped'}
                    </Chip>
                  ),
                ],
              ]}
            />
            <SwitchRow
              label="Start at boot"
              checked={svc.enabled}
              disabled={act.isPending}
              onChange={(on) => go(on ? 'enable' : 'disable')}
            />
          </Panel>
        )
      }
    </QueryPanel>
  );
}

function DrivePanel() {
  const query = useQuery({ queryKey: ['drives'], queryFn: api.apps.drives });
  return (
    <QueryPanel query={query} title="USB drive">
      {(drives) => (
        <Panel title="USB drive">
          {drives.length ? (
            <KeyValues
              rows={drives.map((d) => [
                d.mount,
                <span key={d.mount} className="num">
                  {bytes(d.free)} free of {bytes(d.size)}
                </span>,
              ])}
            />
          ) : (
            <Empty>No USB drive is mounted. Plug one into the router’s USB port to share its files.</Empty>
          )}
        </Panel>
      )}
    </QueryPanel>
  );
}

function AppSettings({ app }: { app: AppState }) {
  const qc = useQueryClient();
  const key = ['app-config', app.id];
  const query = useQuery({ queryKey: key, queryFn: () => api.apps.config(app) });
  return (
    <QueryPanel query={query} title="Settings">
      {(cfg) => (
        <>
          {app.fields && Object.keys(cfg.values).length ? (
            <AppSettingsForm app={app} cfg={cfg} save={async (values) => qc.setQueryData(key, await api.apps.saveConfig(app, values))} />
          ) : null}
          {app.records ? (
            <Panel title={app.records.title}>
              {cfg.records.length ? (
                <DataTable
                  label={app.records.title}
                  rows={cfg.records}
                  rowKey={(r) => JSON.stringify(r)}
                  columns={app.records.columns.map(
                    ([option, header], i): Column<Record<string, string>> => ({
                      key: option,
                      header,
                      phone: i === 0 ? 'title' : 'sub',
                      cell: (r) => <span className={i === 1 ? 'mono' : undefined}>{r[option] || '–'}</span>,
                    }),
                  )}
                />
              ) : (
                <Empty>{app.records.empty}</Empty>
              )}
            </Panel>
          ) : null}
        </>
      )}
    </QueryPanel>
  );
}

/** Lists are edited as comma-separated text. */
const toForm = (v: AppConfig['values'][string]) => (Array.isArray(v) ? v.join(', ') : v);

function AppSettingsForm({ app, cfg, save }: { app: AppState; cfg: AppConfig; save: (values: AppConfig['values']) => Promise<unknown> }) {
  const initial = Object.fromEntries(Object.entries(cfg.values).map(([k, v]) => [k, toForm(v)]));
  const form = useForm<Record<string, string | boolean>>(initial);
  const fields = (app.fields ?? []).filter((f) => f.key in cfg.values);
  return (
    <SettingsForm
      title="Settings"
      form={form}
      onSave={async () => {
        const changed: AppConfig['values'] = {};
        for (const f of fields) {
          const v = form.values[f.key];
          if (v === undefined || v === initial[f.key]) continue;
          changed[f.key] =
            f.kind === 'list'
              ? String(v)
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean)
              : typeof v === 'string'
                ? v.trim()
                : v;
        }
        await save(changed);
        return `${app.name} settings saved`;
      }}
    >
      {fields.map((f) => {
        const v = form.values[f.key];
        return f.kind === 'switch' ? (
          <SwitchRow key={f.key} label={f.label} hint={f.hint} checked={v === true} onChange={(x) => form.set(f.key, x)} />
        ) : (
          <TextField
            key={f.key}
            label={f.label}
            hint={f.hint}
            value={String(v ?? '')}
            mono={f.kind === 'list'}
            onChange={(x) => form.set(f.key, x)}
          />
        );
      })}
      {app.service ? <Note>Saving applies the change. If the service doesn’t pick it up, restart it under Service.</Note> : null}
    </SettingsForm>
  );
}
