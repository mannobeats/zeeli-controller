import { screen, within } from '@testing-library/react';
import { beforeAll, expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import { OpenVpnPage, WireGuardPage } from './servers.tsx';

// jsdom has no object URLs; downloads only need one to exist
beforeAll(async () => {
  Object.assign(URL, { createObjectURL: () => 'blob:demo', revokeObjectURL: () => {} });
  await api.session.login('demo');
});

const optionsForm = async () => within((await screen.findByRole('heading', { name: 'Options' })).closest('form') as HTMLElement);

test('adding a WireGuard peer shows its config', async () => {
  const user = await renderPage(<WireGuardPage />);
  await user.click(await screen.findByRole('button', { name: 'Add peer' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Add peer' }));
  expect((await s.findByRole('alert')).textContent).toBe('Give the peer a name.');
  await user.type(s.getByLabelText('Name'), 'My phone');
  await user.click(s.getByRole('button', { name: 'Add peer' }));
  const config = within(await screen.findByRole('dialog', { name: 'My phone configuration' }));
  expect(await config.findByText(/PublicKey = demo-public-key/)).toBeTruthy();
  await user.click(config.getByRole('button', { name: 'Download .conf' }));
  expect((await api.vpn.wireguard.peers()).map((p) => p.name)).toContain('My phone');
});

test('removing every WireGuard peer leaves the empty state', async () => {
  const user = await renderPage(<WireGuardPage />);
  const table = await screen.findByRole('table', { name: 'Peers' });
  await user.click(within(table).getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Remove' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove' }));
  await expectToast('Removed');
  expect(await screen.findByText(/^No peers\./)).toBeTruthy();
  expect(await api.vpn.wireguard.peers()).toEqual([]);
});

test('starting the WireGuard server and saving its options', async () => {
  await api.vpn.wireguard.addPeer('Laptop');
  const user = await renderPage(<WireGuardPage />);
  await user.click(await screen.findByRole('button', { name: 'Start server' }));
  await expectToast('WireGuard server started');
  const f = await optionsForm();
  await user.click(f.getByRole('checkbox', { name: 'Peers can reach each other' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('WireGuard options saved');
  expect(await api.vpn.wireguard.setting.get()).toMatchObject({ client_to_client: true });
});

test('setting up the OpenVPN server, then changing its settings', async () => {
  const user = await renderPage(<OpenVpnPage />);
  expect(await screen.findByText('Not set up')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Set up server' }));
  await expectToast('OpenVPN server is set up');
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  const s = await sheet();
  await user.clear(s.getByLabelText('Port'));
  await user.type(s.getByLabelText('Port'), '0');
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Port must be 1 to 65535.');
  await user.type(s.getByLabelText('Port'), '1195');
  await user.clear(s.getByLabelText(/^Client subnet/));
  await user.type(s.getByLabelText(/^Client subnet/), '10.9.0.0/8');
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect(await s.findByText('Enter a subnet like 10.8.0.0/24.')).toBeTruthy();
  await user.clear(s.getByLabelText(/^Client subnet/));
  await user.type(s.getByLabelText(/^Client subnet/), '10.9.0.0/24');
  await user.selectOptions(s.getByLabelText('Protocol'), 'tcp');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('OpenVPN settings saved. Download a new client file.');
  expect(await api.vpn.openvpn.config()).toMatchObject({ initialization: true, proto: 'tcp', port: 1195, subnetv4: '10.9.0.0' });
});

test('downloading an OpenVPN client file and starting the server', async () => {
  await api.vpn.openvpn.setUp();
  const user = await renderPage(<OpenVpnPage />);
  await user.click(await screen.findByRole('button', { name: 'Client file' }));
  const s = await sheet();
  await s.findByRole('option', { name: '198.51.100.24' });
  await user.selectOptions(s.getByLabelText(/^Clients connect to/), '198.51.100.24');
  await user.click(s.getByRole('button', { name: 'Download' }));
  await expectToast('client.ovpn downloaded');
  await user.click(screen.getByRole('button', { name: 'Start server' }));
  await expectToast('OpenVPN server started');
});

test('OpenVPN users: add, refuse a duplicate, remove', async () => {
  await api.vpn.openvpn.setUp();
  const user = await renderPage(<OpenVpnPage />);
  await user.click(await screen.findByRole('button', { name: 'Add user' }));
  let s = await sheet();
  await user.click(s.getByRole('button', { name: 'Add user' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter a username and a password.');
  await user.type(s.getByLabelText('Username'), 'maya');
  await user.type(s.getByLabelText(/^Password/), 'secret');
  await user.click(s.getByRole('button', { name: 'Add user' }));
  await expectToast('Added maya');
  await user.click(await screen.findByRole('button', { name: 'Add user' }));
  s = await sheet();
  await user.type(s.getByLabelText('Username'), 'maya');
  await user.type(s.getByLabelText(/^Password/), 'other');
  await user.click(s.getByRole('button', { name: 'Add user' }));
  expect((await s.findByRole('alert')).textContent).toBe('That username already exists.');
  await user.keyboard('{Escape}');
  await user.click(within(await screen.findByRole('table', { name: 'Users' })).getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Remove' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove' }));
  await expectToast('Removed');
  expect(await api.vpn.openvpn.users()).toEqual([]);
});

test('OpenVPN options save', async () => {
  const user = await renderPage(<OpenVpnPage />);
  const f = await optionsForm();
  await user.click(f.getByRole('checkbox', { name: 'Clients can reach this LAN' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('OpenVPN options saved');
  expect(await api.vpn.openvpn.setting.get()).toMatchObject({ local_access: true });
});
