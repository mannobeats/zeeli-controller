import { useQuery } from '@tanstack/react-query';
import { type Radio, SECURITY, type WifiNetwork, type WifiRole } from '@zeeli/router-api';
import { useState } from 'react';
import { useClients, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { bandCategory, bandLink, type Category } from '../../lib/devices.ts';
import { errorMessage } from '../../lib/errors.ts';
import { BAND_LABEL } from '../../lib/format.ts';
import { DataTable } from '../../ui/DataTable.tsx';
import { Swatch } from '../../ui/DeviceIcon.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { SelectField, Switch, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, PageHeader, Panel } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

const ROLES: [WifiRole, string, string][] = [
  ['main', 'Your networks', ''],
  ['guest', 'Guest networks', 'Internet only, kept apart from your devices'],
  ['iot', 'IoT networks', 'For smart-home gear on its own subnet'],
];
const bandLabel = (b: string) => BAND_LABEL[b] ?? b;
const categoryOfNet = (n: WifiNetwork): Category => (n.kind === 'mlo' ? 'mlo' : bandCategory(n.bands[0] ?? ''));

export default function WifiPage() {
  const query = useQuery({ queryKey: ['wifi'], queryFn: api.wifi.list });
  const clients = useClients().data ?? [];
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<WifiNetwork | null>(null);
  const toggle = useWrite(
    ({ list, on }: { list: WifiNetwork[]; on: boolean }) => Promise.all(list.map((n) => api.wifi.setEnabled(n, on))),
    [['wifi'], ['status']],
  );

  const clientsOn = (n: WifiNetwork) =>
    clients.filter(
      (c) =>
        c.online &&
        c.link.medium === 'wifi' &&
        (n.kind === 'mlo' ? c.link.band === 'mlo' : c.link.band === bandLink(n.bands[0] ?? '')) &&
        c.link.guest === (n.role === 'guest'),
    ).length;

  async function setOn(list: WifiNetwork[], on: boolean) {
    if (
      !on &&
      !(await confirm({
        title: `Turn off ${list.length === 1 ? list[0]?.ssid : `${list.length} networks`}?`,
        body: 'Devices on them disconnect. If you’re on one of them, you lose this page until you reconnect another way.',
        confirm: 'Turn off',
      }))
    )
      return;
    try {
      await toggle.mutateAsync({ list, on });
      toast(
        `${list.length === 1 ? list[0]?.ssid : `${list.length} networks`} turned ${on ? 'on' : 'off'}. Radios restart for a few seconds.`,
      );
    } catch (err) {
      toast(`Couldn’t change WiFi: ${errorMessage(err)}`);
    }
  }

  return (
    <Loaded query={query} title="WiFi">
      {(nets) => (
        <>
          <PageHeader title="WiFi" />
          {ROLES.map(([role, title, note]) => {
            const list = nets.filter((n) => n.role === role);
            if (!list.length) return null;
            return (
              <Panel key={role} className="section" title={title} note={note}>
                <DataTable
                  label={title}
                  rows={list}
                  rowKey={(n) => n.name}
                  onRowClick={setEditing}
                  rowClass={(n) => (n.enabled ? undefined : 'off')}
                  bulk={[
                    { label: 'Turn on', run: (l) => setOn(l, true), when: (l) => l.some((n) => !n.enabled) },
                    { label: 'Turn off', danger: true, run: (l) => setOn(l, false), when: (l) => l.some((n) => n.enabled) },
                  ]}
                  columns={[
                    {
                      key: 'ssid',
                      header: 'Name',
                      phone: 'title',
                      cell: (n) => (
                        <span className="name">
                          {n.ssid} {n.hidden ? <Chip>Hidden</Chip> : null}
                        </span>
                      ),
                    },
                    {
                      key: 'band',
                      header: 'Band',
                      phone: 'sub',
                      size: 'lg',
                      cell: (n) => (
                        <span className="conn">
                          <Swatch category={categoryOfNet(n)} />
                          {n.kind === 'mlo'
                            ? `MLO · ${n.bands.map(bandLabel).join(' + ')}`
                            : `${bandLabel(n.bands[0] ?? '')}${n.role === 'main' && n.radio ? ` · ch ${n.radio.channel === 'auto' || !n.radio.channel ? 'auto' : n.radio.channel}` : ''}`}
                        </span>
                      ),
                    },
                    { key: 'sec', header: 'Security', size: 'md', cell: (n) => SECURITY[n.encryption] ?? n.encryption },
                    {
                      key: 'clients',
                      header: 'Clients',
                      align: 'end',
                      size: 'sm',
                      cell: (n) => <span className="num">{n.enabled ? clientsOn(n) : '—'}</span>,
                    },
                    {
                      key: 'on',
                      header: 'On',
                      align: 'end',
                      size: 'sm',
                      phone: 'end',
                      cell: (n) => (
                        // biome-ignore lint/a11y/noStaticElementInteractions: stops the row from opening when the switch is used
                        // biome-ignore lint/a11y/useKeyWithClickEvents: the switch inside handles keys itself
                        <span onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={n.enabled}
                            label={`${n.ssid} on`}
                            onChange={(on) => setOn([n], on)}
                            disabled={toggle.isPending}
                          />
                        </span>
                      ),
                    },
                  ]}
                />
              </Panel>
            );
          })}
          {editing ? <WifiSheet key={editing.name} network={editing} onClose={() => setEditing(null)} /> : null}
        </>
      )}
    </Loaded>
  );
}

const ROLE_LABEL: Record<WifiRole, string> = { main: 'Main', guest: 'Guest', iot: 'IoT' };

/** The firmware's limits: SSIDs are bytes, not characters; WPA keys are 8 to 63 characters. */
function checkWifi(ssid: string, encryption: string, key: string) {
  if (!ssid || new TextEncoder().encode(ssid).length > 32) throw new Error('Network name must be 1 to 32 bytes.');
  if (encryption !== 'none' && (key.length < 8 || key.length > 63)) throw new Error('Password must be 8 to 63 characters.');
}

interface RadioEdits {
  channel: string;
  setChannel: (v: string) => void;
  htmode: string;
  setHtmode: (v: string) => void;
  txpower: string;
  setTxpower: (v: string) => void;
}

function useRadioEdits(radio: Radio | null): RadioEdits {
  const [channel, setChannel] = useState<string>(String(radio?.channel ?? 'auto'));
  const [htmode, setHtmode] = useState(radio?.htmode ?? '');
  const [txpower, setTxpower] = useState(radio?.txpower ?? 'max');
  return { channel, setChannel, htmode, setHtmode, txpower, setTxpower };
}

const radioInput = ({ channel, htmode, txpower }: RadioEdits) => ({
  channel: channel === 'auto' ? ('auto' as const) : Number(channel),
  htmode,
  txpower,
});

function WifiSheet({ network: n, onClose }: { network: WifiNetwork; onClose: () => void }) {
  const { toast } = useFeedback();
  const [ssid, setSsid] = useState(n.ssid);
  const [encryption, setEncryption] = useState(n.encryption);
  const [key, setKey] = useState(n.key);
  const [hidden, setHidden] = useState(n.hidden);
  const edits = useRadioEdits(n.radio);
  // radio settings only travel with the main network on each band
  const radio = n.role === 'main' ? n.radio : null;
  const save = useWrite(
    () =>
      api.wifi.save(n, {
        ssid,
        key,
        encryption,
        hidden,
        ...(radio ? radioInput(edits) : {}),
      }),
    [['wifi'], ['status']],
  );
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={n.ssid}
      sub={`${ROLE_LABEL[n.role]} network · ${n.kind === 'mlo' ? 'MLO' : bandLabel(n.bands[0] ?? '')}. Saving restarts the radio; devices reconnect.`}
      onSave={async () => {
        checkWifi(ssid, encryption, key);
        await save.mutateAsync(undefined);
        toast(`Saved ${ssid}. Devices reconnect in a few seconds.`);
      }}
    >
      <TextField label="Network name" value={ssid} onChange={setSsid} />
      <SelectField
        label="Security"
        value={encryption}
        options={n.encryptions.map((e) => [e, SECURITY[e] ?? e] as const)}
        onChange={setEncryption}
        hint={n.bands.includes('6g') ? '6 GHz needs WPA3.' : undefined}
      />
      {encryption === 'none' ? null : (
        <TextField label="Password" type="password" value={key} onChange={setKey} hint="8 to 63 characters" />
      )}
      <SwitchRow label="Hide network name" checked={hidden} onChange={setHidden} />
      {radio ? <RadioFields radio={radio} edits={edits} /> : null}
    </Sheet>
  );
}

function RadioFields({ radio, edits }: { radio: Radio; edits: RadioEdits }) {
  return (
    <>
      <h3>Radio</h3>
      <SelectField
        label="Channel"
        value={edits.channel}
        options={[['auto', 'Automatic'], ...radio.channels.map((c) => [String(c), `Channel ${c}`] as const)]}
        onChange={edits.setChannel}
      />
      {radio.htmodes.length ? (
        <SelectField
          label="Channel width"
          value={edits.htmode}
          options={radio.htmodes.map((m) => [m, m.replace(/^(HE|EHT|VHT|HT)/, '')] as const).map(([v, l]) => [v, `${l} MHz`] as const)}
          onChange={edits.setHtmode}
        />
      ) : null}
      <SelectField
        label="Transmit power"
        value={edits.txpower}
        options={[
          ['max', 'Maximum'],
          ['high', 'High'],
          ['medium', 'Medium'],
          ['low', 'Low'],
        ]}
        onChange={edits.setTxpower}
        hint="Lower power can help in apartments where networks overlap."
      />
    </>
  );
}
