import { screen, within } from '@testing-library/react';
import { type Client, inSubnet } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import NetworksPage from './NetworksPage.tsx';

const networksTable = async () => within(await screen.findByRole('table', { name: 'Networks' }));
const reservedTable = async () => within(await screen.findByRole('table', { name: 'Reserved IP addresses' }));
const byId = async (id: string) => (await api.networks.list()).find((n) => n.id === id);

test('creating a VLAN network checks the form first', async () => {
  const user = await renderPage(<NetworksPage />);
  await user.click(await screen.findByRole('button', { name: 'New network' }));
  const s = await sheet();
  await user.type(s.getByLabelText('Name'), 'Cameras');
  await user.type(s.getByLabelText('Gateway IP'), '10.0.30.1');
  await user.click(s.getByRole('button', { name: 'Create network' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter the first and last DHCP address.');
  await user.type(s.getByLabelText('First address'), '10.0.30.100');
  await user.type(s.getByLabelText('Last address'), '10.0.30.200');
  await user.type(s.getByLabelText(/^VLAN ID/), '30');
  await user.selectOptions(s.getByLabelText('Internet access'), '2');
  await user.selectOptions(s.getByLabelText('Lease time'), '1h');
  await user.click(s.getByRole('button', { name: 'Create network' }));
  await expectToast('Created Cameras');
  expect(await byId('Cameras')).toMatchObject({ vlanId: 30, wanAccess: 2, leaseTime: '1h', dhcpStart: '10.0.30.100' });
});

test('editing a custom network and deleting it', async () => {
  const user = await renderPage(<NetworksPage />);
  await user.click((await networksTable()).getByText('Lab'));
  const s = await sheet();
  await user.click(s.getByRole('checkbox', { name: 'Isolate clients' }));
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved Lab');
  expect(await byId('Lab')).toMatchObject({ isolate: true });
  await user.click((await networksTable()).getByText('Lab'));
  await user.click((await sheet()).getByRole('button', { name: 'Delete network' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete network' }));
  await expectToast('Deleted Lab');
  expect(await byId('Lab')).toBeUndefined();
});

test('moving the main network asks first', async () => {
  const user = await renderPage(<NetworksPage />);
  await user.click((await networksTable()).getByText('Main LAN'));
  const s = await sheet();
  expect(s.queryByLabelText('Name')).toBeNull();
  await user.clear(s.getByLabelText('Gateway IP'));
  await user.type(s.getByLabelText('Gateway IP'), '192.168.50.1');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Cancel' }));
  expect(await byId('main')).toMatchObject({ ip: '192.168.8.1' });
  await user.click(s.getByRole('button', { name: 'Save' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Change address' }));
  await expectToast('Saved Main LAN');
  expect(await byId('main')).toMatchObject({ ip: '192.168.50.1' });
});

test('a fixed network can be switched off', async () => {
  const user = await renderPage(<NetworksPage />);
  await user.click((await networksTable()).getByText('IoT', { selector: '.name' }));
  const s = await sheet();
  await user.click(s.getByRole('checkbox', { name: 'Network on' }));
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved IoT');
  expect(await byId('iot')).toMatchObject({ enabled: false });
});

test('reserving an IP for a known device', async () => {
  const user = await renderPage(<NetworksPage />);
  await user.click(await screen.findByRole('button', { name: 'Reserve an IP' }));
  const s = await sheet();
  await user.type(s.getByLabelText('MAC address'), 'nope');
  await user.click(s.getByRole('button', { name: 'Reserve' }));
  expect((await s.findByRole('alert')).textContent).toMatch(/MAC address should look like/);
  await user.clear(s.getByLabelText('MAC address'));
  await user.type(s.getByLabelText('MAC address'), '02:5e:e1:00:00:99');
  await user.type(s.getByLabelText('IP address'), '172.16.0.5');
  await user.click(s.getByRole('button', { name: 'Reserve' }));
  expect((await s.findByRole('alert')).textContent).toBe('That IP isn’t in any of your networks.');
  await user.clear(s.getByLabelText('IP address'));
  await user.type(s.getByLabelText('IP address'), '192.168.9.50');
  await user.type(s.getByLabelText('Name'), 'printer');
  await user.click(s.getByRole('button', { name: 'Reserve' }));
  await expectToast('Reserved 192.168.9.50 for printer');
  const added = (await api.networks.reservations()).find((r) => r.mac === '02:5E:E1:00:00:99');
  expect(added).toMatchObject({ ip: '192.168.9.50', network: 'guest' });
});

test('picking a device fills the reservation form', async () => {
  const user = await renderPage(<NetworksPage />);
  const nets = await api.networks.list();
  const reserved = new Set((await api.networks.reservations()).map((r) => r.mac));
  const inANetwork = (x: Client) => !reserved.has(x.mac) && nets.some((n) => inSubnet(x.ip, n.ip, n.netmask));
  const c = (await api.clients.list()).find((x) => x.online && inANetwork(x)) as Client;
  await user.click(await screen.findByRole('button', { name: 'Reserve an IP' }));
  const s = await sheet();
  await user.selectOptions(await s.findByLabelText('Device'), c.mac);
  expect((s.getByLabelText('IP address') as HTMLInputElement).value).toBe(c.ip);
  await user.click(s.getByRole('button', { name: 'Reserve' }));
  await expectToast(`Reserved ${c.ip} for ${c.name}`);
});

test('editing and removing a reservation, with undo', async () => {
  const user = await renderPage(<NetworksPage />);
  await user.click((await reservedTable()).getByText('nas-01'));
  const s = await sheet();
  await user.clear(s.getByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'nas');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Reserved 192.168.8.10 for nas');
  await user.click((await reservedTable()).getByText('nas'));
  await user.click((await sheet()).getByRole('button', { name: 'Remove reservation' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove' }));
  await expectToast('Removed the reservation for nas');
  expect((await api.networks.reservations()).map((r) => r.ip)).not.toContain('192.168.8.10');
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  await expectToast('Undone');
  expect((await api.networks.reservations()).map((r) => r.ip)).toContain('192.168.8.10');
});

test('bulk removing reservations', async () => {
  const user = await renderPage(<NetworksPage />);
  await user.click((await reservedTable()).getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Remove' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove' }));
  await expectToast(/^Removed \d+ reservations/);
  expect(await screen.findByText(/^No reserved addresses/)).toBeTruthy();
});
