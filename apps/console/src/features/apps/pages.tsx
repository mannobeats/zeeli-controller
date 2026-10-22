import {
  type Icon,
  IconActivity,
  IconBell,
  IconChartBar,
  IconChartLine,
  IconDeviceTv,
  IconFolders,
  IconGauge,
  IconPower,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconShieldLock,
  IconSpy,
  IconWorldWww,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { AppState, Package, TorConfig } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { AdvancedGate } from '../../ui/AdvancedGate.tsx';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Segmented, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, Empty, KeyValues, Note, PageHeader, Panel, Stack } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';

const APP_ICON: Record<string, Icon> = {
  adguard: IconShieldCheck,
  tailscale: IconShieldLock,
  zerotier: IconWorldWww,
  tor: IconSpy,
  ddns: IconWorldWww,
  bark: IconBell,
  dpi: IconActivity,
  samba: IconFolders,
  minidlna: IconDeviceTv,
  vnstat: IconChartLine,
  nlbwmon: IconChartBar,
  iperf3: IconGauge,
  wol: IconPower,
  banip: IconShieldLock,
};

/* ======================= App store ======================= */

type Filter = 'all' | 'installed' | 'available';

export function AppStorePage() {
  const { toast, confirm } = useFeedback();
  const query = useQuery({ queryKey: ['apps'], queryFn: api.apps.list });
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const install = useWrite((a: AppState) => api.apps.install(a), [['apps']]);
  const remove = useWrite((a: AppState) => api.apps.remove(a), [['apps']]);

  async function act(a: AppState) {
    if (a.installed && !a.builtIn) {
      if (
        !(await confirm({
          title: `Remove ${a.name}?`,
          body: 'Its packages are uninstalled. Settings it saved may stay on the router.',
          confirm: 'Remove',
        }))
      )
        return;
    }
    setBusy(a.id);
    try {
      if (a.installed) await remove.mutateAsync(a);
      else await install.mutateAsync(a);
      toast(`${a.name} ${a.installed ? 'removed' : 'installed'}`);
    } catch (err) {
      toast(`Couldn’t ${a.installed ? 'remove' : 'install'} ${a.name}: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  }

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
                          const I = APP_ICON[a.id] ?? IconActivity;
                          return (
                            <article className="app-tile" key={a.id}>
                              <span className={`app-icon app-${a.id}`}>
                                <I size={22} stroke={1.75} />
                              </span>
                              <div className="app-text">
                                <h3>{a.name}</h3>
                                <p>{a.summary}</p>
                              </div>
                              <div className="app-actions">
                                {a.builtIn ? (
                                  <Chip>{a.running === true ? 'Running' : 'Built in'}</Chip>
                                ) : a.installed ? (
                                  <Chip tone="ok">Installed</Chip>
                                ) : null}
                                <span className="grow" />
                                {a.page && a.installed ? <Button onClick={() => navigate(a.page ?? 'apps')}>Open</Button> : null}
                                {a.builtIn ? null : (
                                  <Button variant={a.installed ? 'ghost' : 'strong'} busy={busy === a.id} onClick={() => act(a)}>
                                    {a.installed ? 'Remove' : 'Install'}
                                  </Button>
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

/* ======================= Packages ======================= */

export function PackagesPage() {
  return (
    <AdvancedGate title="Packages">
      <PackagesBody />
    </AdvancedGate>
  );
}

function PackagesBody() {
  const { toast, confirm } = useFeedback();
  const installed = useQuery({ queryKey: ['packages'], queryFn: api.openwrt.packages.installed });
  const [showAll, setShowAll] = useState(false);
  const available = useQuery({ queryKey: ['packages-available'], queryFn: api.openwrt.packages.available, enabled: showAll });
  const [q, setQ] = useState('');
  const install = useWrite((name: string) => api.openwrt.packages.install(name), [['packages'], ['apps']]);
  const remove = useWrite((names: string[]) => Promise.all(names.map((n) => api.openwrt.packages.remove(n))), [['packages'], ['apps']]);
  const refresh = useWrite(() => api.openwrt.packages.refresh(), [['packages-available']]);
  const names = new Set((installed.data ?? []).map((p) => p.name));
  const needle = q.trim().toLowerCase();
  const list: Package[] = (showAll ? (available.data ?? []) : (installed.data ?? [])).filter(
    (p) => !needle || p.name.toLowerCase().includes(needle),
  );

  return (
    <Loaded query={installed} title="Packages">
      {(pkgs) => (
        <>
          <PageHeader
            title="Packages"
            sub={`${pkgs.length} installed. For curated apps, use the App store.`}
            actions={
              <Button
                icon={<IconRefresh size={16} />}
                busy={refresh.isPending}
                onClick={() =>
                  refresh.mutateAsync(undefined).then(
                    () => toast('Package list refreshed'),
                    (e) => toast(errorMessage(e)),
                  )
                }
              >
                Refresh list
              </Button>
            }
          />
          <Panel>
            <div className="toolbar">
              <Segmented
                label="Show"
                value={showAll ? 'all' : 'installed'}
                onChange={(v) => setShowAll(v === 'all')}
                options={[
                  ['installed', 'Installed'],
                  ['all', 'All available'],
                ]}
              />
              <label className="search">
                <IconSearch size={16} stroke={1.75} />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Package name"
                  aria-label="Search packages"
                />
              </label>
            </div>
            {showAll && available.isLoading ? <Note>Loading the full package list…</Note> : null}
            {list.length ? (
              <DataTable
                label="Packages"
                rows={list.slice(0, 300)}
                rowKey={(p) => p.name}
                bulk={
                  showAll
                    ? undefined
                    : [
                        {
                          label: 'Remove',
                          danger: true,
                          run: async (rows) => {
                            if (
                              !(await confirm({
                                title: `Remove ${rows.length === 1 ? rows[0]?.name : `${rows.length} packages`}?`,
                                body: 'Removing packages the firmware relies on can break features. Only remove what you installed yourself.',
                                confirm: 'Remove',
                              }))
                            )
                              return;
                            await remove.mutateAsync(rows.map((r) => r.name)).then(
                              () => toast('Removed'),
                              (e) => toast(errorMessage(e)),
                            );
                          },
                        },
                      ]
                }
                columns={[
                  { key: 'name', header: 'Package', phone: 'title', cell: (p) => <span className="name mono">{p.name}</span> },
                  { key: 'ver', header: 'Version', phone: 'sub', cell: (p) => <span className="mono muted">{p.version}</span> },
                  { key: 'desc', header: 'Description', cell: (p) => <span className="truncate">{p.description}</span> },
                  {
                    key: 'act',
                    header: '',
                    align: 'end',
                    phone: 'end',
                    cell: (p) =>
                      names.has(p.name) ? (
                        <Chip tone="ok">Installed</Chip>
                      ) : (
                        <Button
                          variant="ghost"
                          busy={install.isPending && install.variables === p.name}
                          onClick={() =>
                            install.mutateAsync(p.name).then(
                              () => toast(`Installed ${p.name}`),
                              (e) => toast(errorMessage(e)),
                            )
                          }
                        >
                          Install
                        </Button>
                      ),
                  },
                ]}
              />
            ) : (
              <Empty>{needle ? 'No package matches.' : 'Nothing here.'}</Empty>
            )}
            {list.length > 300 ? <Note>Showing the first 300. Search to narrow the list.</Note> : null}
          </Panel>
        </>
      )}
    </Loaded>
  );
}
