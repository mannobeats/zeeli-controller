import { screen, within } from '@testing-library/react';
import { beforeAll, expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import { ProfilesPage, TailscalePage, TunnelsPage, VpnOverviewPage, ZeroTierPage } from './pages.tsx';

beforeAll(() => api.session.login('demo'));

const form = async (title: string) =>
  within((await screen.findByRole('heading', { name: title, level: 2 })).closest('form') as HTMLElement);
const card = async (title: string) => within((await screen.findByRole('heading', { name: title })).closest('section') as HTMLElement);
const tunnelNames = async () => (await api.vpn.tunnels()).tunnels.map((t) => t.name);

test('a new tunnel for chosen networks and sites', async () => {
  const user = await renderPage(<TunnelsPage />);
  await user.click(await screen.findByRole('button', { name: 'New tunnel' }));
  const s = await sheet();
  expect((s.getByLabelText('Name') as HTMLInputElement).value).toBe('Tunnel 1');
  await user.selectOptions(s.getByLabelText('For'), 'interface');
  await user.click(s.getByRole('checkbox', { name: 'Main LAN' }));
  await user.click(s.getByRole('button', { name: 'Add tunnel' }));
  expect((await s.findByRole('alert')).textContent).toBe('Pick at least one network.');
  await user.click(s.getByRole('checkbox', { name: 'Guest network' }));
  await user.selectOptions(s.getByLabelText('For sites'), 'domain');
  await user.type(s.getByLabelText('Sites, one per line'), 'netflix.com{enter}hulu.com');
  await user.click(s.getByRole('button', { name: 'Add tunnel' }));
  await expectToast('Added Tunnel 1');
  const [t] = (await api.vpn.tunnels()).tunnels;
  expect(t).toMatchObject({ name: 'Tunnel 1', from: { interface_list: ['guest'] }, to: { domain_list: 'netflix.com\nhulu.com' } });
});

test('a tunnel for chosen devices needs a device', async () => {
  const user = await renderPage(<TunnelsPage />);
  await user.click(await screen.findByRole('button', { name: 'New tunnel' }));
  const s = await sheet();
  await user.clear(s.getByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'Kids');
  await user.selectOptions(s.getByLabelText('For'), 'mac');
  await user.click(s.getByRole('button', { name: 'Add tunnel' }));
  expect((await s.findByRole('alert')).textContent).toBe('Pick at least one device.');
  const [device] = await api.clients.list();
  // the device list loads separately from the sheet, so wait for it
  await user.click((await s.findAllByRole('checkbox', { name: (device as { name: string }).name }))[0] as HTMLElement);
  await user.click(s.getByRole('button', { name: 'Add tunnel' }));
  await expectToast('Added Kids');
  expect(await tunnelNames()).toContain('Kids');
});

test('deleting tunnels asks first', async () => {
  await api.vpn.addTunnel({ name: 'Old', from: { type: 'default' }, to: { type: 'default' }, profile: 'wireguard|7|1' });
  const user = await renderPage(<TunnelsPage />);
  const table = await screen.findByRole('table', { name: 'Tunnels' });
  await user.click(within(table).getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete' }));
  await expectToast('Deleted');
  expect(await tunnelNames()).toEqual([]);
});

test('traffic outside every tunnel can be blocked', async () => {
  const user = await renderPage(<TunnelsPage />);
  const f = await form('Everything else');
  await user.click(f.getByRole('checkbox', { name: 'Traffic no tunnel matches goes out normally' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('Other traffic is blocked');
  expect((await api.vpn.tunnels()).fallthrough).toBe(false);
});

test('importing a pasted WireGuard profile into a new group', async () => {
  const user = await renderPage(<ProfilesPage />);
  await user.click(await screen.findByRole('button', { name: 'Import profile' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Import' }));
  expect((await s.findByRole('alert')).textContent).toBe('Choose a file or paste the profile.');
  await user.type(s.getByLabelText('Profile text'), 'PrivateKey = x');
  await user.click(s.getByRole('button', { name: 'Import' }));
  expect(await s.findByText('Name the new group.')).toBeTruthy();
  await user.type(s.getByLabelText('New group name'), 'Travel');
  await user.click(s.getByRole('button', { name: 'Import' }));
  await expectToast('Profile imported');
  expect(await api.vpn.groups()).toContainEqual(expect.objectContaining({ name: 'Travel', kind: 'wireguard', count: 1 }));
});

test('importing an OpenVPN file into an existing group with credentials', async () => {
  await api.vpn.importProfile('openvpn', { newName: 'Work' }, new File(['client'], 'a.ovpn'));
  const user = await renderPage(<ProfilesPage />);
  await user.click(await screen.findByRole('button', { name: 'Import profile' }));
  const s = await sheet();
  await user.selectOptions(s.getByLabelText('Type'), 'openvpn');
  await user.selectOptions(s.getByLabelText('Group'), 'Work');
  await user.upload(s.getByLabelText(/^Profile file/), new File(['client'], 'office.ovpn'));
  await user.type(s.getByLabelText(/^Username/), 'me');
  await user.type(s.getByLabelText(/^Password/), 'secret');
  await user.click(s.getByRole('button', { name: 'Import' }));
  await expectToast('Profile imported');
  expect(await api.vpn.groups()).toContainEqual(expect.objectContaining({ name: 'Work', kind: 'openvpn', count: 2 }));
});

test('signing out of Tailscale asks first', async () => {
  const user = await renderPage(<TailscalePage />);
  await user.click(await screen.findByRole('button', { name: 'Sign out' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Sign out' }));
  await expectToast('Signed out of Tailscale');
});

test('Tailscale settings: an exit node, and turning it off asks first', async () => {
  const user = await renderPage(<TailscalePage />);
  const f = await form('Settings');
  await user.selectOptions(await f.findByLabelText('Send this router’s traffic through'), 'office-mac');
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('Tailscale saved');
  expect(await api.vpn.tailscale.config.get()).toMatchObject({ exit_node_ip: '100.64.0.9' });
  await user.click(f.getByRole('checkbox', { name: 'Tailscale on' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Cancel' }));
  expect(await api.vpn.tailscale.config.get()).toMatchObject({ enabled: true });
});

test('ZeroTier needs a 16-character network ID', async () => {
  const user = await renderPage(<ZeroTierPage />);
  const f = await form('ZeroTier');
  await user.click(f.getByRole('checkbox', { name: 'ZeroTier on' }));
  await user.type(f.getByLabelText('Network ID'), 'abc');
  await user.click(f.getByRole('button', { name: 'Save' }));
  expect((await f.findByRole('alert')).textContent).toBe('A ZeroTier network ID is 16 hex characters.');
  await user.type(f.getByLabelText('Network ID'), 'def0123456789');
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('ZeroTier on');
  expect(await api.vpn.zerotier.get()).toMatchObject({ enabled: true, id: 'abcdef0123456789' });
});

test('the overview shows each VPN and links to its page', async () => {
  const user = await renderPage(<VpnOverviewPage />);
  const ts = await card('Tailscale');
  expect(await ts.findByText('demo@example.com')).toBeTruthy();
  expect(await ts.findByText('Connected')).toBeTruthy();
  expect(await (await card('WireGuard server')).findByRole('button', { name: 'Peers and keys' })).toBeTruthy();
  expect(await (await card('VPN client')).findByText('0 of 5')).toBeTruthy();
  expect(await (await card('OpenVPN server')).findByText('Not set up')).toBeTruthy();
  const zt = await card('ZeroTier');
  await user.click(zt.getByRole('button', { name: 'Manage' }));
  expect(location.hash).toBe('#zerotier');
});
