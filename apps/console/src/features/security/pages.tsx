import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  type AccessRule,
  CONTENT_CATEGORIES,
  type ContentFilter,
  type Dmz,
  isIpv4,
  type LocalAccess,
  type PortForward,
  type RemoteAccess,
  type Zones,
} from '@zeeli/router-api';
import { type ComponentType, useState } from 'react';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { checkRulePort } from '../../lib/rules.ts';
import { Button } from '../../ui/Button.tsx';
import { stateColumn } from '../../ui/columns.tsx';
import { type Column, DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { ChipPicker, Row2, SelectField, Switch, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Empty, Note, PageHeader, Panel, Stack } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { TextArea } from '../../ui/TextArea.tsx';
import { PolicyNote } from '../policies/AgentNote.tsx';
import { checkForwardPorts } from './forward.ts';

const ZONE: Record<string, string> = { wan: 'Internet', lan: 'Main LAN', guest: 'Guest', iot: 'IoT' };
const zone = (z: string) => ZONE[z] ?? z;
const PROTO = [
  ['tcp udp', 'TCP and UDP'],
  ['tcp', 'TCP'],
  ['udp', 'UDP'],
] as const;
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

type Rule = { id: string; name: string; enabled: boolean };

/** A list of rules with an on/off switch per row, plus bulk on, off and delete. */
function RuleTable<R extends Rule>({
  label,
  rows,
  columns,
  onEdit,
  setOn,
  remove,
  busy,
}: {
  label: string;
  rows: R[];
  columns: Column<R>[];
  onEdit: (r: R) => void;
  setOn: (list: R[], on: boolean) => void;
  remove: (list: R[]) => void;
  busy: boolean;
}) {
  return (
    <DataTable
      label={label}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={onEdit}
      rowClass={(r) => (r.enabled ? undefined : 'off')}
      bulk={[
        { label: 'Turn on', run: (l) => setOn(l, true), when: (l) => l.some((r) => !r.enabled) },
        { label: 'Turn off', run: (l) => setOn(l, false), when: (l) => l.some((r) => r.enabled) },
        { label: 'Delete', danger: true, run: remove },
      ]}
      columns={[
        ...columns,
        {
          key: 'on',
          header: 'On',
          align: 'end',
          phone: 'end',
          cell: (r) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: keeps the row from opening when the switch is used
            // biome-ignore lint/a11y/useKeyWithClickEvents: the switch handles keys
            <span onClick={stop}>
              <Switch checked={r.enabled} label={`${r.name} on`} onChange={(on) => setOn([r], on)} disabled={busy} />
            </span>
          ),
        },
      ]}
    />
  );
}

/** The add or edit sheet for the rule being edited. Deleting from it closes the sheet first. */
function EditingSheet<R extends Rule>({
  sheet: RuleSheet,
  editing,
  zones,
  close,
  remove,
}: {
  sheet: ComponentType<{ rule: R | null; zones: Zones; onClose: () => void; onDelete: (r: R) => void }>;
  editing: R | 'new' | null;
  zones: Zones;
  close: () => void;
  remove: (list: R[]) => void;
}) {
  if (!editing) return null;
  return (
    <RuleSheet
      key={editing === 'new' ? 'new' : editing.id}
      rule={editing === 'new' ? null : editing}
      zones={zones}
      onClose={close}
      onDelete={(r) => {
        close();
        remove([r]);
      }}
    />
  );
}

/* ======================= Port forwarding ======================= */

export function ForwardingPage() {
  const { toast, confirm } = useFeedback();
  const clients = useClients().data ?? [];
  const query = useQuery({
    queryKey: ['forwards'],
    queryFn: async () => ({ rules: await api.security.forwards(), zones: await api.security.zones() }),
  });
  const dmz = useSettings('dmz', api.security.dmz);
  const [editing, setEditing] = useState<PortForward | 'new' | null>(null);
  const [dmzOpen, setDmzOpen] = useState(false);
  const enable = useWrite(
    ({ list, on }: { list: PortForward[]; on: boolean }) => api.security.setForwardsEnabled(list, on),
    [['forwards']],
  );
  const remove = useWrite((list: PortForward[]) => api.security.removeForwards(list), [['forwards']]);
  const who = (ip: string) => clients.find((c) => c.ip === ip)?.name ?? '';

  async function setOn(list: PortForward[], on: boolean) {
    try {
      await enable.mutateAsync({ list, on });
      toast(`${list.length === 1 ? list[0]?.name || 'Rule' : plural(list.length, 'rule')} turned ${on ? 'on' : 'off'}`);
    } catch (err) {
      toast(`Couldn’t change the rules: ${errorMessage(err)}`);
    }
  }
  async function removeAll(list: PortForward[]) {
    const what = list.length === 1 ? list[0]?.name || 'this rule' : plural(list.length, 'rule');
    if (!(await confirm({ title: `Delete ${what}?`, body: 'Those ports stop reaching their devices.', confirm: 'Delete' }))) return;
    try {
      await remove.mutateAsync(list);
      toast(`Deleted ${what}`);
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  return (
    <Loaded query={query} title="Port forwarding">
      {({ rules, zones }) => (
        <>
          <PageHeader
            title="Port forwarding"
            actions={
              <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                New rule
              </Button>
            }
          />
          <Panel>
            {rules.length ? (
              <RuleTable
                label="Port forwards"
                rows={rules}
                onEdit={setEditing}
                setOn={setOn}
                remove={removeAll}
                busy={enable.isPending}
                columns={[
                  { key: 'name', header: 'Rule', phone: 'title', cell: (r) => <span className="name">{r.name || 'Untitled rule'}</span> },
                  { key: 'out', header: 'Outside port', phone: 'sub', cell: (r) => <span className="mono">{r.srcPort}</span> },
                  {
                    key: 'to',
                    header: 'Goes to',
                    cell: (r) => (
                      <>
                        <span className="mono">
                          {r.destIp}:{r.destPort}
                        </span>{' '}
                        <span className="muted">{who(r.destIp)}</span>
                      </>
                    ),
                  },
                  { key: 'proto', header: 'Protocol', cell: (r) => PROTO.find(([p]) => p === r.proto)?.[1] ?? r.proto },
                ]}
              />
            ) : (
              <Empty>No port forwards. Add one to reach a device on your network from the internet.</Empty>
            )}
          </Panel>
          <Panel
            className="section"
            title="DMZ host"
            note={dmz.query.data?.enabled ? `Unmatched incoming traffic goes to ${dmz.query.data.dest_ip}` : 'Off'}
            actions={<Button onClick={() => setDmzOpen(true)}>{dmz.query.data?.enabled ? 'Change DMZ' : 'Set up DMZ'}</Button>}
          />
          <EditingSheet sheet={ForwardSheet} editing={editing} zones={zones} close={() => setEditing(null)} remove={removeAll} />
          {dmzOpen && dmz.query.data ? <DmzSheet dmz={dmz.query.data} save={dmz.save} onClose={() => setDmzOpen(false)} /> : null}
        </>
      )}
    </Loaded>
  );
}

function ForwardSheet({
  rule,
  zones,
  onClose,
  onDelete,
}: {
  rule: PortForward | null;
  zones: Zones;
  onClose: () => void;
  onDelete: (r: PortForward) => void;
}) {
  const { toast } = useFeedback();
  const clients = (useClients().data ?? []).filter((c) => c.online);
  const [v, setV] = useState<Omit<PortForward, 'id'>>(
    rule ?? { name: '', proto: 'tcp udp', src: 'wan', srcPort: '', dest: 'lan', destIp: '', destPort: '', enabled: true },
  );
  const set =
    <K extends keyof typeof v>(k: K) =>
    (value: (typeof v)[K]) =>
      setV((x) => ({ ...x, [k]: value }));
  const save = useWrite(() => api.security.saveForward(v, rule?.id), [['forwards']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule ? rule.name || 'Port forward' : 'New port forward'}
      save={rule ? 'Save' : 'Add rule'}
      danger={rule ? { label: 'Delete rule', onClick: () => onDelete(rule) } : undefined}
      onSave={async () => {
        checkForwardPorts(v.srcPort, v.destPort);
        if (!isIpv4(v.destIp)) throw new Error('Enter a valid device IP.');
        await save.mutateAsync(undefined);
        toast(rule ? `Saved ${v.name || 'rule'}` : `Forwarding port ${v.srcPort} to ${v.destIp}`);
      }}
    >
      <TextField label="Name" value={v.name} onChange={set('name')} placeholder="Plex" />
      <Row2>
        <TextField
          label="Outside port"
          mono
          inputMode="numeric"
          value={v.srcPort}
          onChange={set('srcPort')}
          hint="One port or a range, 8000-8010"
        />
        <SelectField label="Protocol" value={v.proto} options={PROTO} onChange={set('proto')} />
      </Row2>
      {clients.length ? (
        <SelectField
          label="Device"
          value=""
          options={[['', 'Enter an IP address'], ...clients.map((c) => [c.ip, `${c.name} (${c.ip})`] as const)]}
          onChange={(ip) => ip && set('destIp')(ip)}
        />
      ) : null}
      <Row2>
        <TextField label="Device IP" mono inputMode="decimal" value={v.destIp} onChange={set('destIp')} />
        <TextField label="Device port" mono inputMode="numeric" value={v.destPort} onChange={set('destPort')} />
      </Row2>
      <Row2>
        <SelectField label="From" value={v.src} options={zones.externals.map((z) => [z, zone(z)] as const)} onChange={set('src')} />
        <SelectField label="To network" value={v.dest} options={zones.internals.map((z) => [z, zone(z)] as const)} onChange={set('dest')} />
      </Row2>
      <SwitchRow label="Rule on" checked={v.enabled} onChange={set('enabled')} />
    </Sheet>
  );
}

function DmzSheet({ dmz, save, onClose }: { dmz: Dmz; save: (v: Partial<Dmz>) => Promise<Dmz>; onClose: () => void }) {
  const { toast } = useFeedback();
  const [enabled, setEnabled] = useState(dmz.enabled);
  const [ip, setIp] = useState(dmz.dest_ip ?? '');
  const [priority, setPriority] = useState(dmz.priority !== false);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="DMZ host"
      sub="Sends every incoming connection that no rule matches to one device. That device is fully exposed to the internet."
      onSave={async () => {
        if (enabled && !isIpv4(ip)) throw new Error('Enter the device IP.');
        await save(enabled ? { enabled: true, dest_ip: ip, priority } : { enabled: false });
        toast(enabled ? `DMZ on for ${ip}` : 'DMZ off');
      }}
    >
      <SwitchRow label="DMZ on" checked={enabled} onChange={setEnabled} />
      <TextField label="Device IP" mono inputMode="decimal" value={ip} onChange={setIp} />
      <SwitchRow label="Port forwards take priority" checked={priority} onChange={setPriority} />
    </Sheet>
  );
}

/* ======================= Content filter ======================= */

export function ContentPage() {
  const { query, save } = useSettings('content', api.security.content);
  const stats = useQuery({ queryKey: ['dpi-stats'], queryFn: api.security.dpiStats });
  return (
    <Loaded query={query} title="Content filter">
      {(cfg) => (
        <>
          <PageHeader title="Content filter" sub="Blocks whole categories of sites for every device. For per-child rules, use Family." />
          <ContentForm
            cfg={cfg}
            save={save}
            note={
              stats.data
                ? `${stats.data.content_protection_day} blocked today, ${stats.data.content_protection_all.toLocaleString()} in total`
                : undefined
            }
          />
        </>
      )}
    </Loaded>
  );
}

function ContentForm({
  cfg,
  save,
  note,
}: {
  cfg: ContentFilter;
  save: (v: Partial<ContentFilter>) => Promise<unknown>;
  note: string | undefined;
}) {
  const form = useForm({ enable: cfg.enable, categories: cfg.category_list, domains: (cfg.domain_list ?? []).join('\n') });
  const v = form.values;
  return (
    <SettingsForm
      title="Block for every device"
      note={note}
      form={form}
      onSave={async () => {
        const domains = v.domains
          .split('\n')
          .map((d) => d.trim())
          .filter(Boolean);
        const bad = domains.find((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d));
        if (bad) throw new Error(`${bad} isn’t a domain name.`);
        await save({
          ...cfg,
          enable: v.enable,
          category_list: v.categories,
          app_list: (cfg.app_list ?? []).map((a) => (typeof a === 'string' ? a : a.name)),
          domain_list: domains,
        });
        return 'Content filter saved';
      }}
    >
      <SwitchRow label="Content filter on" checked={v.enable} onChange={(x) => form.set('enable', x)} />
      <ChipPicker
        legend="Categories"
        options={Object.entries(CONTENT_CATEGORIES)}
        value={v.categories}
        onChange={(x) => form.set('categories', x)}
      />
      <TextArea label="Also block these domains, one per line" value={v.domains} onChange={(x) => form.set('domains', x)} mono rows={4} />
    </SettingsForm>
  );
}

/* ======================= Access control ======================= */

export function AccessPage() {
  const { toast, confirm } = useFeedback();
  const query = useQuery({
    queryKey: ['acl'],
    queryFn: async () => ({ rules: await api.security.accessRules(), zones: await api.security.aclZones() }),
  });
  const [editing, setEditing] = useState<AccessRule | 'new' | null>(null);
  const enable = useWrite(({ list, on }: { list: AccessRule[]; on: boolean }) => api.security.setAccessRulesEnabled(list, on), [['acl']]);
  const remove = useWrite((list: AccessRule[]) => api.security.removeAccessRules(list), [['acl']]);
  const setOn = async (list: AccessRule[], on: boolean) => {
    try {
      await enable.mutateAsync({ list, on });
      toast(`${list.length === 1 ? list[0]?.name : plural(list.length, 'rule')} turned ${on ? 'on' : 'off'}`);
    } catch (err) {
      toast(`Couldn’t change the rules: ${errorMessage(err)}`);
    }
  };
  const removeAll = async (list: AccessRule[]) => {
    const what = list.length === 1 ? list[0]?.name : plural(list.length, 'rule');
    if (
      !(await confirm({ title: `Delete ${what}?`, body: 'Traffic they matched goes back to each network’s default.', confirm: 'Delete' }))
    )
      return;
    try {
      await remove.mutateAsync(list);
      toast(`Deleted ${what}`);
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  };
  const side = (z: string, ips: string[]) => `${zone(z)}${ips.length ? ` (${ips.join(', ')})` : ''}`;

  return (
    <Loaded query={query} title="Access control">
      {({ rules, zones }) => (
        <>
          <PageHeader
            title="Access control"
            sub="Allow or block traffic between networks, by address and port."
            actions={
              <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                New rule
              </Button>
            }
          />
          <PolicyNote>
            These rules follow addresses and ports between networks. To block people or devices, by group and schedule, see
          </PolicyNote>
          <Panel>
            {rules.length ? (
              <RuleTable
                label="Access rules"
                rows={rules}
                onEdit={setEditing}
                setOn={setOn}
                remove={removeAll}
                busy={enable.isPending}
                columns={[
                  { key: 'name', header: 'Rule', phone: 'title', cell: (r) => <span className="name">{r.name}</span> },
                  { key: 'flow', header: 'From → to', phone: 'sub', cell: (r) => `${side(r.src, r.srcIps)} → ${side(r.dest, r.destIps)}` },
                  {
                    key: 'proto',
                    header: 'Protocol',
                    cell: (r) => `${(r.proto || 'any').toUpperCase()}${r.destPort ? ` ${r.destPort}` : ''}`,
                  },
                  {
                    key: 'act',
                    header: 'Action',
                    cell: (r) => (
                      <span className={r.target === 'ACCEPT' ? 'target-accept' : 'target-drop'}>
                        {r.target === 'ACCEPT' ? 'Allow' : 'Block'}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <Empty>
                No access rules. Every network follows its default: Main LAN reaches everything, Guest and IoT reach only the internet.
              </Empty>
            )}
          </Panel>
          <EditingSheet sheet={AccessSheet} editing={editing} zones={zones} close={() => setEditing(null)} remove={removeAll} />
        </>
      )}
    </Loaded>
  );
}

const NEW_ACCESS: Omit<AccessRule, 'id'> = {
  name: '',
  family: 'ipv4 ipv6',
  src: 'lan',
  srcIps: [],
  dest: 'wan',
  destIps: [],
  proto: '',
  destPort: '',
  target: 'DROP',
  enabled: true,
};

function AccessSheet({
  rule,
  zones,
  onClose,
  onDelete,
}: {
  rule: AccessRule | null;
  zones: Zones;
  onClose: () => void;
  onDelete: (r: AccessRule) => void;
}) {
  const { toast } = useFeedback();
  const [v, setV] = useState(() => {
    const base = rule ?? NEW_ACCESS;
    return { ...base, srcIps: base.srcIps.join(', '), destIps: base.destIps.join(', ') };
  });
  const set =
    <K extends keyof typeof v>(k: K) =>
    (value: (typeof v)[K]) =>
      setV((x) => ({ ...x, [k]: value }));
  const ips = (s: string) => s.split(/[\s,]+/).filter(Boolean);
  const save = useWrite(() => api.security.saveAccessRule({ ...v, srcIps: ips(v.srcIps), destIps: ips(v.destIps) }, rule?.id), [['acl']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule ? rule.name : 'New access rule'}
      save={rule ? 'Save' : 'Add rule'}
      danger={rule ? { label: 'Delete rule', onClick: () => onDelete(rule) } : undefined}
      onSave={async () => {
        if (!v.name.trim()) throw new Error('Give the rule a name.');
        const bad = [...ips(v.srcIps), ...ips(v.destIps)].find((a) => !isIpv4(a.split('/')[0] ?? ''));
        if (bad) throw new Error(`${bad} isn’t an IPv4 address or range.`);
        checkRulePort(v, (p) => !p || /^\d{1,5}(-\d{1,5})?$/.test(p), 'Port must be a number or a range like 8000-8010.');
        await save.mutateAsync(undefined);
        toast(rule ? `Saved ${v.name}` : `Added ${v.name}`);
      }}
    >
      <TextField label="Name" value={v.name} onChange={set('name')} placeholder="Keep IoT off the NAS" />
      <Row2>
        <SelectField label="From network" value={v.src} options={zones.externals.map((z) => [z, zone(z)] as const)} onChange={set('src')} />
        <TextField label="From address" mono value={v.srcIps} onChange={set('srcIps')} placeholder="Any" />
      </Row2>
      <Row2>
        <SelectField label="To network" value={v.dest} options={zones.internals.map((z) => [z, zone(z)] as const)} onChange={set('dest')} />
        <TextField label="To address" mono value={v.destIps} onChange={set('destIps')} placeholder="Any" />
      </Row2>
      <Row2>
        <SelectField
          label="Protocol"
          value={v.proto}
          options={[
            ['', 'Any'],
            ['tcp udp', 'TCP and UDP'],
            ['tcp', 'TCP'],
            ['udp', 'UDP'],
            ['icmp', 'ICMP'],
          ]}
          onChange={set('proto')}
        />
        <TextField label="Port" mono value={v.destPort} onChange={set('destPort')} placeholder="Any" />
      </Row2>
      <SelectField
        label="Action"
        value={v.target}
        options={[
          ['DROP', 'Block'],
          ['ACCEPT', 'Allow'],
        ]}
        onChange={set('target')}
      />
      <SwitchRow label="Rule on" checked={v.enabled} onChange={set('enabled')} />
    </Sheet>
  );
}

/* ======================= Remote management ======================= */

export function RemotePage() {
  const wan = useSettings('wan-access', api.security.wanAccess);
  const local = useSettings('local-access', api.security.localAccess);
  const ports = useQuery({ queryKey: ['open-ports'], queryFn: api.security.openPorts });
  return (
    <Loaded query={wan.query} title="Remote management">
      {(w) => (
        <>
          <PageHeader title="Remote management" sub="Who can reach the router’s own services, and how." />
          <Stack>
            <RemoteForm cfg={w} save={wan.save} />
            <Loaded query={local.query} title="">
              {(l) => <LocalForm cfg={l} save={local.save} />}
            </Loaded>
            <Panel title="Ports opened on the router">
              {ports.data?.length ? (
                <DataTable
                  label="Open ports"
                  rows={ports.data}
                  rowKey={(r) => r.name + (r.dest_port ?? r.port ?? '')}
                  columns={[
                    { key: 'name', header: 'Name', phone: 'title', cell: (r) => <span className="name">{r.name}</span> },
                    {
                      key: 'port',
                      header: 'Port',
                      phone: 'sub',
                      cell: (r) => <span className="mono">{`${r.proto} ${r.dest_port ?? r.port ?? ''}`}</span>,
                    },
                    stateColumn(),
                  ]}
                />
              ) : (
                <Empty>No extra ports open. For full control, use Firewall rules.</Empty>
              )}
            </Panel>
          </Stack>
        </>
      )}
    </Loaded>
  );
}

function RemoteForm({ cfg, save }: { cfg: RemoteAccess; save: (v: Partial<RemoteAccess>) => Promise<unknown> }) {
  const { confirm } = useFeedback();
  const form = useForm({ ...cfg, list: cfg.whitelist.map((x) => x.ipaddr).join(', ') });
  const v = form.values;
  return (
    <SettingsForm
      title="Reach the router from the internet"
      note="Off is safest. Use a VPN to manage the router remotely."
      form={form}
      onSave={async () => {
        const list = v.list.split(/[\s,]+/).filter(Boolean);
        const bad = list.find((a) => !isIpv4(a.split('/')[0] ?? ''));
        if (bad) throw new Error(`${bad} isn’t an IPv4 address or range.`);
        if (v.enable_whitelist && !list.length) throw new Error('Add at least one allowed address, or turn the list off.');
        if (
          (v.enable_https || v.enable_ssh) &&
          !v.enable_whitelist &&
          !(await confirm({
            title: 'Open the router to the whole internet?',
            body: 'Anyone can reach the sign-in page or SSH and try passwords. Limiting it to your own addresses is much safer.',
            confirm: 'Open it anyway',
          }))
        )
          return false;
        await save({
          enable_https: v.enable_https,
          enable_ssh: v.enable_ssh,
          enable_ping: v.enable_ping,
          enable_whitelist: v.enable_whitelist,
          whitelist: list.map((ipaddr) => ({ ipaddr, name: '' })),
        });
        return 'Remote access saved';
      }}
    >
      <SwitchRow label="Admin panel over HTTPS" checked={v.enable_https} onChange={(x) => form.set('enable_https', x)} />
      <SwitchRow label="SSH" checked={v.enable_ssh} onChange={(x) => form.set('enable_ssh', x)} />
      <SwitchRow label="Answer pings" checked={v.enable_ping} onChange={(x) => form.set('enable_ping', x)} />
      <SwitchRow label="Only from these addresses" checked={v.enable_whitelist} onChange={(x) => form.set('enable_whitelist', x)} />
      <TextField
        label="Allowed addresses, comma separated"
        mono
        value={v.list}
        onChange={(x) => form.set('list', x)}
        placeholder="203.0.113.7, 198.51.100.0/24"
      />
    </SettingsForm>
  );
}

function LocalForm({ cfg, save }: { cfg: LocalAccess; save: (v: Partial<LocalAccess>) => Promise<unknown> }) {
  const { confirm } = useFeedback();
  const form = useForm({
    http_port: String(cfg.http_port),
    https_port: String(cfg.https_port),
    ssh_port: String(cfg.ssh_port),
    redirect_https: cfg.redirect_https,
    ssh_enabled: cfg.ssh_enabled,
    timeout: String(Math.round(cfg.session_timeout / 60)),
  });
  const v = form.values;
  return (
    <SettingsForm
      title="On your network"
      form={form}
      onSave={async () => {
        const ports = [v.http_port, v.https_port, v.ssh_port].map(Number);
        if (ports.some((p) => !(p >= 1 && p <= 65_535))) throw new Error('Ports must be 1 to 65535.');
        if (new Set(ports).size !== ports.length) throw new Error('Each service needs its own port.');
        if (
          (Number(v.https_port) !== cfg.https_port || Number(v.http_port) !== cfg.http_port) &&
          !(await confirm({
            title: 'Move the admin pages to new ports?',
            body: 'This console is served on these ports. After saving, open it at the new port.',
            confirm: 'Change ports',
            danger: false,
          }))
        )
          return false;
        if (
          !v.ssh_enabled &&
          cfg.ssh_enabled &&
          !(await confirm({
            title: 'Turn SSH off?',
            body: 'Key-based access, like the installer’s, stops working until you turn it back on here.',
            confirm: 'Turn off',
          }))
        )
          return false;
        await save({
          ...cfg,
          http_port: Number(v.http_port),
          https_port: Number(v.https_port),
          ssh_port: Number(v.ssh_port),
          redirect_https: v.redirect_https,
          ssh_enabled: v.ssh_enabled,
          session_timeout: 60 * Number(v.timeout),
        });
        return 'Local access saved';
      }}
    >
      <Row2>
        <TextField label="HTTP port" inputMode="numeric" value={v.http_port} onChange={(x) => form.set('http_port', x)} />
        <TextField label="HTTPS port" inputMode="numeric" value={v.https_port} onChange={(x) => form.set('https_port', x)} />
      </Row2>
      <SwitchRow label="Always use HTTPS" checked={v.redirect_https} onChange={(x) => form.set('redirect_https', x)} />
      <Row2>
        <TextField label="Sign out after" unit="min" inputMode="numeric" value={v.timeout} onChange={(x) => form.set('timeout', x)} />
        <TextField label="SSH port" inputMode="numeric" value={v.ssh_port} onChange={(x) => form.set('ssh_port', x)} />
      </Row2>
      <SwitchRow label="SSH on" checked={v.ssh_enabled} onChange={(x) => form.set('ssh_enabled', x)} />
      <Note>
        LuCI, OpenWrt’s own interface, has its own ports in{' '}
        <button type="button" className="link" onClick={() => navigate('admin')}>
          Admin and access
        </button>
        .
      </Note>
    </SettingsForm>
  );
}
