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
  if (overview.restartNeeded) return 'Restart the router first: a multi-link network you deleted is still on the air.';
  if (!overview.mlo.supported) return overview.mlo.reason ?? 'This router doesn’t support multi-link networks.';
  if (mloBandsFree(overview).length < 2) return 'Multi-link needs two bands that support it and have room for another network.';
  return null;
}

/** The bands a new multi-link network would take: the pair most devices handle best, else any two. Null when it can’t be made. */
export function mloPick(overview: WifiOverview): OwnBand[] | null {
  if (whyNot(overview)) return null;
  const free = mloBandsFree(overview);
  return free.includes('5g') && free.includes('6g') ? ['5g', '6g'] : free.slice(0, 2);
}

interface Props {
  form: OwnForm;
  overview: WifiOverview;
  onChange: (patch: Partial<OwnForm>) => void;
}

/** One name that devices use over several bands at once (Wi-Fi 7), for a new network. */
export function MloRow({ form, overview, onChange }: Props) {
  const blocked = whyNot(overview);
  function toggle(on: boolean) {
    if (!on) return onChange({ mlo: false });
    onChange({ mlo: true, bands: mloPick(overview) ?? [], security: 'sae' });
  }
  const hint =
    blocked ??
    'One name over two or three bands. Wi-Fi 7 devices use them together; others join one band. Needs WPA3. Once made it can’t be changed or switched off, and deleting it needs a router restart (about two minutes offline).';
  return <SwitchRow label="Multi-link (Wi-Fi 7)" hint={hint} checked={form.mlo} onChange={toggle} disabled={blocked !== null} />;
}
