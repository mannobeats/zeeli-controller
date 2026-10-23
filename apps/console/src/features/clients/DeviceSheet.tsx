import { type Client, type DeviceClass, KIB_PER_MBPS } from '@zeeli/router-api';
import { type ReactNode, useState } from 'react';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { DEVICE_CLASS_LABELS } from '../../lib/devices.ts';
import { ago, bytes, rate } from '../../lib/format.ts';
import { useSamples } from '../../lib/useSamples.ts';
import { Button } from '../../ui/Button.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Row2, SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { KeyValues } from '../../ui/Layout.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Sparkline } from '../../ui/Sparkline.tsx';
import { DeviceAddress } from './DeviceAddress.tsx';
import { DeviceGroups } from './DeviceGroups.tsx';
import { DeviceHistory } from './DeviceHistory.tsx';
import { useNewDevices } from './localNames.ts';
import { NewDeviceCard } from './Onboarding.tsx';

const toMbps = (kib: number) => Number((kib / KIB_PER_MBPS).toFixed(1));

interface Props {
  client: Client | null;
  onClose: () => void;
  onBlock: (c: Client) => void;
  onForget: (c: Client) => void;
}

export function DeviceSheet({ client, ...rest }: Props) {
  const isNew = useNewDevices().some((c) => c.mac === client?.mac);
  if (!client) return null;
  // starting over when it stops being new, so the panel never saves the name it had before
  return <DeviceForm key={`${client.mac}${isNew}`} client={client} isNew={isNew} {...rest} />;
}

/** Everything the panel saves together: name, type and speed limit. */
function useDeviceEdits(client: Client) {
  const [name, setName] = useState(client.alias || client.name);
  const [deviceClass, setDeviceClass] = useState<DeviceClass>(client.deviceClass);
  const [limited, setLimited] = useState(Boolean(client.limitRx || client.limitTx));
  const [down, setDown] = useState(client.limitRx ? String(toMbps(client.limitRx)) : '');
  const [up, setUp] = useState(client.limitTx ? String(toMbps(client.limitTx)) : '');
  const save = useWrite(async () => {
    const [limDown, limUp] = limited ? [Number(down) || 0, Number(up) || 0] : [0, 0];
    if (limited && (limDown < 0 || limUp < 0 || (!limDown && !limUp))) throw new Error('Enter a download or upload limit in Mbps.');
    if (name !== (client.alias || client.name) || deviceClass !== client.deviceClass)
      await api.clients.setInfo(client.mac, name.trim(), deviceClass);
    if (limDown !== toMbps(client.limitRx) || limUp !== toMbps(client.limitTx)) await api.clients.setSpeedLimit(client.mac, limDown, limUp);
  }, [['clients'], ['names']]);
  return { name, setName, deviceClass, setDeviceClass, limited, setLimited, down, setDown, up, setUp, save };
}

function DeviceForm({ client, isNew, onClose, onBlock, onForget }: Props & { client: Client; isNew: boolean }) {
  const { toast } = useFeedback();
  const edits = useDeviceEdits(client);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={client.name}
      sub={client.online ? `${client.link.label} · ${client.ip}` : `Offline · last connected ${ago(client.since)}`}
      danger={{ label: client.blocked ? 'Unblock' : 'Block', onClick: () => onBlock(client) }}
      onSave={async () => {
        await edits.save.mutateAsync(undefined);
        toast(`Saved ${edits.name || client.name}`);
      }}
    >
      {isNew ? <NewDeviceCard client={client} /> : null}
      <LiveRates client={client} />
      {isNew ? null : (
        <section>
          <h3>Name and type</h3>
          <div className="stack-sm">
            <TextField label="Name" value={edits.name} onChange={edits.setName} placeholder={client.hostname || client.mac} />
            <SelectField label="Device type" value={edits.deviceClass} options={DEVICE_CLASS_LABELS} onChange={edits.setDeviceClass} />
          </div>
        </section>
      )}
      <section>
        <h3>Speed limit</h3>
        <SwitchRow label="Limit this device" checked={edits.limited} onChange={edits.setLimited} />
        {edits.limited ? (
          <Row2>
            <TextField label="Download" unit="Mbps" inputMode="decimal" value={edits.down} onChange={edits.setDown} />
            <TextField label="Upload" unit="Mbps" inputMode="decimal" value={edits.up} onChange={edits.setUp} />
          </Row2>
        ) : null}
      </section>
      <DeviceGroups client={client} />
      <DeviceAddress client={client} />
      <DeviceHistory client={client} />
      <Details client={client} onForget={onForget} />
    </Sheet>
  );
}

function LiveRates({ client }: { client: Client }) {
  const live = useClients();
  const now = live.data?.find((c) => c.mac === client.mac) ?? client;
  const samples = useSamples<[number, number]>([now.rx, now.tx], live.dataUpdatedAt);
  return (
    <section>
      <div className="drawer-rates">
        <Rate label="Download" value={now.online ? now.rx : null} kind="down" />
        <Rate label="Upload" value={now.online ? now.tx : null} kind="up" />
      </div>
      {now.online ? <Sparkline samples={samples} width={380} height={64} label="Traffic since this panel opened" /> : null}
    </section>
  );
}

function Details({ client, onForget }: { client: Client; onForget: (c: Client) => void }) {
  const rows: [string, ReactNode][] = [
    [
      'MAC',
      <span key="m" className="mono">
        {client.mac}
      </span>,
    ],
  ];
  if (client.ipv6[0])
    rows.push([
      'IPv6',
      <span key="v6" className="mono">
        {client.ipv6[0]}
      </span>,
    ]);
  rows.push(
    ['Connected to', client.link.label],
    [
      client.online ? 'Online since' : 'Last connected',
      new Date(client.since * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
    ],
    ['Downloaded', bytes(client.totalRx)],
    ['Uploaded', bytes(client.totalTx)],
  );
  return (
    <section>
      <h3>Details</h3>
      <KeyValues rows={rows} />
      <div className="section-actions">
        <Button variant="ghost" onClick={() => navigate(`activity?device=${encodeURIComponent(client.mac)}`)}>
          See its activity
        </Button>
        {client.online ? null : (
          <Button variant="ghost" onClick={() => onForget(client)}>
            Forget this device
          </Button>
        )}
      </div>
    </section>
  );
}

function Rate({ label, value, kind }: { label: string; value: number | null; kind: 'down' | 'up' }) {
  const r = value === null ? null : rate(value);
  return (
    <div className={`rate ${kind}`}>
      <span className="label">{label}</span>
      <span className="value num">
        {r ? (
          <>
            {r.value}
            <small>{r.unit}</small>
          </>
        ) : (
          '—'
        )}
      </span>
    </div>
  );
}
