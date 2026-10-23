import { IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { allowRule, blockRule, cleanDomain, isHostName, parseRule } from '@zeeli/router-api';
import { type FormEvent, useState } from 'react';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { FilterBar } from '../../ui/FilterBar.tsx';
import { Segmented, TextField } from '../../ui/fields.tsx';
import { facetOptions, matches } from '../../ui/filter.ts';
import { Empty, Panel } from '../../ui/Layout.tsx';
import { RULES_KEY, useRuleEdit } from './useRuleEdit.ts';

const KIND_WORD = { block: 'Blocked', allow: 'Allowed', other: 'Other' } as const;

/** A rule as a sentence; anything the console doesn't write itself stays as the raw text. */
function RuleText({ rule }: { rule: string }) {
  const { kind, domain } = parseRule(rule);
  if (kind === 'other') return <span className="mono">{rule}</span>;
  return (
    <span className="name">
      {KIND_WORD[kind]}: {domain}
    </span>
  );
}

/** Your own AdGuard rules: block or allow a domain, and take rules away again. */
export function CustomRules() {
  const rules = useQuery({ queryKey: RULES_KEY, queryFn: api.dns.userRules });
  const edit = useRuleEdit();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const all = rules.data ?? [];
  const rows = all.filter((r) => (!kind || parseRule(r).kind === kind) && matches(q, [r, parseRule(r).domain]));
  return (
    <Panel title="Custom rules" note={all.length ? `${all.length} ${all.length === 1 ? 'rule' : 'rules'}` : undefined}>
      <AddRule edit={edit} />
      {all.length > 8 ? (
        <FilterBar
          search={{ value: q, onChange: setQ, placeholder: 'Find a rule', label: 'Find a rule' }}
          facets={[
            {
              label: 'Type',
              value: kind,
              onChange: setKind,
              options: facetOptions(
                all,
                (r) => parseRule(r).kind,
                (v) => KIND_WORD[v as keyof typeof KIND_WORD],
              ),
            },
          ]}
          shown={rows.length}
          total={all.length}
          onClear={() => {
            setQ('');
            setKind('');
          }}
        />
      ) : null}
      {rules.isError ? (
        <Empty>Couldn’t read AdGuard Home: {errorMessage(rules.error)}</Empty>
      ) : rows.length ? (
        <DataTable
          label="Custom rules"
          rows={rows}
          rowKey={(r) => r}
          columns={[
            { key: 'rule', header: 'Rule', phone: 'title', cell: (r) => <RuleText rule={r} /> },
            {
              key: 'delete',
              header: <span className="sr-only">Delete</span>,
              align: 'end',
              phone: 'end',
              cell: (r) => (
                <IconButton
                  label={`Delete rule ${r}`}
                  disabled={edit.busy}
                  onClick={() => edit.apply((fresh) => fresh.filter((x) => x !== r), 'Rule deleted')}
                >
                  <IconTrash size={16} />
                </IconButton>
              ),
            },
          ]}
        />
      ) : (
        <Empty>
          {all.length ? 'No rules match.' : 'No custom rules yet. Add a domain above to block it, or allow it past the filter lists.'}
        </Empty>
      )}
    </Panel>
  );
}

function AddRule({ edit }: { edit: ReturnType<typeof useRuleEdit> }) {
  const [domain, setDomain] = useState('');
  const [mode, setMode] = useState<'block' | 'allow'>('block');
  const [error, setError] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    const d = cleanDomain(domain);
    if (!isHostName(d)) return setError(`“${domain.trim()}” isn’t a domain name. Use something like example.com.`);
    setError('');
    const rule = mode === 'block' ? blockRule(d) : allowRule(d);
    await edit.apply((fresh) => (fresh.includes(rule) ? fresh : [...fresh, rule]), `${mode === 'block' ? 'Blocked' : 'Allowed'} ${d}`);
    setDomain('');
  }

  return (
    <form className="toolbar" onSubmit={add} noValidate>
      <TextField label="Domain" value={domain} onChange={setDomain} placeholder="example.com" hint="Covers its subdomains too" />
      <Segmented
        label="What to do"
        value={mode}
        onChange={setMode}
        options={[
          ['block', 'Block'],
          ['allow', 'Allow'],
        ]}
      />
      <Button type="submit" variant="strong" busy={edit.busy}>
        Add rule
      </Button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
