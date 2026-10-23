import type { AgentZone, MdnsStatus } from '@zeeli/router-api';
import { useState } from 'react';
import { api } from '../../api/router.ts';
import { errorMessage } from '../../lib/errors.ts';
import { Button } from '../../ui/Button.tsx';
import { ChipPicker, Switch } from '../../ui/fields.tsx';
import { Note, Panel } from '../../ui/Layout.tsx';
import type { Apply } from './AccessGrid.tsx';
import { gridZones } from './access.ts';
import { zoneLabel } from './labels.ts';

/** The mDNS reflector: lets AirPlay, Chromecast and printers be found from another network. */
export function Discovery({ zones, status, apply }: { zones: AgentZone[]; status: MdnsStatus; apply: Apply }) {
  const nets = gridZones(zones);
  const [picked, setPicked] = useState(status.zones.length ? status.zones : nets.slice(0, 2).map((z) => z.name));
  const [problem, setProblem] = useState('');
  if (!status.available || nets.length < 2) return null;

  async function save(enabled: boolean) {
    setProblem('');
    const done = enabled ? 'Devices can now find each other' : 'Devices no longer find each other across networks';
    try {
      await apply(done, () => api.safety.mdns.set(enabled, picked));
    } catch (err) {
      setProblem(errorMessage(err));
    }
  }

  return (
    <Panel
      className="section"
      title="Let devices find each other across networks"
      note="AirPlay, Chromecast and printers announce themselves only on their own network. This repeats those announcements between the networks you choose."
      actions={<Switch checked={status.enabled} label="Let devices find each other across networks" onChange={save} />}
    >
      <ChipPicker
        legend="Networks that share devices"
        options={nets.map((z) => [z.name, zoneLabel(z.name)] as const)}
        value={picked}
        onChange={setPicked}
      />
      {problem ? (
        <p className="kicker" role="alert">
          {problem}
        </p>
      ) : null}
      {status.enabled ? (
        <div className="row-actions start">
          <Button disabled={picked.join() === status.zones.join()} onClick={() => save(true)}>
            Save networks
          </Button>
        </div>
      ) : null}
      <Note>
        This only lets devices be found. Connecting to one still needs the access above (for example Main reaching IoT). It opens UDP port
        5353 to the router from the chosen networks.
      </Note>
    </Panel>
  );
}
