import { type Group, type Network, POLICY_DAYS, type Policy, zoneOf } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { useFeedback } from '../../ui/feedback.tsx';
import { ChipPicker, Row2, Segmented, SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { TextArea } from '../../ui/TextArea.tsx';
import { confirmedDelete } from './confirmedDelete.ts';
import { type ActionKind, ENDS, emptyForm, formOf, inputOf, type PolicyForm, type Preset, partsOf, type WhatKind } from './draft.ts';
import { Sentence } from './Sentence.tsx';
import { type Names, suggestedName } from './sentence.ts';
import { WhoPicker } from './WhoPicker.tsx';

interface Props {
  /** The policy to change, or null for a new one. */
  policy: Policy | null;
  preset: Preset;
  names: Names;
  /** The router's clock in seconds, which end times count from. */
  now: number;
  onClose: () => void;
}

const WHAT: [WhatKind, string][] = [
  ['internet', 'The internet'],
  ['sites', 'Specific sites'],
  ['network', 'Another network'],
  ['everything', 'Everything'],
];
const ACTIONS: [ActionKind, string][] = [
  ['block', 'Block'],
  ['allow', 'Allow'],
  ['limit', 'Limit speed'],
];

type Setter = <K extends keyof PolicyForm>(key: K) => (value: PolicyForm[K]) => void;

function WhatFields({ form, set, networks }: { form: PolicyForm; set: Setter; networks: Network[] }) {
  if (form.action === 'limit')
    return (
      <section className="group">
        <h3>What</h3>
        <p className="kicker">A speed limit covers all of a device’s traffic.</p>
      </section>
    );
  return (
    <section className="group">
      <h3>What</h3>
      <Segmented label="What the policy covers" value={form.whatKind} onChange={set('whatKind')} options={WHAT} />
      {form.whatKind === 'sites' ? (
        <TextArea
          label="Sites, one per line"
          value={form.sites}
          onChange={set('sites')}
          mono
          rows={3}
          placeholder="tiktok.com"
          hint="Subdomains are included. Devices that use their own encrypted DNS can sometimes get around this."
        />
      ) : null}
      {form.whatKind === 'network' ? (
        <SelectField
          label="Network"
          value={form.network}
          onChange={set('network')}
          options={[['', 'Choose a network'], ...networks.map((n) => [zoneOf(n), n.label] as const)]}
        />
      ) : null}
    </section>
  );
}

function WhenFields({ form, set, existingEnd }: { form: PolicyForm; set: Setter; existingEnd: boolean }) {
  return (
    <section className="group">
      <h3>When</h3>
      <Segmented
        label="When the policy applies"
        value={form.scheduled ? 'schedule' : 'always'}
        onChange={(v) => set('scheduled')(v === 'schedule')}
        options={[
          ['always', 'Always'],
          ['schedule', 'On a schedule'],
        ]}
      />
      {form.scheduled ? (
        <>
          <ChipPicker legend="Days" options={POLICY_DAYS} value={form.days} onChange={set('days')} />
          <Row2>
            <TextField label="From" type="time" value={form.from} onChange={set('from')} />
            <TextField
              label="Until"
              type="time"
              value={form.to}
              onChange={set('to')}
              hint="Earlier than the start means it runs overnight."
            />
          </Row2>
        </>
      ) : null}
      <SelectField
        label="Ends"
        value={form.ends}
        onChange={set('ends')}
        options={ENDS.filter(([v]) => v !== 'keep' || existingEnd)}
        hint="The router stops applying the policy by itself, even with the console closed."
      />
    </section>
  );
}

function ActionFields({ form, set }: { form: PolicyForm; set: Setter }) {
  return (
    <section className="group">
      <h3>Action</h3>
      <Segmented label="What the policy does" value={form.action} onChange={set('action')} options={ACTIONS} />
      {form.action === 'allow' ? <p className="kicker">An allow above a block is an exception to it. Move it up the list.</p> : null}
      {form.action === 'limit' ? (
        <Row2>
          <TextField label="Download" unit="Mbps" inputMode="decimal" value={form.down} onChange={set('down')} />
          <TextField label="Upload" unit="Mbps" inputMode="decimal" value={form.up} onChange={set('up')} />
        </Row2>
      ) : null}
    </section>
  );
}

/** The editor's copy of a policy, kept as typed. */
function useForm(policy: Policy | null, preset: Preset, groups: Group[]) {
  const [form, setForm] = useState(() => (policy ? formOf(policy) : emptyForm(preset, groups)));
  const set: Setter = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  return { form, set };
}

/** Create or change a policy, building its sentence step by step with a live preview. */
export function PolicySheet({ policy, preset, names, now, onClose }: Props) {
  const feedback = useFeedback();
  const { toast } = feedback;
  const { form, set } = useForm(policy, preset, names.groups);
  const save = useWrite(async () => {
    const input = inputOf(form, names, policy, now);
    return policy ? api.policies.update(policy.id, input) : api.policies.create(input);
  }, [['policies'], ['groups']]);
  const remove = useWrite(async () => policy && api.policies.remove(policy.id), [['policies']]);
  const parts = partsOf(form, policy?.until ?? null, now);

  async function deletePolicy() {
    if (!policy) return;
    const body = 'Its devices go back to what the other policies and the network allow.';
    if (await confirmedDelete(feedback, policy.name, body, () => remove.mutateAsync(undefined), 'Delete policy')) onClose();
  }

  return (
    <Sheet
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={policy ? `Edit ${policy.name}` : 'New policy'}
      sub="Policies apply from the top of the list down, and the first one that matches decides."
      save={policy ? 'Save policy' : 'Create policy'}
      danger={policy ? { label: 'Delete policy', onClick: deletePolicy } : undefined}
      onSave={async () => {
        const saved = await save.mutateAsync(undefined);
        toast(policy ? `Saved ${saved.name}` : `Created ${saved.name}`);
      }}
    >
      <p className="pol-preview" aria-live="polite" data-testid="policy-preview">
        <Sentence policy={parts} names={names} now={now} />
      </p>
      <WhoPicker
        value={form.who}
        onChange={set('who')}
        clients={names.clients}
        groups={names.groups}
        networks={names.networks}
        allowNetworks={form.action !== 'limit'}
      />
      <WhatFields form={form} set={set} networks={names.networks} />
      <WhenFields form={form} set={set} existingEnd={policy?.until != null} />
      <ActionFields form={form} set={set} />
      <TextField label="Name" value={form.name} onChange={set('name')} placeholder={suggestedName(parts, names)} />
      <SwitchRow label="Policy on" checked={form.enabled} onChange={set('enabled')} />
    </Sheet>
  );
}
