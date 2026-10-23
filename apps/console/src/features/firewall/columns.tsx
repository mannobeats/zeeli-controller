import type { FirewallRule, FirewallTarget, RuleOrigin } from '@zeeli/router-api';
import type { Column } from '../../ui/DataTable.tsx';
import { Chip } from '../../ui/Layout.tsx';
import { describe, ORIGIN, zoneLabel } from './labels.ts';
import { Policy } from './shared.tsx';

/** The table columns both firewall pages show for zones and for rules. */

interface ZoneRow {
  name: string;
  input: FirewallTarget;
  output: FirewallTarget;
  forward: FirewallTarget;
}

export const zonePolicyColumns = <Z extends ZoneRow>(): Column<Z>[] => [
  { key: 'zone', header: 'Zone', phone: 'title', cell: (z) => <span className="name">{zoneLabel(z.name)}</span> },
  { key: 'in', header: 'To the router', phone: 'sub', cell: (z) => <Policy p={z.input} /> },
  { key: 'out', header: 'From the router', cell: (z) => <Policy p={z.output} /> },
  { key: 'fwd', header: 'Between its devices', cell: (z) => <Policy p={z.forward} /> },
];

export const masqueradeColumn = <Z extends { masquerade: boolean }>(): Column<Z> => ({
  key: 'masq',
  header: 'Masquerade',
  align: 'end',
  phone: 'end',
  cell: (z) => (z.masquerade ? 'On' : <span className="tone-off">Off</span>),
});

type RuleRow = Pick<FirewallRule, 'name' | 'src' | 'dest' | 'proto' | 'destPort' | 'srcIp' | 'destIp' | 'family' | 'target'>;

/** Name, path, match, action and owner; `origin` says who made a rule. */
export const ruleColumns = <R extends RuleRow>(origin: (r: R) => RuleOrigin): Column<R>[] => [
  { key: 'name', header: 'Rule', phone: 'title', cell: (r) => <span className="name">{r.name}</span> },
  {
    key: 'flow',
    header: 'From → to',
    phone: 'sub',
    cell: (r) => `${r.src ? zoneLabel(r.src) : 'This router'} → ${r.dest ? zoneLabel(r.dest) : 'This router'}`,
  },
  { key: 'match', header: 'Matches', cell: describe },
  { key: 'act', header: 'Action', cell: (r) => <Policy p={r.target} /> },
  { key: 'owner', header: 'Owner', cell: (r) => <Chip>{ORIGIN[origin(r)]}</Chip> },
];
