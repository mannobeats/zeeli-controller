import type { OwnBand, WifiOverview } from '@zeeli/router-api';
import { SwitchRow } from '../../ui/fields.tsx';
import type { OwnForm } from './own-form.ts';

/** Bands a multi-link network could join right now: the firmware allows them and the radio has a free slot. */
function mloBandsFree(overview: WifiOverview): OwnBand[] {
  return overview.mlo.bands.filter((band) => {
    const radio = overview.radios.find((r) => r.band === band);
    return radio && !radio.disabled && radio.used < radio.limit;
  });
}

/** Why multi-link can’t be chosen, or null when it can. */
function whyNot(overview: WifiOverview): string | null {
  if (!overview.mlo.supported) return overview.mlo.reason ?? 'This router doesn’t support multi-link networks.';
  if (mloBandsFree(overview).length < 2) return 'Multi-link needs two bands that support it and have room for another network.';
  return null;
}

interface Props {
  form: OwnForm;
  overview: WifiOverview;
  editing: boolean;
  onChange: (patch: Partial<OwnForm>) => void;
}

/** One name that devices use over several bands at once (Wi-Fi 7). Can’t be switched once the network exists. */
export function MloRow({ form, overview, editing, onChange }: Props) {
  const blocked = editing ? null : whyNot(overview);
  function toggle(on: boolean) {
    if (!on) return onChange({ mlo: false });
    const free = mloBandsFree(overview);
    // the pair most devices handle best, else whatever two the router can do
    const bands = free.includes('5g') && free.includes('6g') ? (['5g', '6g'] as OwnBand[]) : free.slice(0, 2);
    onChange({ mlo: true, bands, security: 'sae' });
  }
  const hint = editing
    ? 'Devices use all the bands at once. To change the bands or the network, delete this one and make it again.'
    : (blocked ?? 'One name over two or three bands. Wi-Fi 7 devices use them together; others join one band. Needs WPA3.');
  return <SwitchRow label="Multi-link (Wi-Fi 7)" hint={hint} checked={form.mlo} onChange={toggle} disabled={editing || blocked !== null} />;
}
