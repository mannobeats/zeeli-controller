import {
  BAND_RADIO,
  type JoinableNetwork,
  OWN_BANDS,
  type OwnBand,
  type OwnSecurity,
  type OwnWifi,
  type RadioSlots,
  SECURITY,
  type WifiOverview,
} from '@zeeli/router-api';
import { useId, useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { bandCategory } from '../../lib/devices.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Swatch } from '../../ui/DeviceIcon.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Row2, SelectField, SwitchRow, TextField, WeekPicker } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { blankForm, formOf, formProblem, generatePassword, type OwnForm, toInput, toPatch } from './own-form.ts';

const SECURITY_CHOICES: [OwnSecurity, string][] = [
  ['sae-mixed', `${SECURITY['sae-mixed']}: works with older devices too`],
  ['sae', `${SECURITY.sae}: newest and strongest`],
  ['psk2', `${SECURITY.psk2}: for old devices`],
];

type Setter = <K extends keyof OwnForm>(key: K) => (value: OwnForm[K]) => void;

interface Props {
  /** The network being edited; `null` adds a new one. */
  network: OwnWifi | null;
  overview: WifiOverview;
  /** The networks page's names for networks, by id. */
  labels: Record<string, string>;
  onClose: () => void;
}

export function OwnNetworkSheet({ network, overview, labels, onClose }: Props) {
  const { toast, confirm } = useFeedback();
  const editing = network !== null;
  const [form, setForm] = useState<OwnForm>(() => (network ? formOf(network) : blankForm(firstNetwork(overview.lanNetworks))));
  const set: Setter = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const save = useWrite(
    async (f: OwnForm) => {
      if (network) {
        await api.wifiNetworks.update(network.id, toPatch(f));
        const was = formOf(network);
        if (f.scheduled !== was.scheduled || f.days.join() !== was.days.join() || f.off !== was.off || f.on !== was.on)
          await api.wifiNetworks.setSchedule(network.id, toInput(f).schedule ?? null);
      } else await api.wifiNetworks.create(toInput(f));
      await api.wifiNetworks.apply();
    },
    [['wifi-networks'], ['wifi'], ['status']],
  );

  async function submit() {
    const problem = formProblem(form, editing);
    if (problem) throw new Error(problem);
    await save.mutateAsync(form);
    toast(
      editing ? `Saved ${form.ssid}. Devices on it reconnect in a few seconds.` : `Added ${form.ssid}. Devices can join in a few seconds.`,
    );
  }

  async function remove() {
    if (!network) return;
    const ok = await confirm({
      title: `Delete “${network.ssid}”?`,
      body: 'Devices on it disconnect and its password is forgotten. This can’t be undone.',
      confirm: 'Delete',
    });
    if (!ok) return;
    try {
      await api.wifiNetworks.remove(network.id);
      await api.wifiNetworks.apply();
      toast(`Deleted ${network.ssid}`);
      onClose();
    } catch (err) {
      toast(`Couldn’t delete: ${errorMessage(err)}`);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={network ? network.ssid : 'Add a WiFi network'}
      sub="Devices on a network reconnect briefly when it changes. Other networks keep running."
      save={editing ? 'Save' : 'Add network'}
      onSave={submit}
      danger={network ? { label: 'Delete network', onClick: remove } : undefined}
      wide
    >
      <TextField label="Network name" value={form.ssid} onChange={set('ssid')} hint="1 to 32 bytes. The name devices see." />
      <PasswordField value={form.password} onChange={set('password')} editing={editing} id={network?.id} />
      <BandPicker form={form} set={set} radios={overview.radios} current={network?.bands ?? []} />
      <JoinFields form={form} set={set} networks={overview.lanNetworks} labels={labels} />
      <SwitchRow label="Hide network name" hint="Devices have to type the name to join." checked={form.hidden} onChange={set('hidden')} />
      <SwitchRow
        label="Keep devices apart"
        hint="Devices on this network can’t talk to each other, only to the internet and the router."
        checked={form.isolate}
        onChange={set('isolate')}
      />
      <ScheduleFields form={form} set={set} />
      <AdvancedFields form={form} set={set} />
    </Sheet>
  );
}

const firstNetwork = (nets: JoinableNetwork[]) => (nets.find((n) => n.id === 'main') ?? nets.find((n) => !n.disabled))?.id ?? 'main';

/** The key, hidden unless asked for, with a generator. An edit leaves it blank to keep the current one. */
function PasswordField({
  value,
  onChange,
  editing,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  editing: boolean;
  id: string | undefined;
}) {
  const input = useId();
  const [shown, setShown] = useState(false);
  const [error, setError] = useState('');

  async function showCurrent() {
    try {
      onChange(await api.wifiNetworks.reveal(id ?? ''));
      setShown(true);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="input">
      <label htmlFor={input}>Password</label>
      <span className="box">
        <input
          id={input}
          type={shown ? 'text' : 'password'}
          className="mono-in"
          value={value}
          placeholder={editing ? 'Unchanged' : undefined}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="reveal" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'}>
          {shown ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          className="reveal"
          onClick={() => {
            onChange(generatePassword());
            setShown(true);
          }}
        >
          Generate
        </button>
        {editing ? (
          <button type="button" className="reveal" onClick={showCurrent}>
            Show current
          </button>
        ) : null}
      </span>
      <span className="hint">{error || '8 to 63 characters. Generate makes a strong one you can read out.'}</span>
    </div>
  );
}

function bandNote(radio: RadioSlots | undefined, full: boolean): string {
  if (!radio) return 'This router has no such radio';
  if (radio.disabled) return 'Radio is switched off';
  return full ? `Full: ${radio.limit} of ${radio.limit} networks` : `${radio.used} of ${radio.limit} networks`;
}

/** Bands as checkboxes with each radio’s slot use. A full or missing radio is off, and says why. */
function BandPicker({ form, set, radios, current }: { form: OwnForm; set: Setter; radios: RadioSlots[]; current: string[] }) {
  const toggle = (band: OwnBand, on: boolean) => {
    set('bands')(on ? OWN_BANDS.filter((b) => b === band || form.bands.includes(b)) : form.bands.filter((b) => b !== band));
    // 6 GHz takes WPA3 only, so choosing it picks WPA3
    if (on && band === '6g') set('security')('sae');
  };
  return (
    <fieldset className="band-picks">
      <legend>Bands</legend>
      {OWN_BANDS.map((band) => {
        const radio = radios.find((r) => r.band === band);
        const held = current.includes(band);
        const full = Boolean(radio && radio.used >= radio.limit && !held);
        const off = !radio || radio.disabled || full;
        return (
          <label className="band-pick" key={band}>
            <input type="checkbox" checked={form.bands.includes(band)} disabled={off} onChange={(e) => toggle(band, e.target.checked)} />
            <Swatch category={bandCategory(band)} />
            <span>{BAND_RADIO[band]}</span>
            <span className="hint">{bandNote(radio, full)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function JoinFields({
  form,
  set,
  networks,
  labels,
}: {
  form: OwnForm;
  set: Setter;
  networks: JoinableNetwork[];
  labels: Record<string, string>;
}) {
  const only6 = form.bands.includes('6g');
  const joinable = networks.filter((n) => !n.disabled || n.id === form.network);
  return (
    <Row2>
      <SelectField
        label="Joins network"
        value={form.network}
        options={joinable.map((n) => [n.id, `${labels[n.id] ?? n.id}${n.disabled ? ' (off)' : ''}`] as const)}
        onChange={set('network')}
        hint="Devices get addresses from this network."
      />
      <SelectField
        label="Security"
        value={only6 ? 'sae' : form.security}
        options={only6 ? SECURITY_CHOICES.filter(([v]) => v === 'sae') : SECURITY_CHOICES}
        onChange={set('security')}
        hint={only6 ? '6 GHz needs WPA3.' : undefined}
      />
    </Row2>
  );
}

function ScheduleFields({ form, set }: { form: OwnForm; set: Setter }) {
  return (
    <section className="group">
      <h3>Schedule</h3>
      <SwitchRow
        label="Turn off at set times"
        hint="The network goes quiet in this window, even if devices are on it."
        checked={form.scheduled}
        onChange={set('scheduled')}
      />
      {form.scheduled ? (
        <>
          <WeekPicker value={form.days} onChange={set('days')} />
          <Row2>
            <TextField label="Turns off at" type="time" value={form.off} onChange={set('off')} />
            <TextField label="Turns on at" type="time" value={form.on} onChange={set('on')} hint="The next morning, if earlier." />
          </Row2>
        </>
      ) : null}
    </section>
  );
}

function AdvancedFields({ form, set }: { form: OwnForm; set: Setter }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="group">
      <h3>
        <button type="button" className="group-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Advanced
        </button>
      </h3>
      {open ? (
        <>
          <SwitchRow
            label="Fast roaming (802.11r)"
            hint="Devices move between radios without a pause. A few old devices can’t join networks that use it."
            checked={form.fastRoaming}
            onChange={set('fastRoaming')}
          />
          <SwitchRow
            label="Neighbour reports (802.11k)"
            hint="Tells devices which radio to move to."
            checked={form.rrm}
            onChange={set('rrm')}
          />
          <SwitchRow
            label="Steering requests (802.11v)"
            hint="Lets the router ask a device to move to a better radio."
            checked={form.bssTransition}
            onChange={set('bssTransition')}
          />
          <SwitchRow
            label="Multicast to unicast"
            hint="Sends streams such as video casting to each device separately, which is steadier on WiFi."
            checked={form.multicastToUnicast}
            onChange={set('multicastToUnicast')}
          />
          <Row2>
            <TextField
              label="Max devices"
              type="number"
              inputMode="numeric"
              value={form.maxClients}
              onChange={set('maxClients')}
              placeholder="No limit"
              hint="1 to 128 per radio."
            />
            <SelectField
              label="Wake-up interval"
              value={form.dtim}
              options={[
                ['', 'Radio default'],
                ...['1', '2', '3', '5', '10'].map((n) => [n, `Every ${n === '1' ? 'beacon' : `${n} beacons`}`] as const),
              ]}
              onChange={set('dtim')}
              hint="Longer saves battery on sleepy devices."
            />
          </Row2>
        </>
      ) : null}
    </section>
  );
}
