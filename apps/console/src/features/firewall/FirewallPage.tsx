import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { FirewallRule, FirewallZone, RuleInput } from '@zeeli/router-api';
import { useState } from 'react';
import { useAgent, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { plural } from '../../lib/format.ts';
import { AdvancedGate } from '../../ui/AdvancedGate.tsx';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Switch } from '../../ui/fields.tsx';
import { PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { AgentFirewall } from './AgentFirewall.tsx';
import { masqueradeColumn, ruleColumns, zonePolicyColumns } from './columns.tsx';
import { zoneLabel } from './labels.ts';
import { RuleSheet } from './shared.tsx';

/** With the Zeeli agent on the router the page edits zones and rule order directly; without it, through LuCI. */
export default function FirewallPage() {
  const agent = useAgent();
  if (agent.data) return <AgentFirewall />;
  if (agent.data === undefined && !agent.isError)
    return (
      <>
        <PageHeader title="Firewall rules" />
        <output className="panel skeleton" aria-busy="true" aria-label="Loading" />
      </>
    );
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
  const saveRule = useWrite(({ v, rule }: { v: RuleInput; rule?: FirewallRule }) => api.openwrt.saveRule(v, rule), [['firewall']]);
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
              columns={[...zonePolicyColumns<FirewallZone>(), masqueradeColumn<FirewallZone>()]}
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
                ...ruleColumns<FirewallRule>((r) => r.origin),
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
              zones={zones.map((z) => z.name)}
              onClose={() => setEditing(null)}
              onSave={async (v) => {
                await saveRule.mutateAsync({ v, ...(editing === 'new' ? {} : { rule: editing }) });
                toast(editing === 'new' ? `Added ${v.name}` : `Saved ${v.name}`);
              }}
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
