import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { FirewallRule, FirewallTarget, FirewallZone, RuleInput } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { checkRulePort } from '../../lib/rules.ts';
import { AdvancedGate } from '../../ui/AdvancedGate.tsx';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Row2, SelectField, Switch, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, KeyValues, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

const ZONE_LABEL: Record<string, string> = { lan: 'Main LAN', wan: 'Internet', guest: 'Guest', iot: 'IoT', tailscale0: 'Tailscale' };
const zoneLabel = (z: string) => (z === '*' ? 'Any zone' : (ZONE_LABEL[z] ?? z));
const PROTOS = [
  ['tcp udp', 'TCP and UDP'],
  ['tcp', 'TCP'],
  ['udp', 'UDP'],
  ['icmp', 'ICMP'],
  ['all', 'Any protocol'],
] as const;
const TARGETS: [FirewallTarget, string][] = [
  ['ACCEPT', 'Allow'],
  ['REJECT', 'Reject'],
  ['DROP', 'Drop'],
];
const ORIGIN = { service: 'Router service', default: 'OpenWrt default', custom: 'Custom' } as const;
const Policy = ({ p }: { p: FirewallTarget }) => (
  <span className={`target-${p.toLowerCase()}`}>{TARGETS.find(([t]) => t === p)?.[1] ?? 'Allow'}</span>
);

function describe(r: FirewallRule) {
  const parts: string[] = [];
  if (r.proto !== 'tcp udp') parts.push(r.proto === 'all' ? 'any protocol' : r.proto.toUpperCase());
  if (r.destPort) parts.push(`port ${r.destPort}`);
  if (r.srcIp) parts.push(`from ${r.srcIp}`);
  if (r.destIp) parts.push(`to ${r.destIp}`);
  if (r.family) parts.push(r.family === 'ipv4' ? 'IPv4' : 'IPv6');
  return parts.join(', ') || 'All traffic';
}

const validPorts = (v: string) =>
  !v || v.split(/[\s,]+/).every((p) => /^\d{1,5}(-\d{1,5})?$/.test(p) && p.split('-').every((n) => Number(n) >= 1 && Number(n) <= 65_535));

export default function FirewallPage() {
  return (
    <AdvancedGate title="Firewall rules">
      <FirewallBody />
    </AdvancedGate>
  );
}

function FirewallBody() {
  const { toast, confirm } = useFeedback();
  const query = useQuery({ queryKey: ['firewall'], queryFn: api.openwrt.firewall });
  const [editing, setEditing] = useState<FirewallRule | 'new' | null>(null);
  const enable = useWrite(
    ({ rules, on }: { rules: FirewallRule[]; on: boolean }) => api.openwrt.setRulesEnabled(rules, on),
    [['firewall']],
  );
  const remove = useWrite((rules: FirewallRule[]) => api.openwrt.removeRules(rules), [['firewall']]);
  const editable = (list: FirewallRule[]) => list.filter((r) => r.origin !== 'service');

  async function setOn(list: FirewallRule[], on: boolean) {
    const rules = editable(list);
    if (!rules.length) return toast('Rules made by router services are changed from that service.');
    try {
      await enable.mutateAsync({ rules, on });
      toast(`${rules.length === 1 ? rules[0]?.name : plural(rules.length, 'rule')} turned ${on ? 'on' : 'off'}`);
    } catch (err) {
      toast(`Couldn’t change the rules: ${errorMessage(err)}`);
    }
  }

  async function removeRules(list: FirewallRule[]) {
    const rules = editable(list);
    if (!rules.length) return toast('Rules made by router services are removed from that service.');
    const defaults = rules.some((r) => r.origin === 'default');
    const what = rules.length === 1 ? (rules[0]?.name ?? 'this rule') : plural(rules.length, 'rule');
    if (
      !(await confirm({
        title: `Delete ${what}?`,
        body: defaults
          ? 'This includes OpenWrt defaults. Removing them can break DHCP, IPv6 or VPN traffic they were allowing.'
          : 'Traffic they matched falls through to the zone’s default.',
        confirm: 'Delete',
      }))
    )
      return;
    try {
      await remove.mutateAsync(rules);
      toast(`Deleted ${what}`);
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  return (
    <Loaded query={query} title="Firewall rules">
      {({ zones, forwards, rules }) => (
        <>
          <PageHeader
            title="Firewall rules"
            sub="Changes apply with automatic rollback: if this page loses the router, it undoes them within 30 seconds."
            actions={
              <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                New rule
              </Button>
            }
          />
          <Panel title="Zones" note="Traffic allowed between zones">
            <DataTable
              label="Zones"
              rows={zones}
              rowKey={(z) => z.name}
              columns={[
                { key: 'zone', header: 'Zone', phone: 'title', cell: (z) => <span className="name">{zoneLabel(z.name)}</span> },
                { key: 'in', header: 'To the router', phone: 'sub', cell: (z) => <Policy p={z.input} /> },
                { key: 'out', header: 'From the router', cell: (z) => <Policy p={z.output} /> },
                { key: 'fwd', header: 'Between its devices', cell: (z) => <Policy p={z.forward} /> },
                {
                  key: 'masq',
                  header: 'Masquerade',
                  align: 'end',
                  phone: 'end',
                  cell: (z) => (z.masquerade ? 'On' : <span className="tone-off">Off</span>),
                },
              ]}
            />
            <div className="zones">
              {forwards.map((f) => (
                <span className="zone-flow" key={`${f.src}-${f.dest}`}>
                  <b>{zoneLabel(f.src)}</b>
                  {f.enabled ? 'can reach' : 'blocked to'}
                  <b>{zoneLabel(f.dest)}</b>
                </span>
              ))}
            </div>
          </Panel>
          <Panel className="section" title="Traffic rules" note={`${plural(rules.length, 'rule')}, checked top to bottom`}>
            <DataTable
              label="Traffic rules"
              rows={rules}
              rowKey={(r) => r.id}
              onRowClick={setEditing}
              rowClass={(r) => (r.enabled ? undefined : 'off')}
              bulk={[
                { label: 'Turn on', run: (l) => setOn(l, true), when: (l) => editable(l).some((r) => !r.enabled) },
                { label: 'Turn off', run: (l) => setOn(l, false), when: (l) => editable(l).some((r) => r.enabled) },
                { label: 'Delete', danger: true, run: removeRules, when: (l) => editable(l).length > 0 },
              ]}
              columns={[
                { key: 'name', header: 'Rule', phone: 'title', cell: (r) => <span className="name">{r.name}</span> },
                {
                  key: 'flow',
                  header: 'From → to',
                  phone: 'sub',
                  cell: (r) => `${r.src ? zoneLabel(r.src) : 'This router'} → ${r.dest ? zoneLabel(r.dest) : 'This router'}`,
                },
                { key: 'match', header: 'Matches', cell: describe },
                { key: 'act', header: 'Action', cell: (r) => <Policy p={r.target} /> },
                {
                  key: 'owner',
                  header: 'Owner',
                  cell: (r) => <Chip tone={r.origin === 'custom' ? 'brand' : undefined}>{ORIGIN[r.origin]}</Chip>,
                },
                {
                  key: 'on',
                  header: 'On',
                  align: 'end',
                  phone: 'end',
                  cell: (r) => (
                    // biome-ignore lint/a11y/noStaticElementInteractions: keeps the row from opening when the switch is used
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the switch inside handles keys
                    <span onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={r.enabled}
                        label={`${r.name} on`}
                        disabled={r.origin === 'service' || enable.isPending}
                        onChange={(on) => setOn([r], on)}
                      />
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
          {editing ? (
            <RuleSheet
              key={editing === 'new' ? 'new' : editing.id}
              rule={editing === 'new' ? null : editing}
              zones={zones}
              onClose={() => setEditing(null)}
              onDelete={(r) => {
                setEditing(null);
                removeRules([r]);
              }}
            />
          ) : null}
        </>
      )}
    </Loaded>
  );
}

function RuleSheet({
  rule,
  zones,
  onClose,
  onDelete,
}: {
  rule: FirewallRule | null;
  zones: FirewallZone[];
  onClose: () => void;
  onDelete: (r: FirewallRule) => void;
}) {
  const { toast } = useFeedback();
  const [v, setV] = useState<RuleInput>(
    rule ?? {
      name: '',
      src: 'wan',
      dest: '',
      proto: 'tcp udp',
      destPort: '',
      srcIp: '',
      destIp: '',
      target: 'ACCEPT',
      family: '',
      enabled: true,
    },
  );
  const set =
    <K extends keyof RuleInput>(k: K) =>
    (value: RuleInput[K]) =>
      setV((x) => ({ ...x, [k]: value }));
  const save = useWrite(() => api.openwrt.saveRule(v, rule ?? undefined), [['firewall']]);
  const zoneOptions: [string, string][] = [['*', 'Any zone'], ...zones.map((z) => [z.name, zoneLabel(z.name)] as [string, string])];

  if (rule?.origin === 'service')
    return (
      <Sheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={rule.name}
        sub="Made by a router service (GL.iNet, Tailscale or similar). Change it from that service so it isn’t rewritten."
      >
        <KeyValues
          rows={[
            ['From', rule.src ? zoneLabel(rule.src) : 'This router'],
            ['To', rule.dest ? zoneLabel(rule.dest) : 'This router'],
            ['Matches', describe(rule)],
            ['Action', <Policy key="p" p={rule.target} />],
          ]}
        />
      </Sheet>
    );

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule ? rule.name : 'New firewall rule'}
      sub={rule?.origin === 'default' ? 'An OpenWrt default rule. Edit with care.' : 'Rules apply with automatic rollback.'}
      save={rule ? 'Save and apply' : 'Add rule'}
      danger={rule ? { label: 'Delete rule', onClick: () => onDelete(rule) } : undefined}
      onSave={async () => {
        if (!v.name.trim()) throw new Error('Give the rule a name.');
        checkRulePort(v, validPorts, 'Ports must be 1 to 65535: 443, 8000-8010 or 80 443.');
        await save.mutateAsync(undefined);
        toast(rule ? `Saved ${v.name}` : `Added ${v.name}`);
      }}
    >
      <TextField label="Name" value={v.name} onChange={set('name')} placeholder="Block cameras from the internet" />
      <Row2>
        <SelectField label="From zone" value={v.src || '*'} options={zoneOptions} onChange={set('src')} />
        <SelectField label="To" value={v.dest} options={[['', 'This router'], ...zoneOptions]} onChange={set('dest')} />
      </Row2>
      <Row2>
        <SelectField label="Protocol" value={v.proto} options={PROTOS} onChange={set('proto')} />
        <TextField
          label="Destination port"
          mono
          value={v.destPort}
          onChange={set('destPort')}
          placeholder="Any"
          hint="One port, a range or a list"
        />
      </Row2>
      <Row2>
        <TextField label="From address" mono value={v.srcIp} onChange={set('srcIp')} placeholder="Any" />
        <TextField label="To address" mono value={v.destIp} onChange={set('destIp')} placeholder="Any" />
      </Row2>
      <Row2>
        <SelectField label="Action" value={v.target} options={TARGETS} onChange={set('target')} />
        <SelectField
          label="IP version"
          value={v.family}
          options={[
            ['', 'IPv4 and IPv6'],
            ['ipv4', 'IPv4 only'],
            ['ipv6', 'IPv6 only'],
          ]}
          onChange={set('family')}
        />
      </Row2>
      <SwitchRow label="Rule on" checked={v.enabled} onChange={set('enabled')} />
    </Sheet>
  );
}
