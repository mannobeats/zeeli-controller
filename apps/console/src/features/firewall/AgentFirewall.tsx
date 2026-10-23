import { IconChevronDown, IconChevronUp, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentForwarding, AgentNetwork, AgentRule, AgentZone, ChangeOutcome, FirewallRule, ZoneChange } from '@zeeli/router-api';
import { useState } from 'react';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { ChipPicker, Row2, SelectField, Switch, SwitchRow } from '../../ui/fields.tsx';
import { Chip, KeyValues, Note, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { masqueradeColumn, ruleColumns, zonePolicyColumns } from './columns.tsx';
import { ORIGIN, TARGETS, zoneLabel } from './labels.ts';
import { Policy, RuleSheet } from './shared.tsx';

const KEY = ['agent-firewall'];
const NETWORK_LABEL: Record<string, string> = {
  lan: 'Main LAN',
  wan: 'WAN',
  wan6: 'WAN (IPv6)',
  secondwan: 'Ethernet 2 (WAN)',
  wwan: 'Repeater',
  guest: 'Guest',
  iot: 'IoT',
};
const networkLabel = (n: string) => NETWORK_LABEL[n] ?? n;

type Status = { kind: 'confirming' } | { kind: 'rolledBack' | 'unknown'; message: string } | null;
type Written = Promise<{ outcome: ChangeOutcome }>;

/**
 * Every change the agent applies is kept only if this page can still reach the router a moment
 * later. `apply` runs one, shows that wait, and says so when the router undid it instead.
 * Errors from the agent (a bad value) are thrown for the caller to show.
 */
function useChange() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [status, setStatus] = useState<Status>(null);
  async function apply(done: string, write: () => Written) {
    setStatus({ kind: 'confirming' });
    let outcome: ChangeOutcome;
    try {
      outcome = (await write()).outcome;
    } catch (err) {
      setStatus(null);
      // a refused change often means the list was stale
      qc.invalidateQueries({ queryKey: KEY });
      throw err;
    }
    // the list is fresh before the message, so what the person sees is what the router has
    await qc.invalidateQueries({ queryKey: KEY });
    if (outcome.state === 'confirmed') {
      setStatus(null);
      toast(done);
    } else setStatus({ kind: outcome.state, message: outcome.message });
  }
  return { status, apply, dismiss: () => setStatus(null) };
}

/** `apply` for the switches and buttons on the page, which have no form to show an error in. */
function useAction(apply: ReturnType<typeof useChange>['apply']) {
  const { toast } = useFeedback();
  return async (done: string, write: () => Written) => {
    try {
      await apply(done, write);
    } catch (err) {
      toast(`Couldn’t change the firewall: ${errorMessage(err)}`);
    }
  };
}

export function AgentFirewall() {
  const query = useQuery({ queryKey: KEY, queryFn: api.safety.firewall.all });
  const { status, apply, dismiss } = useChange();
  const act = useAction(apply);
  const [rule, setRule] = useState<AgentRule | 'new' | null>(null);
  const [zone, setZone] = useState<AgentZone | null>(null);
  const [forwarding, setForwarding] = useState(false);

  return (
    <Loaded query={query} title="Firewall rules">
      {({ zones, forwardings, rules, networks }) => (
        <>
          <PageHeader
            title="Firewall rules"
            sub="Changes apply at once and are kept once this page confirms it can still reach the router. If it can’t, the router undoes them within 30 seconds."
            actions={
              <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setRule('new')}>
                New rule
              </Button>
            }
          />
          <Banner status={status} dismiss={dismiss} />
          <ZonesPanel zones={zones} onOpen={setZone} />
          <ForwardingsPanel forwardings={forwardings} onAdd={() => setForwarding(true)} act={act} />
          <RulesPanel rules={rules} onOpen={setRule} act={act} />
          {zone ? <ZoneSheet key={zone.name} zone={zone} networks={networks} onClose={() => setZone(null)} apply={apply} /> : null}
          {forwarding ? <ForwardingSheet zones={zones} onClose={() => setForwarding(false)} apply={apply} /> : null}
          {rule ? (
            <RuleSheet
              key={rule === 'new' ? 'new' : rule.id}
              rule={rule === 'new' ? null : asRule(rule)}
              zones={zones.map((z) => z.name)}
              onClose={() => setRule(null)}
              onDelete={() => {
                const gone = rule === 'new' ? null : rule;
                setRule(null);
                if (gone) act(`Deleted ${gone.name}`, () => api.safety.firewall.removeRule(gone));
              }}
              onSave={(v) =>
                apply(rule === 'new' ? `Added ${v.name}` : `Saved ${v.name}`, () =>
                  rule === 'new' ? api.safety.firewall.addRule(v) : api.safety.firewall.updateRule(rule, v),
                )
              }
            />
          ) : null}
        </>
      )}
    </Loaded>
  );
}

const asRule = (r: AgentRule): FirewallRule => ({ ...r, origin: r.owner });

function Banner({ status, dismiss }: { status: Status; dismiss: () => void }) {
  if (!status) return null;
  if (status.kind === 'confirming') return <p className="kicker">Confirming your change…</p>;
  return (
    <div className="panel notice" role="alert">
      <h2>{status.kind === 'rolledBack' ? 'The router undid your change' : 'Couldn’t confirm your change'}</h2>
      <p className="kicker">{status.message}</p>
      <div className="row-actions start">
        <Button onClick={dismiss}>Dismiss</Button>
      </div>
    </div>
  );
}

/* ---------- zones ---------- */

function ZonesPanel({ zones, onOpen }: { zones: AgentZone[]; onOpen: (z: AgentZone) => void }) {
  return (
    <Panel title="Zones" note="What each zone allows, and the networks in it">
      <DataTable
        label="Zones"
        rows={zones}
        rowKey={(z) => z.name}
        onRowClick={onOpen}
        columns={[
          ...zonePolicyColumns<AgentZone>(),
          {
            key: 'nets',
            header: 'Networks',
            cell: (z) => (z.networks.length ? z.networks.map(networkLabel).join(', ') : <span className="muted">None</span>),
          },
          masqueradeColumn<AgentZone>(),
        ]}
      />
    </Panel>
  );
}

function ZoneSheet({
  zone,
  networks,
  onClose,
  apply,
}: {
  zone: AgentZone;
  networks: AgentNetwork[];
  onClose: () => void;
  apply: ReturnType<typeof useChange>['apply'];
}) {
  const [v, setV] = useState({
    input: zone.input,
    output: zone.output,
    forward: zone.forward,
    masquerade: zone.masquerade,
    mssClamp: zone.mssClamp,
    networks: zone.networks,
  });
  const set =
    <K extends keyof typeof v>(k: K) =>
    (value: (typeof v)[K]) =>
      setV((x) => ({ ...x, [k]: value }));

  if (!zone.editable)
    return (
      <Sheet
        open
        onOpenChange={(o) => !o && onClose()}
        title={zoneLabel(zone.name)}
        sub="Made by a router service (GL.iNet, Tailscale or similar). Change it from that service so it isn’t rewritten."
      >
        <KeyValues
          rows={[
            ['To the router', <Policy key="i" p={zone.input} />],
            ['From the router', <Policy key="o" p={zone.output} />],
            ['Between its devices', <Policy key="f" p={zone.forward} />],
          ]}
        />
      </Sheet>
    );

  const policy = (label: string, key: 'input' | 'output' | 'forward', hint?: string) => (
    <SelectField label={label} hint={hint} value={v[key]} options={TARGETS} onChange={set(key)} />
  );
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${zoneLabel(zone.name)} zone`}
      sub="Applies with automatic rollback: if this page loses the router, it undoes the change."
      save="Save and apply"
      onSave={async () => {
        const changed: ZoneChange = {};
        if (v.input !== zone.input) changed.input = v.input;
        if (v.output !== zone.output) changed.output = v.output;
        if (v.forward !== zone.forward) changed.forward = v.forward;
        if (v.masquerade !== zone.masquerade) changed.masquerade = v.masquerade;
        if (v.mssClamp !== zone.mssClamp) changed.mssClamp = v.mssClamp;
        if (v.networks.join() !== zone.networks.join()) changed.networks = v.networks;
        if (!Object.keys(changed).length) return;
        await apply(`Saved the ${zoneLabel(zone.name)} zone`, () => api.safety.firewall.updateZone(zone.name, changed));
      }}
    >
      {policy(
        'To the router',
        'input',
        zone.name === 'wan' ? 'Allowing this lets anyone on the internet reach the router itself.' : undefined,
      )}
      {policy('From the router', 'output')}
      {policy('Between its devices', 'forward')}
      <SwitchRow
        label="Masquerade"
        hint="Share one address with the zone, as the internet side usually does"
        checked={v.masquerade}
        onChange={set('masquerade')}
      />
      <SwitchRow
        label="MSS clamping"
        hint="Avoids stalls on links with a smaller packet size, such as PPPoE"
        checked={v.mssClamp}
        onChange={set('mssClamp')}
      />
      <ChipPicker
        legend="Networks in this zone"
        options={networks.map(
          (n) =>
            [n.name, n.zone && n.zone !== zone.name ? `${networkLabel(n.name)} (in ${zoneLabel(n.zone)})` : networkLabel(n.name)] as const,
        )}
        value={v.networks}
        onChange={set('networks')}
      />
    </Sheet>
  );
}

/* ---------- forwardings ---------- */

function ForwardingsPanel({
  forwardings,
  onAdd,
  act,
}: {
  forwardings: AgentForwarding[];
  onAdd: () => void;
  act: ReturnType<typeof useAction>;
}) {
  const { confirm } = useFeedback();
  async function remove(f: AgentForwarding) {
    if (
      !(await confirm({
        title: `Stop ${zoneLabel(f.src)} reaching ${zoneLabel(f.dest)}?`,
        body: 'Devices in the first zone lose access to the second until you connect them again.',
        confirm: 'Remove',
      }))
    )
      return;
    await act(`${zoneLabel(f.src)} no longer reaches ${zoneLabel(f.dest)}`, () => api.safety.firewall.removeForwarding(f));
  }
  return (
    <Panel
      title="Between zones"
      note="Which zones may start traffic to which"
      actions={
        <Button onClick={onAdd} icon={<IconPlus size={16} />}>
          Connect zones
        </Button>
      }
    >
      <DataTable
        label="Zone forwardings"
        rows={forwardings}
        rowKey={(f) => f.id}
        columns={[
          { key: 'src', header: 'From', phone: 'title', cell: (f) => <span className="name">{zoneLabel(f.src)}</span> },
          { key: 'dest', header: 'Can reach', phone: 'sub', cell: (f) => zoneLabel(f.dest) },
          { key: 'owner', header: 'Owner', cell: (f) => <Chip>{ORIGIN[f.owner]}</Chip> },
          {
            key: 'act',
            header: '',
            align: 'end',
            phone: 'end',
            cell: (f) =>
              f.editable ? (
                <Button variant="ghost" onClick={() => remove(f)} aria-label={`Remove ${zoneLabel(f.src)} to ${zoneLabel(f.dest)}`}>
                  Remove
                </Button>
              ) : null,
          },
        ]}
      />
    </Panel>
  );
}

function ForwardingSheet({
  zones,
  onClose,
  apply,
}: {
  zones: AgentZone[];
  onClose: () => void;
  apply: ReturnType<typeof useChange>['apply'];
}) {
  const options = zones.map((z) => [z.name, zoneLabel(z.name)] as const);
  const [src, setSrc] = useState(() => zones[0]?.name ?? '');
  const [dest, setDest] = useState(() => zones.find((z) => z.name !== zones[0]?.name)?.name ?? '');
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Connect zones"
      sub="Devices in the first zone may start connections to devices in the second. Replies always come back."
      save="Connect"
      onSave={() => apply(`${zoneLabel(src)} can now reach ${zoneLabel(dest)}`, () => api.safety.firewall.addForwarding(src, dest))}
    >
      <Row2>
        <SelectField label="From zone" value={src} options={options} onChange={setSrc} />
        <SelectField label="To zone" value={dest} options={options} onChange={setDest} />
      </Row2>
    </Sheet>
  );
}

/* ---------- rules ---------- */

function RulesPanel({ rules, onOpen, act }: { rules: AgentRule[]; onOpen: (r: AgentRule) => void; act: ReturnType<typeof useAction> }) {
  const last = rules.length - 1;
  const move = (r: AgentRule, to: number) => act(`Moved ${r.name}`, () => api.safety.firewall.moveRule(r, to));
  return (
    <Panel
      className="section"
      title="Traffic rules"
      note={`${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}, checked top to bottom`}
    >
      <DataTable
        label="Traffic rules"
        rows={rules}
        rowKey={(r) => r.id}
        onRowClick={onOpen}
        rowClass={(r) => (r.enabled ? undefined : 'off')}
        columns={[
          {
            key: 'order',
            header: 'Order',
            cell: (r) => (
              // biome-ignore lint/a11y/noStaticElementInteractions: keeps the row from opening when a button is used
              // biome-ignore lint/a11y/useKeyWithClickEvents: the buttons inside handle keys
              <span className="order-btns" onClick={(e) => e.stopPropagation()}>
                <span className="num muted">{r.index + 1}</span>
                <IconButton label={`Move ${r.name} up`} disabled={!r.editable || r.index === 0} onClick={() => move(r, r.index - 1)}>
                  <IconChevronUp size={16} />
                </IconButton>
                <IconButton label={`Move ${r.name} down`} disabled={!r.editable || r.index === last} onClick={() => move(r, r.index + 1)}>
                  <IconChevronDown size={16} />
                </IconButton>
              </span>
            ),
          },
          ...ruleColumns<AgentRule>((r) => r.owner),
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
                  disabled={!r.editable}
                  onChange={(on) => act(`${r.name} turned ${on ? 'on' : 'off'}`, () => api.safety.firewall.setRuleEnabled(r, on))}
                />
              </span>
            ),
          },
        ]}
      />
      <Note>Rules made by router services are listed but changed from that service. Zeeli’s own rules are managed by their feature.</Note>
    </Panel>
  );
}
