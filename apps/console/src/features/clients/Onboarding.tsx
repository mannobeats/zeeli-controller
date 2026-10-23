import type { Client, DeviceClass } from '@zeeli/router-api';
import { useState } from 'react';
import { useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { DEVICE_CLASS_LABELS, friendlyName, suggestClass } from '../../lib/devices.ts';
import { ago } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DeviceIcon } from '../../ui/DeviceIcon.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Panel } from '../../ui/Layout.tsx';
import { useGroupList } from '../policies/queries.ts';
import { attempt, keepIp } from './localNames.ts';

/** Devices that joined recently and haven't been set up: a way in to the onboarding card. */
export function NewDevices({ devices, onOpen }: { devices: Client[]; onOpen: (mac: string) => void }) {
  if (!devices.length) return null;
  return (
    <Panel title="New devices" note="Joined recently and not set up yet">
      {devices.map((c) => (
        <div className="field-row" key={c.mac}>
          <div className="dev-cell">
            <DeviceIcon client={c} />
            {c.hostname || c.mac}
            <span className="muted">{c.online ? `connected ${ago(c.since)}` : 'offline'}</span>
          </div>
          <Button variant="strong" onClick={() => onOpen(c.mac)}>
            Set up
          </Button>
        </div>
      ))}
    </Panel>
  );
}

/** Name it, give it a type, file it in a group and keep its address: one card, one button. */
export function NewDeviceCard({ client }: { client: Client }) {
  const { toast } = useFeedback();
  const groups = useGroupList().data ?? [];
  const [name, setName] = useState(() => friendlyName(client.hostname));
  const [type, setType] = useState<DeviceClass>(() => suggestClass(client));
  const [group, setGroup] = useState('');
  const [keep, setKeep] = useState(true);
  const failed = 'Couldn’t finish setting this up: ';
  const refresh = [['clients'], ['names'], ['reservations'], ['groups']];
  const finish = useWrite(async () => {
    const label = name.trim();
    if (label || type) await api.clients.setInfo(client.mac, label, type);
    if (keep) await keepIp(client, label || client.name);
    if (group) await api.policies.groups.addMembers(group, [client.mac]);
    await api.names.dismiss([client.mac]);
  }, refresh);
  const skip = useWrite(() => api.names.dismiss([client.mac]), refresh);
  return (
    <section>
      <h3>New device</h3>
      <div className="stack-sm">
        <div className="hint">
          Joined {ago(client.since)}
          {client.hostname ? ` as ${client.hostname}` : ''}. Name it, and it answers to that name on your network.
        </div>
        <TextField label="Name" value={name} onChange={setName} placeholder={client.hostname || client.mac} />
        <SelectField label="Device type" value={type} options={DEVICE_CLASS_LABELS} onChange={setType} />
        {groups.length ? (
          <SelectField
            label="Group"
            value={group}
            onChange={setGroup}
            options={[['', 'No group'], ...groups.map((g) => [g.id, g.name] as const)]}
          />
        ) : null}
        <SwitchRow label="Keep this IP" hint={`Always give it ${client.ip}`} checked={keep} onChange={setKeep} />
        <div className="section-actions">
          <Button
            variant="strong"
            busy={finish.isPending}
            onClick={() => attempt(toast, finish, `${name.trim() || client.name} is set up`, failed)}
          >
            Done
          </Button>
          <Button variant="ghost" busy={skip.isPending} onClick={() => attempt(toast, skip, 'Left as it is', failed)}>
            Not now
          </Button>
        </div>
      </div>
    </section>
  );
}
