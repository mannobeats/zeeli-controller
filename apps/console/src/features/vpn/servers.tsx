import { IconDownload, IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { isIpv4, maskToPrefix, OVPN_AUTH, type OvpnServerConfig, prefixToMask, type WgPeer } from '@zeeli/router-api';
import { useState } from 'react';
import { useStatus, useWrite } from '../../api/queries.ts';
import { api } from '../../api/router.ts';
import { useSettings } from '../../api/useSettings.ts';
import { errorMessage } from '../../lib/errors.ts';
import { saveBlob } from '../../lib/files.ts';
import { plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { DataTable } from '../../ui/DataTable.tsx';
import { useFeedback } from '../../ui/feedback.tsx';
import { Row2, SelectField, SwitchRow, TextField } from '../../ui/fields.tsx';
import { Chip, Empty, Grid, KeyValues, Note, PageHeader, Panel, ToneText } from '../../ui/Layout.tsx';
import { Loaded } from '../../ui/Loading.tsx';
import { SettingsForm, useForm } from '../../ui/SettingsForm.tsx';
import { Sheet } from '../../ui/Sheet.tsx';

/** Starts or stops a VPN server. Stopping asks first, since it drops whoever is connected. */
function RunButton({
  server,
  on,
  run,
  stopBody,
}: {
  server: string;
  on: boolean;
  run: { mutateAsync: (start: boolean) => Promise<unknown>; isPending: boolean };
  stopBody: string;
}) {
  const { toast, confirm } = useFeedback();
  return (
    <Button
      variant={on ? 'danger' : 'strong'}
      busy={run.isPending}
      onClick={async () => {
        if (on && !(await confirm({ title: `Stop the ${server} server?`, body: stopBody, confirm: 'Stop server' }))) return;
        try {
          await run.mutateAsync(!on);
          toast(`${server} server ${on ? 'stopped' : 'started'}`);
        } catch (err) {
          toast(errorMessage(err));
        }
      }}
    >
      {on ? 'Stop server' : 'Start server'}
    </Button>
  );
}

/* ======================= WireGuard server ======================= */

export function WireGuardPage() {
  const { toast, confirm } = useFeedback();
  const status = useStatus().data;
  const on = status?.services.find((s) => s.name === 'wgserver')?.running ?? false;
  const cfg = useQuery({ queryKey: ['wg-config'], queryFn: api.vpn.wireguard.config });
  const peers = useQuery({ queryKey: ['wg-peers'], queryFn: api.vpn.wireguard.peers });
  const setting = useSettings('wg-setting', api.vpn.wireguard.setting);
  const run = useWrite((start: boolean) => api.vpn.wireguard.run(start), [['status']]);
  const remove = useWrite((ids: number[]) => api.vpn.wireguard.removePeers(ids), [['wg-peers']]);
  const [adding, setAdding] = useState(false);
  const [showing, setShowing] = useState<WgPeer | null>(null);

  return (
    <Loaded query={cfg} title="WireGuard server">
      {(c) => (
        <>
          <PageHeader
            title="WireGuard server"
            sub="Reach your home network from anywhere with a WireGuard app."
            actions={
              peers.data?.length ? (
                <RunButton server="WireGuard" on={on} run={run} stopBody={`${plural(peers.data?.length ?? 0, 'peer')} disconnect.`} />
              ) : null
            }
          />
          <Grid cols={2}>
            <Panel title="Server" actions={on ? <Chip tone="ok">Running</Chip> : <ToneText tone="off">Stopped</ToneText>}>
              <KeyValues
                rows={[
                  [
                    'Address',
                    <span key="a" className="mono">
                      {c.address_v4}
                    </span>,
                  ],
                  ['Port', `${c.port} UDP`],
                  [
                    'IPv6',
                    <span key="6" className="mono">
                      {c.address_v6 || '—'}
                    </span>,
                  ],
                ]}
              />
            </Panel>
            <Loaded query={setting.query} title="">
              {(st) => <WgOptions cfg={st} save={setting.save} />}
            </Loaded>
          </Grid>
          <Panel
            className="section"
            title="Peers"
            actions={
              <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setAdding(true)}>
                Add peer
              </Button>
            }
          >
            {peers.data?.length ? (
              <DataTable
                label="Peers"
                rows={peers.data}
                rowKey={(p) => String(p.id)}
                onRowClick={setShowing}
                bulk={[
                  {
                    label: 'Remove',
                    danger: true,
                    run: async (list) => {
                      if (
                        !(await confirm({
                          title: `Remove ${list.length === 1 ? list[0]?.name : plural(list.length, 'peer')}?`,
                          body: 'Their keys stop working right away.',
                          confirm: 'Remove',
                        }))
                      )
                        return;
                      try {
                        await remove.mutateAsync(list.map((p) => p.id));
                        toast('Removed');
                      } catch (err) {
                        toast(errorMessage(err));
                      }
                    },
                  },
                ]}
                columns={[
                  { key: 'name', header: 'Peer', phone: 'title', cell: (p) => <span className="name">{p.name}</span> },
                  { key: 'addr', header: 'Address', phone: 'sub', cell: (p) => <span className="mono">{p.address}</span> },
                  {
                    key: 'cfg',
                    header: '',
                    align: 'end',
                    phone: 'end',
                    cell: () => (
                      <Button variant="ghost" icon={<IconDownload size={16} />}>
                        Config
                      </Button>
                    ),
                  },
                ]}
              />
            ) : (
              <Empty>No peers. Add one for each phone or laptop, then scan its config into the WireGuard app.</Empty>
            )}
          </Panel>
          {adding ? <AddPeer onClose={() => setAdding(false)} onAdded={setShowing} /> : null}
          {showing ? <PeerConfig peer={showing} onClose={() => setShowing(null)} /> : null}
        </>
      )}
    </Loaded>
  );
}

function WgOptions({
  cfg,
  save,
}: {
  cfg: { masq: boolean; local_access: boolean; client_to_client: boolean };
  save: (v: Partial<typeof cfg>) => Promise<unknown>;
}) {
  const form = useForm(cfg);
  return (
    <SettingsForm
      title="Options"
      form={form}
      onSave={async () => {
        await save(form.values);
        return 'WireGuard options saved';
      }}
    >
      <SwitchRow label="Peers can reach this LAN" checked={form.values.local_access} onChange={(x) => form.set('local_access', x)} />
      <SwitchRow
        label="Peers can reach each other"
        checked={form.values.client_to_client}
        onChange={(x) => form.set('client_to_client', x)}
      />
      <SwitchRow label="Masquerade peer traffic" checked={form.values.masq} onChange={(x) => form.set('masq', x)} />
    </SettingsForm>
  );
}

function AddPeer({ onClose, onAdded }: { onClose: () => void; onAdded: (p: WgPeer) => void }) {
  const [name, setName] = useState('');
  const add = useWrite((n: string) => api.vpn.wireguard.addPeer(n), [['wg-peers']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a WireGuard peer"
      save="Add peer"
      onSave={async () => {
        if (!name.trim()) throw new Error('Give the peer a name.');
        const r = await add.mutateAsync(name.trim());
        if (r.peer_id !== undefined) onAdded({ id: r.peer_id, name: name.trim(), address: '' });
      }}
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="My phone" />
    </Sheet>
  );
}

function PeerConfig({ peer, onClose }: { peer: WgPeer; onClose: () => void }) {
  const config = useQuery({ queryKey: ['wg-peer-config', peer.id], queryFn: () => api.vpn.wireguard.peerConfig(peer.id) });
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${peer.name} configuration`}
      sub="Import this into the WireGuard app. Anyone with it can join your network, so share it privately."
    >
      {config.data ? (
        <>
          <pre className="log">{config.data}</pre>
          <div className="row-actions start">
            <Button
              icon={<IconDownload size={16} />}
              onClick={() => saveBlob(new Blob([config.data], { type: 'text/plain' }), `${peer.name.replace(/\W+/g, '-')}.conf`)}
            >
              Download .conf
            </Button>
          </div>
        </>
      ) : (
        <Note>{config.isError ? errorMessage(config.error) : 'Generating…'}</Note>
      )}
    </Sheet>
  );
}

/* ======================= OpenVPN server ======================= */

export function OpenVpnPage() {
  const { toast, confirm } = useFeedback();
  const status = useStatus().data;
  const on = status?.services.find((s) => s.name === 'ovpnserver')?.running ?? false;
  const cfg = useQuery({ queryKey: ['ovpn-config'], queryFn: api.vpn.openvpn.config });
  const users = useQuery({ queryKey: ['ovpn-users'], queryFn: api.vpn.openvpn.users });
  const setting = useSettings('ovpn-setting', api.vpn.openvpn.setting);
  const setUp = useWrite(() => api.vpn.openvpn.setUp(), [['ovpn-config']]);
  const run = useWrite((start: boolean) => api.vpn.openvpn.run(start), [['status']]);
  const removeUsers = useWrite((names: string[]) => api.vpn.openvpn.removeUsers(names), [['ovpn-users']]);
  const [sheet, setSheet] = useState<'settings' | 'export' | 'user' | null>(null);

  return (
    <Loaded query={cfg} title="OpenVPN server">
      {(c) => (
        <>
          <PageHeader
            title="OpenVPN server"
            sub="Reach your home network with any OpenVPN app."
            actions={
              c.initialization ? (
                <>
                  <Button onClick={() => setSheet('settings')}>Settings</Button>
                  <Button icon={<IconDownload size={16} />} onClick={() => setSheet('export')}>
                    Client file
                  </Button>
                  <RunButton server="OpenVPN" on={on} run={run} stopBody="Connected clients drop off." />
                </>
              ) : (
                <Button
                  variant="strong"
                  busy={setUp.isPending}
                  onClick={async () => {
                    toast('Creating certificates. This takes a minute or two…');
                    try {
                      await setUp.mutateAsync(undefined);
                      toast('OpenVPN server is set up');
                    } catch (err) {
                      toast(`Setup failed: ${errorMessage(err)}`);
                    }
                  }}
                >
                  Set up server
                </Button>
              )
            }
          />
          <Grid cols={2}>
            <Panel
              title="Server"
              actions={on ? <Chip tone="ok">Running</Chip> : <ToneText tone="off">{c.initialization ? 'Stopped' : 'Not set up'}</ToneText>}
            >
              <KeyValues
                rows={[
                  ['Mode', c.mode === 'tap-s2s' ? 'TAP site to site' : c.mode.toUpperCase()],
                  ['Protocol and port', `${c.proto.toUpperCase()} ${c.port}`],
                  [
                    'Subnet',
                    <span key="s" className="mono">
                      {c.mode === 'tun' ? `${c.subnetv4}/${maskToPrefix(c.mask)}` : `${c.start} – ${c.end}`}
                    </span>,
                  ],
                  ['Cipher', c.cipher],
                  ['Sign-in', OVPN_AUTH[c.client_auth] ?? '—'],
                ]}
              />
              {c.initialization ? null : <Note>Setting up creates the server’s certificates. It takes a minute or two.</Note>}
            </Panel>
            <Loaded query={setting.query} title="">
              {(st) => <OvpnOptions cfg={st} save={setting.save} />}
            </Loaded>
          </Grid>
          <Panel
            className="section"
            title="Users"
            actions={
              <Button variant="strong" icon={<IconPlus size={16} />} onClick={() => setSheet('user')}>
                Add user
              </Button>
            }
          >
            {users.data?.length ? (
              <DataTable
                label="Users"
                rows={users.data}
                rowKey={(u) => u.username}
                bulk={[
                  {
                    label: 'Remove',
                    danger: true,
                    run: async (list) => {
                      if (
                        !(await confirm({
                          title: `Remove ${plural(list.length, 'user')}?`,
                          body: 'They can no longer sign in.',
                          confirm: 'Remove',
                        }))
                      )
                        return;
                      await removeUsers.mutateAsync(list.map((u) => u.username)).then(
                        () => toast('Removed'),
                        (e) => toast(errorMessage(e)),
                      );
                    },
                  },
                ]}
                columns={[{ key: 'name', header: 'Username', phone: 'title', cell: (u) => <span className="name">{u.username}</span> }]}
              />
            ) : (
              <Empty>
                {c.client_auth === 1
                  ? 'No users. Sign-in uses the certificate only, so users are optional.'
                  : 'No users. Add one for each person who signs in.'}
              </Empty>
            )}
          </Panel>
          {sheet === 'settings' ? <OvpnSettings cfg={c} running={on} onClose={() => setSheet(null)} /> : null}
          {sheet === 'export' ? <OvpnExport onClose={() => setSheet(null)} /> : null}
          {sheet === 'user' ? <OvpnUser existing={users.data ?? []} onClose={() => setSheet(null)} /> : null}
        </>
      )}
    </Loaded>
  );
}

function OvpnOptions({ cfg, save }: { cfg: { masq: boolean; local_access: boolean }; save: (v: Partial<typeof cfg>) => Promise<unknown> }) {
  const form = useForm(cfg);
  return (
    <SettingsForm
      title="Options"
      form={form}
      onSave={async () => {
        await save(form.values);
        return 'OpenVPN options saved';
      }}
    >
      <SwitchRow label="Clients can reach this LAN" checked={form.values.local_access} onChange={(x) => form.set('local_access', x)} />
      <SwitchRow label="Masquerade client traffic" checked={form.values.masq} onChange={(x) => form.set('masq', x)} />
    </SettingsForm>
  );
}

function OvpnSettings({ cfg, running, onClose }: { cfg: OvpnServerConfig; running: boolean; onClose: () => void }) {
  const { toast } = useFeedback();
  const [proto, setProto] = useState(cfg.proto);
  const [port, setPort] = useState(String(cfg.port));
  const [subnet, setSubnet] = useState(`${cfg.subnetv4}/${maskToPrefix(cfg.mask)}`);
  const [auth, setAuth] = useState(cfg.client_auth);
  const [cipher, setCipher] = useState(cfg.cipher);
  const [c2c, setC2c] = useState(cfg.client_to_client);
  const save = useWrite((c: Partial<OvpnServerConfig>) => api.vpn.openvpn.setConfig(c), [['ovpn-config']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="OpenVPN server settings"
      sub={
        running
          ? 'Saving restarts the server; every client reconnects with a new file.'
          : 'Download a new client file after changing these.'
      }
      onSave={async () => {
        const [net = '', pre = ''] = subnet.split('/');
        if (!(Number(port) >= 1 && Number(port) <= 65_535)) throw new Error('Port must be 1 to 65535.');
        if (!isIpv4(net) || !(Number(pre) >= 16 && Number(pre) <= 30)) throw new Error('Enter a subnet like 10.8.0.0/24.');
        if (cfg.mode !== 'tun') throw new Error('TAP site-to-site servers are edited in the firmware’s own setup.');
        const { dh: _dh, start: _s, end: _e, tap_address: _ta, tap_mask: _tm, initialization: _i, ...rest } = cfg;
        await save.mutateAsync({
          ...rest,
          proto,
          port: Number(port),
          subnetv4: net,
          mask: prefixToMask(Number(pre)),
          client_auth: auth,
          cipher,
          client_to_client: c2c,
        });
        toast('OpenVPN settings saved. Download a new client file.');
      }}
    >
      <Row2>
        <SelectField
          label="Protocol"
          value={proto}
          options={[
            ['udp', 'UDP'],
            ['tcp', 'TCP'],
          ]}
          onChange={setProto}
        />
        <TextField label="Port" inputMode="numeric" value={port} onChange={setPort} />
      </Row2>
      <TextField label="Client subnet" mono value={subnet} onChange={setSubnet} hint="A private range not used anywhere else." />
      <SelectField
        label="Sign-in"
        value={auth}
        options={Object.entries(OVPN_AUTH).map(([k, l]) => [Number(k) as 1 | 2 | 3, l] as const)}
        onChange={setAuth}
      />
      <SelectField
        label="Cipher"
        value={cipher}
        options={[...new Set([cipher, 'AES-256-GCM', 'AES-128-GCM', 'CHACHA20-POLY1305', 'AES-256-CBC'])].map((x) => [x, x] as const)}
        onChange={setCipher}
      />
      <SwitchRow label="Clients can reach each other" checked={c2c} onChange={setC2c} />
    </Sheet>
  );
}

function OvpnExport({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const addrs = useQuery({ queryKey: ['public-addresses'], queryFn: api.vpn.openvpn.addresses });
  const [address, setAddress] = useState('');
  const chosen = address || addrs.data?.[0] || '';
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Download a client file"
      sub="Import it into an OpenVPN app. Anyone with it can try to connect, so share it privately."
      save="Download"
      onSave={async () => {
        if (!chosen) throw new Error('Enter the address clients connect to.');
        saveBlob(await api.vpn.openvpn.clientFile(chosen), 'client.ovpn');
        toast('client.ovpn downloaded');
      }}
    >
      {addrs.data?.length ? (
        <SelectField
          label="Clients connect to"
          value={chosen}
          options={addrs.data.map((a) => [a, a] as const)}
          onChange={setAddress}
          hint="Use your Dynamic DNS name if your public address changes."
        />
      ) : (
        <TextField label="Clients connect to" value={address} onChange={setAddress} placeholder="Public IP or domain" />
      )}
    </Sheet>
  );
}

function OvpnUser({ existing, onClose }: { existing: { username: string }[]; onClose: () => void }) {
  const { toast } = useFeedback();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const add = useWrite(() => api.vpn.openvpn.addUser(user, pass), [['ovpn-users']]);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add an OpenVPN user"
      save="Add user"
      onSave={async () => {
        if (!user || !pass) throw new Error('Enter a username and a password.');
        if (existing.some((u) => u.username === user)) throw new Error('That username already exists.');
        await add.mutateAsync(undefined);
        toast(`Added ${user}`);
      }}
    >
      <TextField label="Username" value={user} onChange={setUser} />
      <TextField label="Password" type="password" value={pass} onChange={setPass} />
    </Sheet>
  );
}
