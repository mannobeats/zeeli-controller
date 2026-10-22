import { IconExternalLink, IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { NewTunnel, TailscaleConfig, Tunnel, TunnelFrom, TunnelTo, ZeroTierConfig } from '@zeeli/router-api';
import { useState } from 'react';
import { useClients, useStatus, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { ChipPicker, Row2, SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, Empty, Grid, KeyValues, Note, PageHeader, Panel, ToneText } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { TextArea } from '../../ui/TextArea.tsx';
import { byDevice, nextTunnelName, tunnelFrom, tunnelTo } from './tunnel.ts';

const running = (services: { name: string; running: boolean }[] | undefined, name: string) =>
  services?.find((s) => s.name === name)?.running ?? false;

/* ======================= Overview ======================= */

const State = ({ on, label }: { on: boolean; label?: string | undefined }) =>
  on ? <Chip tone="ok">{label ?? 'Running'}</Chip> : <ToneText tone="off">{label ?? 'Off'}</ToneText>;

const Go = ({ page, children }: { page: string; children: string }) => <Button onClick={() => navigate(page)}>{children}</Button>;

export function VpnOverviewPage() {
  return (
    <>
      <PageHeader title="VPN" sub="Reach home from anywhere, and send chosen devices through a VPN." />
      <Grid cols={2}>
        <TailscaleCard />
        <WireGuardCard />
        <ClientCard />
        <OpenVpnCard />
        <ZeroTierCard />
      </Grid>
    </>
  );
}

function TailscaleCard() {
  const ts = useQuery({ queryKey: ['ts-status'], queryFn: api.vpn.tailscale.status });
  const cfg = useQuery({ queryKey: ['tailscale'], queryFn: api.vpn.tailscale.config.get });
  const on = Boolean(cfg.data?.enabled);
  const up = ts.data?.status === 3;
  return (
    <Panel title="Tailscale" actions={<State on={on && up} label={on ? (up ? 'Connected' : 'Starting') : 'Off'} />}>
      <KeyValues
        rows={[
          ['Account', ts.data?.login_name ?? '—'],
          [
            'Tailnet address',
            <span key="a" className="mono">
              {ts.data?.address_v4 ?? '—'}
            </span>,
          ],
          ['Shares this network', cfg.data?.lan_enabled ? 'Yes' : 'No'],
        ]}
      />
      <div className="row-actions start">
        <Go page="tailscale">Manage</Go>
      </div>
    </Panel>
  );
}

function WireGuardCard() {
  const status = useStatus().data;
  const peers = useQuery({ queryKey: ['wg-peers'], queryFn: api.vpn.wireguard.peers });
  return (
    <Panel title="WireGuard server" actions={<State on={running(status?.services, 'wgserver')} />}>
      <KeyValues rows={[['Peers', String(peers.data?.length ?? 0)]]} />
      <div className="row-actions start">
        <Go page="wgserver">{peers.data?.length ? 'Peers and keys' : 'Add peers'}</Go>
      </div>
    </Panel>
  );
}

function ClientCard() {
  const tunnels = useQuery({ queryKey: ['tunnels'], queryFn: api.vpn.tunnels });
  const choices = useQuery({ queryKey: ['tunnel-choices'], queryFn: api.vpn.profileChoices });
  return (
    <Panel title="VPN client" actions={<State on={tunnels.data?.enabled ?? false} />}>
      <KeyValues
        rows={[
          ['Profiles', String(choices.data?.length ?? 0)],
          ['Tunnels', tunnels.data ? `${tunnels.data.tunnels.length} of ${tunnels.data.max}` : '—'],
        ]}
      />
      <div className="row-actions start">
        <Go page="profiles">{choices.data?.length ? 'Profiles' : 'Add a profile'}</Go>
        <Go page="tunnels">Tunnels</Go>
      </div>
    </Panel>
  );
}

function OpenVpnCard() {
  const status = useStatus().data;
  const cfg = useQuery({ queryKey: ['ovpn-config'], queryFn: api.vpn.openvpn.config });
  return (
    <Panel
      title="OpenVPN server"
      actions={<State on={running(status?.services, 'ovpnserver')} label={cfg.data?.initialization ? undefined : 'Not set up'} />}
    >
      <Note>For devices that only speak OpenVPN.</Note>
      <div className="row-actions start">
        <Go page="ovpnserver">{cfg.data?.initialization ? 'Manage' : 'Set up'}</Go>
      </div>
    </Panel>
  );
}

function ZeroTierCard() {
  const zt = useQuery({ queryKey: ['zerotier'], queryFn: api.vpn.zerotier.get });
  return (
    <Panel title="ZeroTier" actions={<State on={zt.data?.enabled ?? false} label={zt.data?.enabled ? 'On' : 'Off'} />}>
      <div className="row-actions start">
        <Go page="zerotier">Manage</Go>
      </div>
    </Panel>
  );
}

/* ======================= Tunnels ======================= */

const FROM: Record<TunnelFrom, string> = {
  default: 'All devices',
  mac: 'Only chosen devices',
  exclude_mac: 'All devices except chosen',
  interface: 'Chosen networks',
};
const TO: Record<TunnelTo, string> = { default: 'Every site', domain: 'Only these sites', exclude_domain: 'Every site except these' };
const NETS: Record<string, string> = { lan: 'Main LAN', wan: 'Wired to the WAN port', guest: 'Guest network', iot: 'IoT network' };

export function TunnelsPage() {
  const { toast, confirm } = useFeedback();
  const query = useQuery({
    queryKey: ['tunnels-page'],
    queryFn: async () => ({
      state: await api.vpn.tunnels(),
      choices: await api.vpn.profileChoices(),
      methods: await api.vpn.connectionMethods(),
    }),
  });
  const [adding, setAdding] = useState(false);
  const remove = useWrite((ids: number[]) => api.vpn.removeTunnels(ids), [['tunnels-page'], ['tunnels']]);
  const fall = useWrite((on: boolean) => api.vpn.setFallthrough(on), [['tunnels-page']]);
  return (
    <Loaded query={query} title="Tunnels">
      {({ state, choices, methods }) => (
        <>
          <PageHeader
            title="VPN tunnels"
            sub="Which devices and sites go through which VPN profile."
            actions={
              choices.length && state.tunnels.length < state.max ? (
                <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setAdding(true)}>
                  New tunnel
                </Button>
              ) : null
            }
          />
          <Panel title="Tunnels" note={`${state.tunnels.length} of ${state.max}${state.enabled ? '' : ', VPN client off'}`}>
            {state.tunnels.length ? (
              <DataTable
                label="Tunnels"
                rows={state.tunnels}
                rowKey={(t) => String(t.id)}
                rowClass={(t) => (t.enabled ? undefined : 'off')}
                bulk={[
                  {
                    label: 'Delete',
                    danger: true,
                    run: async (list: Tunnel[]) => {
                      if (
                        !(await confirm({
                          title: `Delete ${list.length === 1 ? list[0]?.name : plural(list.length, 'tunnel')}?`,
                          body: 'Devices they covered stop using the VPN.',
                          confirm: 'Delete',
                        }))
                      )
                        return;
                      try {
                        await remove.mutateAsync(list.map((t) => t.id));
                        toast('Deleted');
                      } catch (err) {
                        toast(`Couldn’t delete: ${errorMessage(err)}`);
                      }
                    },
                  },
                ]}
                columns={[
                  { key: 'name', header: 'Tunnel', phone: 'title', cell: (t) => <span className="name">{t.name}</span> },
                  { key: 'who', header: 'Who', phone: 'sub', cell: (t) => FROM[t.from.type] ?? t.from.type },
                  { key: 'sites', header: 'Sites', cell: (t) => TO[t.to.type] ?? t.to.type },
                  {
                    key: 'via',
                    header: 'Through',
                    cell: (t) => (t.via.via === 'novpn' ? 'No VPN' : t.via.type === 'wireguard' ? 'WireGuard profile' : 'OpenVPN profile'),
                  },
                  {
                    key: 'ks',
                    header: 'Kill switch',
                    align: 'end',
                    phone: 'end',
                    cell: (t) => (t.killswitch ? 'On' : <ToneText tone="off">Off</ToneText>),
                  },
                ]}
              />
            ) : (
              <Empty>
                {choices.length ? 'No tunnels. Add one to send devices through a VPN profile.' : 'No tunnels, and no VPN profiles yet. '}
                {choices.length ? null : (
                  <button type="button" className="link" onClick={() => navigate('profiles')}>
                    Add a profile first
                  </button>
                )}
              </Empty>
            )}
          </Panel>
          <div className="section-gap">
            <FallthroughForm on={state.fallthrough} save={(on) => fall.mutateAsync(on)} />
          </div>
          {adding ? <TunnelSheet choices={choices} methods={methods} existing={state.tunnels} onClose={() => setAdding(false)} /> : null}
        </>
      )}
    </Loaded>
  );
}

function FallthroughForm({ on, save }: { on: boolean; save: (on: boolean) => Promise<unknown> }) {
  const form = useForm({ on });
  return (
    <SettingsForm
      title="Everything else"
      form={form}
      onSave={async () => {
        await save(form.values.on);
        return form.values.on ? 'Other traffic goes out normally' : 'Other traffic is blocked';
      }}
    >
      <SwitchRow
        label="Traffic no tunnel matches goes out normally"
        hint="Off blocks it instead, so nothing leaks outside the VPN."
        checked={form.values.on}
        onChange={(x) => form.set('on', x)}
      />
    </SettingsForm>
  );
}

function TunnelSheet({
  choices,
  methods,
  existing,
  onClose,
}: {
  choices: { value: string; label: string }[];
  methods: string[];
  existing: Tunnel[];
  onClose: () => void;
}) {
  const { toast } = useFeedback();
  const devices = [...(useClients().data ?? [])].sort((a, b) => Number(b.online) - Number(a.online));
  const fallback = nextTunnelName(existing);
  const [name, setName] = useState(fallback);
  const [profile, setProfile] = useState(choices[0]?.value ?? '');
  const [from, setFrom] = useState<TunnelFrom>('default');
  const [macs, setMacs] = useState<string[]>([]);
  const [nets, setNets] = useState<string[]>(['lan']);
  const [to, setTo] = useState<TunnelTo>('default');
  const [domains, setDomains] = useState('');
  const add = useWrite((t: NewTunnel) => api.vpn.addTunnel(t), [['tunnels-page'], ['tunnels']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="New VPN tunnel"
      sub="Send chosen devices, networks or sites through a VPN profile."
      save="Add tunnel"
      onSave={async () => {
        const body = { from: tunnelFrom(from, macs, nets), to: tunnelTo(to, domains) };
        await add.mutateAsync({ name: name.trim() || fallback, ...body, profile });
        toast(`Added ${name}`);
      }}
    >
      <TextField label="Name" value={name} onChange={setName} />
      <SelectField label="Through" value={profile} options={choices.map((c) => [c.value, c.label] as const)} onChange={setProfile} />
      <SelectField label="For" value={from} options={Object.entries(FROM) as [TunnelFrom, string][]} onChange={setFrom} />
      {byDevice(from) ? (
        <ChipPicker legend="Devices" options={devices.map((d) => [d.mac, d.name] as const)} value={macs} onChange={setMacs} />
      ) : null}
      {from === 'interface' ? (
        <ChipPicker legend="Networks" options={methods.map((m) => [m, NETS[m] ?? m] as const)} value={nets} onChange={setNets} />
      ) : null}
      <SelectField label="For sites" value={to} options={Object.entries(TO) as [TunnelTo, string][]} onChange={setTo} />
      {to === 'default' ? null : (
        <TextArea label="Sites, one per line" value={domains} onChange={setDomains} rows={4} placeholder="netflix.com" />
      )}
    </Sheet>
  );
}

/* ======================= Client profiles ======================= */

export function ProfilesPage() {
  const query = useQuery({ queryKey: ['vpn-groups'], queryFn: api.vpn.groups });
  const [importing, setImporting] = useState(false);
  return (
    <Loaded query={query} title="Client profiles">
      {(groups) => {
        const total = groups.reduce((n, g) => n + g.count, 0);
        return (
          <>
            <PageHeader
              title="VPN client profiles"
              sub={`${plural(total, 'profile')} in ${plural(groups.filter((g) => g.count).length, 'group')}.`}
              actions={
                <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setImporting(true)}>
                  Import profile
                </Button>
              }
            />
            <Panel title="Groups" note="Provider accounts (NordVPN, Mullvad…) sign in through the firmware’s own setup">
              <DataTable
                label="Profile groups"
                rows={[...groups].sort((a, b) => b.count - a.count)}
                rowKey={(g) => `${g.kind}-${g.id}`}
                rowClass={(g) => (g.count ? undefined : 'off')}
                columns={[
                  { key: 'name', header: 'Group', phone: 'title', cell: (g) => <span className="name">{g.name}</span> },
                  {
                    key: 'kind',
                    header: 'Type',
                    phone: 'sub',
                    cell: (g) => `${g.kind === 'wireguard' ? 'WireGuard' : 'OpenVPN'}${g.type === 1 ? ' provider' : ''}`,
                  },
                  { key: 'count', header: 'Profiles', align: 'end', phone: 'end', cell: (g) => <span className="num">{g.count}</span> },
                ]}
              />
            </Panel>
            {importing ? <ImportSheet groups={groups} onClose={() => setImporting(false)} /> : null}
          </>
        );
      }}
    </Loaded>
  );
}

function ImportSheet({ groups, onClose }: { groups: Awaited<ReturnType<typeof api.vpn.groups>>; onClose: () => void }) {
  const { toast } = useFeedback();
  const [kind, setKind] = useState<'wireguard' | 'openvpn'>('wireguard');
  const custom = groups.filter((g) => g.kind === kind && g.type !== 1 && g.type !== 3);
  const [group, setGroup] = useState<string>('new');
  const [newName, setNewName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const run = useWrite(async () => {
    const f = file ?? (text.trim() ? new File([`${text.trim()}\n`], kind === 'wireguard' ? 'profile.conf' : 'profile.ovpn') : null);
    if (!f) throw new Error('Choose a file or paste the profile.');
    if (group === 'new' && !newName.trim()) throw new Error('Name the new group.');
    await api.vpn.importProfile(
      kind,
      group === 'new' ? { newName: newName.trim() } : { id: Number(group) },
      f,
      kind === 'openvpn' ? { username: user, password: pass } : undefined,
    );
  }, [['vpn-groups'], ['tunnel-choices']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Import a VPN profile"
      sub="From your VPN provider’s website or another router. Profiles land in a group you can use in tunnels."
      save="Import"
      onSave={async () => {
        await run.mutateAsync(undefined);
        toast('Profile imported');
      }}
    >
      <SelectField
        label="Type"
        value={kind}
        options={[
          ['wireguard', 'WireGuard (.conf)'],
          ['openvpn', 'OpenVPN (.ovpn)'],
        ]}
        onChange={(k) => {
          setKind(k);
          setGroup('new');
        }}
      />
      <SelectField
        label="Group"
        value={group}
        options={[...custom.map((g) => [String(g.id), g.name] as const), ['new', 'New group…'] as const]}
        onChange={setGroup}
      />
      {group === 'new' ? <TextField label="New group name" value={newName} onChange={setNewName} placeholder="Home VPN" /> : null}
      <label className="input">
        Profile file
        <span className="box">
          <input type="file" accept=".conf,.ovpn,.zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </span>
        <span className="hint">Or paste it below.</span>
      </label>
      <TextArea label="Profile text" value={text} onChange={setText} mono rows={6} placeholder={'[Interface]\nPrivateKey = …'} />
      {kind === 'openvpn' ? (
        <Row2>
          <TextField label="Username" value={user} onChange={setUser} hint="If the provider needs one" />
          <TextField label="Password" type="password" value={pass} onChange={setPass} />
        </Row2>
      ) : null}
    </Sheet>
  );
}

/* ======================= Tailscale ======================= */

export function TailscalePage() {
  const { query, save } = useSettings('tailscale', api.vpn.tailscale.config);
  const status = useQuery({ queryKey: ['ts-status'], queryFn: api.vpn.tailscale.status, refetchInterval: 15_000 });
  const nodes = useQuery({ queryKey: ['ts-exit'], queryFn: api.vpn.tailscale.exitNodes });
  const auth = useQuery({ queryKey: ['ts-auth'], queryFn: api.vpn.tailscale.authUrl });
  const { toast, confirm } = useFeedback();
  const signOut = useWrite(() => api.vpn.tailscale.signOut(), [['ts-status']]);
  const s = status.data;
  return (
    <Loaded query={query} title="Tailscale">
      {(cfg) => (
        <>
          <PageHeader title="Tailscale" sub="Reach your home network from anywhere over WireGuard, without opening ports." />
          <Grid cols={2}>
            <Panel
              title={s?.login_name ?? 'Not signed in'}
              actions={s?.status === 3 ? <Chip tone="ok">Connected</Chip> : <ToneText tone="off">Off</ToneText>}
            >
              <KeyValues
                rows={[
                  [
                    'Tailnet address',
                    <span key="a" className="mono">
                      {s?.address_v4 ?? '—'}
                    </span>,
                  ],
                  [
                    'DNS',
                    <span key="d" className="mono">
                      {(s?.dns ?? []).join(', ') || '—'}
                    </span>,
                  ],
                ]}
              />
              <div className="row-actions start">
                {auth.data ? (
                  <a className="btn strong" href={auth.data} target="_blank" rel="noopener noreferrer">
                    Sign in to Tailscale <IconExternalLink size={14} />
                  </a>
                ) : null}
                {s?.login_name ? (
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: 'Sign out of Tailscale?',
                          body: 'This router leaves your tailnet until you sign in again.',
                          confirm: 'Sign out',
                        }))
                      )
                        return;
                      await signOut.mutateAsync(undefined).catch((e) => toast(errorMessage(e)));
                      toast('Signed out of Tailscale');
                    }}
                  >
                    Sign out
                  </Button>
                ) : null}
              </div>
            </Panel>
            <TailscaleForm cfg={cfg} save={save} exitNodes={nodes.data ?? []} />
          </Grid>
        </>
      )}
    </Loaded>
  );
}

function TailscaleForm({
  cfg,
  save,
  exitNodes,
}: {
  cfg: TailscaleConfig;
  save: (v: Partial<TailscaleConfig>) => Promise<unknown>;
  exitNodes: { ip?: string; address?: string; name?: string; host_name?: string }[];
}) {
  const { confirm } = useFeedback();
  const form = useForm({
    enabled: cfg.enabled,
    lan_enabled: cfg.lan_enabled,
    wan_enabled: cfg.wan_enabled,
    run_exit_node: cfg.run_exit_node,
    exit_node_ip: cfg.exit_node_ip ?? '',
  });
  const v = form.values;
  return (
    <SettingsForm
      title="Settings"
      form={form}
      onSave={async () => {
        if (
          !v.enabled &&
          cfg.enabled &&
          !(await confirm({
            title: 'Turn off Tailscale?',
            body: 'Anything reaching this network through Tailscale loses access, including you if you’re remote.',
            confirm: 'Turn off',
          }))
        )
          return false;
        await save({ ...cfg, ...v });
        return 'Tailscale saved';
      }}
    >
      <SwitchRow label="Tailscale on" checked={v.enabled} onChange={(x) => form.set('enabled', x)} />
      <SwitchRow
        label={`Share this network${cfg.lan_ip ? ` (${cfg.lan_ip})` : ''}`}
        hint="Approve the route in the Tailscale admin console."
        checked={v.lan_enabled}
        onChange={(x) => form.set('lan_enabled', x)}
      />
      <SwitchRow label="Reach the internet side through Tailscale" checked={v.wan_enabled} onChange={(x) => form.set('wan_enabled', x)} />
      <SwitchRow label="Offer this router as an exit node" checked={v.run_exit_node} onChange={(x) => form.set('run_exit_node', x)} />
      {exitNodes.length ? (
        <SelectField
          label="Send this router’s traffic through"
          value={v.exit_node_ip}
          options={[['', 'No exit node'], ...exitNodes.map((n) => [n.ip ?? n.address ?? '', n.name ?? n.host_name ?? n.ip ?? ''] as const)]}
          onChange={(x) => form.set('exit_node_ip', x)}
        />
      ) : null}
    </SettingsForm>
  );
}

/* ======================= ZeroTier ======================= */

export function ZeroTierPage() {
  const { query, save } = useSettings('zerotier', api.vpn.zerotier);
  return (
    <Loaded query={query} title="ZeroTier">
      {(cfg) => (
        <>
          <PageHeader title="ZeroTier" sub="Join this router to a ZeroTier virtual network." />
          <ZeroTierForm cfg={cfg} save={save} />
        </>
      )}
    </Loaded>
  );
}

function ZeroTierForm({ cfg, save }: { cfg: ZeroTierConfig; save: (v: Partial<ZeroTierConfig>) => Promise<unknown> }) {
  const form = useForm({
    enabled: cfg.enabled,
    id: cfg.id ?? '',
    lan_enabled: cfg.lan_enabled ?? false,
    wan_enabled: cfg.wan_enabled ?? false,
  });
  const v = form.values;
  return (
    <SettingsForm
      title="ZeroTier"
      form={form}
      onSave={async () => {
        if (v.enabled && !/^[0-9a-f]{16}$/i.test(v.id)) throw new Error('A ZeroTier network ID is 16 hex characters.');
        await save(v.enabled ? v : { enabled: false });
        return `ZeroTier ${v.enabled ? 'on' : 'off'}`;
      }}
    >
      <SwitchRow label="ZeroTier on" checked={v.enabled} onChange={(x) => form.set('enabled', x)} />
      <TextField label="Network ID" mono value={v.id} onChange={(x) => form.set('id', x)} placeholder="16 hex characters" />
      <SwitchRow label="Members can reach this LAN" checked={v.lan_enabled} onChange={(x) => form.set('lan_enabled', x)} />
      <SwitchRow label="Members can use this internet connection" checked={v.wan_enabled} onChange={(x) => form.set('wan_enabled', x)} />
    </SettingsForm>
  );
}
