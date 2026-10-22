import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { TorConfig } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { appPageId } from '../../app/nav.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { AdvancedGate } from '../../ui/AdvancedGate.tsx';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Segmented, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, Empty, KeyValues, PageHeader, Panel, Stack } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { AppIcon, useAppChange, WaitNote } from './common.tsx';

/* ======================= App store ======================= */

type Filter = 'all' | 'installed' | 'available';

export function AppStorePage() {
  const query = useQuery({ queryKey: ['apps'], queryFn: api.apps.list });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const { run, busy } = useAppChange();

  return (
    <AdvancedGate title="App store">
      <Loaded query={query} title="App store">
        {(apps) => {
          const needle = q.trim().toLowerCase();
          const shown = apps.filter(
            (a) =>
              (filter === 'all' || (filter === 'installed') === a.installed) &&
              (!needle || `${a.name} ${a.summary} ${a.category}`.toLowerCase().includes(needle)),
          );
          const categories = [...new Set(shown.map((a) => a.category))];
          return (
            <>
              <PageHeader title="App store" sub="Add features to your router. Apps run on the router itself, not in a cloud." />
              <WaitNote busy={busy} />
              <div className="toolbar">
                <Segmented
                  label="Show"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    ['all', 'All'],
                    ['installed', `Installed ${apps.filter((a) => a.installed).length}`],
                    ['available', 'Available'],
                  ]}
                />
                <label className="search">
                  <IconSearch size={16} stroke={1.75} />
                  <input
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search apps"
                    aria-label="Search apps"
                  />
                </label>
              </div>
              {categories.length ? (
                categories.map((cat) => (
                  <section key={cat} className="app-section">
                    <h2 className="app-cat">{cat}</h2>
                    <div className="app-grid">
                      {shown
                        .filter((a) => a.category === cat)
                        .map((a) => {
                          const open = () => navigate(appPageId(a));
                          return (
                            <article className="app-tile" key={a.id}>
                              <AppIcon id={a.id} />
                              <div className="app-text">
                                <h3>{a.name}</h3>
                                <p>{a.summary}</p>
                              </div>
                              <div className="app-actions">
                                {a.running === true ? (
                                  <Chip tone="ok">Running</Chip>
                                ) : a.installed ? (
                                  <Chip>{a.builtIn ? 'Built in' : 'Installed'}</Chip>
                                ) : null}
                                <span className="grow" />
                                {a.installed ? (
                                  <Button onClick={open}>Open</Button>
                                ) : (
                                  <>
                                    <Button variant="ghost" onClick={open}>
                                      Details
                                    </Button>
                                    <Button
                                      variant="strong"
                                      busy={busy?.id === a.id}
                                      disabled={busy !== null}
                                      onClick={() => run(a, false)}
                                    >
                                      {busy?.id === a.id ? 'Installing…' : 'Install'}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </article>
                          );
                        })}
                    </div>
                  </section>
                ))
              ) : (
                <Empty>No apps match.</Empty>
              )}
            </>
          );
        }}
      </Loaded>
    </AdvancedGate>
  );
}

/* ======================= Tor ======================= */

export function TorPage() {
  const { query, save } = useSettings('tor', api.vpn.tor);
  return (
    <Loaded query={query} title="Tor">
      {(cfg) => (
        <>
          <PageHeader title="Tor" sub="Send this network’s traffic through Tor for anonymity." />
          <TorForm cfg={cfg} save={save} />
        </>
      )}
    </Loaded>
  );
}

function TorForm({ cfg, save }: { cfg: TorConfig; save: (v: Partial<TorConfig>) => Promise<unknown> }) {
  const form = useForm({ enable: cfg.enable, manual: cfg.manual, countries: (cfg.countries ?? []).join(', ') });
  const v = form.values;
  return (
    <SettingsForm
      title="Tor"
      form={form}
      onSave={async () => {
        const countries = v.countries
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((c) => c.toLowerCase());
        if (v.manual && (!countries.length || countries.some((c) => !/^[a-z]{2}$/.test(c))))
          throw new Error('Use two-letter country codes, like de or ch.');
        await save({ enable: v.enable, manual: v.manual, ...(v.manual ? { countries } : {}) });
        return `Tor ${v.enable ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow
        label="Route traffic through Tor"
        hint="Much slower, and many sites block Tor exits. While on, the VPN client and some features stop."
        checked={v.enable}
        onChange={(x) => form.set('enable', x)}
      />
      <SwitchRow label="Pick exit countries" checked={v.manual} onChange={(x) => form.set('manual', x)} />
      {v.manual ? (
        <TextField
          label="Countries, comma separated two-letter codes"
          value={v.countries}
          onChange={(x) => form.set('countries', x)}
          placeholder="de, ch, is"
        />
      ) : null}
    </SettingsForm>
  );
}

/* ======================= Dynamic DNS ======================= */

export function DdnsPage() {
  const { query, save } = useSettings('ddns', api.device.ddns);
  const addr = useQuery({ queryKey: ['public-addresses-raw'], queryFn: api.device.addresses });
  return (
    <Loaded query={query} title="Dynamic DNS">
      {(cfg) => (
        <>
          <PageHeader title="Dynamic DNS" sub="A stable name for your home connection, even when its address changes." />
          <Stack>
            <Panel title="Your address">
              <KeyValues
                rows={[
                  [
                    'Name',
                    <span key="n" className="mono">
                      {addr.data?.domain?.[0] ?? `${cfg.device_id}.glddns.com`}
                    </span>,
                  ],
                  [
                    'Public IP',
                    <span key="p" className="mono">
                      {addr.data?.pub_ip?.[0] ?? '–'}
                    </span>,
                  ],
                ]}
              />
            </Panel>
            <DdnsForm on={cfg.enable_ddns} save={(on) => save({ ...cfg, enable_ddns: on })} />
          </Stack>
        </>
      )}
    </Loaded>
  );
}

function DdnsForm({ on, save }: { on: boolean; save: (on: boolean) => Promise<unknown> }) {
  const form = useForm({ on });
  return (
    <SettingsForm
      title="GL.iNet Dynamic DNS"
      form={form}
      onSave={async () => {
        await save(form.values.on);
        return `Dynamic DNS ${form.values.on ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow
        label="Keep this name pointed at my public IP"
        hint="Lets you reach the router or its VPN server from outside by name."
        checked={form.values.on}
        onChange={(x) => form.set('on', x)}
      />
    </SettingsForm>
  );
}

/* ======================= Bark ======================= */

export function BarkPage() {
  const { query, save } = useSettings('bark', api.device.bark);
  const status = useQuery({ queryKey: ['bark-status'], queryFn: api.device.barkStatus });
  return (
    <Loaded query={query} title="Bark">
      {(cfg) => (
        <>
          <PageHeader title="Bark" sub="Bark’s parental monitoring service, linked to your Bark account." />
          <BarkForm cfg={cfg} save={save} code={status.data?.pairing_code} />
        </>
      )}
    </Loaded>
  );
}

function BarkForm({
  cfg,
  save,
  code,
}: {
  cfg: { enable: boolean; ipv6_enable: boolean };
  save: (v: { enable: boolean; ipv6_enable: boolean }) => Promise<unknown>;
  code: string | undefined;
}) {
  const form = useForm(cfg);
  return (
    <SettingsForm
      title="Bark"
      form={form}
      onSave={async () => {
        await save(form.values);
        return `Bark ${form.values.enable ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow label="Bark on" checked={form.values.enable} onChange={(x) => form.set('enable', x)} />
      <SwitchRow label="Also cover IPv6" checked={form.values.ipv6_enable} onChange={(x) => form.set('ipv6_enable', x)} />
      {code ? (
        <KeyValues
          rows={[
            [
              'Pairing code',
              <span key="c" className="mono">
                {code}
              </span>,
            ],
          ]}
        />
      ) : null}
    </SettingsForm>
  );
}

/* ======================= App detection (DPI) ======================= */

export function DpiPage() {
  const { toast } = useFeedback();
  const query = useQuery({ queryKey: ['dpi'], queryFn: api.traffic.dpi });
  const engine = useWrite(() => api.traffic.updateEngine(), [['dpi']]);
  const sigs = useWrite(() => api.traffic.updateSignatures(), [['dpi']]);
  const run = (w: typeof engine, label: string) => async () => {
    toast(`Updating ${label}…`);
    try {
      await w.mutateAsync(undefined);
      toast(`${label} updated`);
    } catch (err) {
      toast(`Update failed: ${errorMessage(err)}`);
    }
  };
  return (
    <Loaded query={query} title="App detection">
      {(d) => (
        <>
          <PageHeader title="App detection" sub="The engine behind per-app statistics, QoS and app blocking." />
          <Panel>
            <KeyValues
              rows={[
                [
                  'Engine',
                  <span key="e" className="row-actions">
                    {d.engine}
                    {d.engineUpdate ? (
                      <Button busy={engine.isPending} onClick={run(engine, 'The detection engine')}>
                        Update to {d.engineUpdate}
                      </Button>
                    ) : (
                      <span className="tone-ok">Up to date</span>
                    )}
                  </span>,
                ],
                [
                  'App signatures',
                  <span key="s" className="row-actions">
                    {d.signatures}
                    {d.signaturesUpdate ? (
                      <Button busy={sigs.isPending} onClick={run(sigs, 'App signatures')}>
                        Update to {d.signaturesUpdate}
                      </Button>
                    ) : (
                      <span className="tone-ok">Up to date</span>
                    )}
                  </span>,
                ],
              ]}
            />
          </Panel>
        </>
      )}
    </Loaded>
  );
}
