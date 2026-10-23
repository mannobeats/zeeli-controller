import type { JoinableNetwork, OwnBand, WifiOverview } from '@zeeli/router-api';
import { mloPick } from './MloRow.tsx';
import type { OwnForm } from './own-form.ts';

export type PresetId = 'home' | 'guest' | 'iot' | 'fast';

export const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: 'home', label: 'Home', hint: '2.4 and 5 GHz, WPA2/WPA3. Works with everything.' },
  { id: 'guest', label: 'Guest', hint: '2.4 and 5 GHz, devices kept apart. Pick hours below if you like.' },
  { id: 'iot', label: 'IoT', hint: '2.4 GHz only, WPA2. For plugs, bulbs and old gadgets.' },
  { id: 'fast', label: 'Fast', hint: 'Multi-link if the router can, else 5 and 6 GHz. WPA3 only.' },
];

/** Which network a preset belongs on, by the network’s id or name. */
const PURPOSE: Record<PresetId, RegExp> = { home: /^main$/i, guest: /guest/i, iot: /iot/i, fast: /^main$/i };

/** Bands the router can take another network on right now, out of `wanted`. */
function usable(overview: WifiOverview, wanted: OwnBand[]): OwnBand[] {
  return wanted.filter((band) => {
    const radio = overview.radios.find((r) => r.band === band);
    return radio && !radio.disabled && radio.used < radio.limit;
  });
}

const findNetwork = (id: PresetId, nets: JoinableNetwork[], labels: Record<string, string>) =>
  nets.find((n) => !n.disabled && (PURPOSE[id].test(n.id) || PURPOSE[id].test(labels[n.id] ?? '')))?.id;

const PLAIN = { mlo: false, scheduled: false, isolate: false } as const;

/** What a preset sets: security, bands, isolation, schedule and, when one of matching purpose exists, the network. */
export function presetPatch(id: PresetId, overview: WifiOverview, labels: Record<string, string>): Partial<OwnForm> {
  const network = findNetwork(id, overview.lanNetworks, labels);
  const patch = { ...(network ? { network } : {}), ...PLAIN };
  if (id === 'home') return { ...patch, security: 'sae-mixed', bands: usable(overview, ['2g', '5g']) };
  if (id === 'guest') return { ...patch, security: 'sae-mixed', bands: usable(overview, ['2g', '5g']), isolate: true };
  if (id === 'iot') return { ...patch, security: 'psk2', bands: usable(overview, ['2g']) };
  const mlo = mloPick(overview);
  return mlo ? { ...patch, security: 'sae', mlo: true, bands: mlo } : { ...patch, security: 'sae', bands: usable(overview, ['5g', '6g']) };
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** “Only on these hours” for guests: the network is on from `on` to `off`. */
export const HOURS: { label: string; patch: Partial<OwnForm> }[] = [
  { label: 'Daytime 8–22', patch: { scheduled: true, days: EVERY_DAY, off: '22:00', on: '08:00' } },
  { label: 'Evenings 16–23', patch: { scheduled: true, days: EVERY_DAY, off: '23:00', on: '16:00' } },
  { label: 'Workdays 8–18', patch: { scheduled: true, days: [1, 2, 3, 4, 5], off: '18:00', on: '08:00' } },
];
