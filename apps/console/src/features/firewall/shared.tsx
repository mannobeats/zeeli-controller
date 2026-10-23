import type { FirewallRule, FirewallTarget, RuleInput } from '@zeeli/router-api';
import { useState } from 'react';
import { checkRulePort } from '../../lib/rules.ts';
import { Row2, SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { KeyValues } from '../../ui/Layout.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { describe, TARGETS, zoneLabel } from './labels.ts';

/** What the firewall page and its agent version share: the rule form and how a policy reads. */

const PROTOS = [
  ['tcp udp', 'TCP and UDP'],
  ['tcp', 'TCP'],
  ['udp', 'UDP'],
  ['icmp', 'ICMP'],
  ['all', 'Any protocol'],
] as const;

export const Policy = ({ p }: { p: FirewallTarget }) => (
  <span className={`target-${p.toLowerCase()}`}>{TARGETS.find(([t]) => t === p)?.[1] ?? 'Allow'}</span>
);

const validPorts = (v: string) =>
  !v || v.split(/[\s,]+/).every((p) => /^\d{1,5}(-\d{1,5})?$/.test(p) && p.split('-').every((n) => Number(n) >= 1 && Number(n) <= 65_535));

/**
 * The sheet for one traffic rule: read-only for rules a router service made, a form for the
 * rest. The sheet checks the fields, then `onSave` writes them; whoever saves says how it went.
 */
export function RuleSheet({
  rule,
  zones,
  onClose,
  onDelete,
  onSave,
}: {
  rule: FirewallRule | null;
  zones: string[];
  onClose: () => void;
  onDelete: (r: FirewallRule) => void;
  onSave: (v: RuleInput) => Promise<unknown>;
}) {
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
  const zoneOptions: [string, string][] = [['*', 'Any zone'], ...zones.map((z) => [z, zoneLabel(z)] as [string, string])];

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
        await onSave(v);
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
