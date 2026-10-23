import { screen, within } from '@testing-library/react';
import { type Client, inSubnet } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import NetworksPage from './NetworksPage.tsx';

const networksTable = async () => within(await screen.findByRole('table', { name: 'Networks' }));
const reservedTable = async () => within(await screen.findByRole('table', { name: 'Reserved IP addresses' }));
const byId = async (id: string) => (await api.networks.list()).find((n) => n.id === id);

const value = (el: HTMLElement) => (el as HTMLInputElement).value;
const openNew = async () => {
  const user = await renderPage(<NetworksPage />);
  await user.click(await screen.findByRole('button', { name: 'New network' }));
  const s = await sheet();
  return { user, s };
};

test('a new network starts from a purpose and a free VLAN and subnet', async () => {
  const { user, s } = await openNew();
  expect(value(s.getByLabelText('Name'))).toBe('Home');
  expect(value(s.getByLabelText('Gateway IP'))).toBe('10.0.12.1');
  expect(value(s.getByLabelText(/^VLAN ID/))).toBe('12');
  await user.click(s.getByRole('button', { name: 'Cameras' }));
  expect(value(s.getByLabelText('Name'))).toBe('Cameras');
  expect(value(s.getByLabelText('Internet access'))).toBe('1');
  await user.click(s.getByRole('button', { name: 'Create network' }));
  const c = await confirmDialog();
  expect(c.getByText('Creates VLAN 12, 10.0.12.0/24 with addresses .6–.254 handed out, internet only.')).toBeTruthy();
  await user.click(c.getByRole('button', { name: 'Create network' }));
  await expectToast('Created Cameras');
  expect(await byId('Cameras')).toMatchObject({
    vlanId: 12,
    wanAccess: 1,
    leaseTime: '24h',
    dhcpStart: '10.0.12.6',
    dhcpEnd: '10.0.12.254',
    dns: [],
  });
});

test('the guest preset isolates clients and shortens the lease', async () => {
  const { user, s } = await openNew();
  await user.click(s.getByRole('button', { name: 'Guest' }));
  expect(s.getByRole('checkbox', { name: 'Isolate clients' })).toHaveProperty('checked', true);
  expect(value(s.getByLabelText('Lease time'))).toBe('1h');
  expect(value(s.getByLabelText('Name'))).toBe('Guest 2');
});

test('problems show under the field as you type, and stop a create', async () => {
  const { user, s } = await openNew();
  await user.clear(s.getByLabelText('Gateway IP'));
  await user.type(s.getByLabelText('Gateway IP'), '192.168.9.1');
  expect(await s.findByText(/overlaps Guest \(192\.168\.9\.0\/24\)/)).toBeTruthy();
  await user.clear(s.getByLabelText(/^VLAN ID/));
  await user.type(s.getByLabelText(/^VLAN ID/), '10');
  expect(await s.findByText('VLAN 10 is already used by IoT.')).toBeTruthy();
  await user.clear(s.getByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'lab');
  expect(await s.findByText('Another network already has this name.')).toBeTruthy();
  await user.click(s.getByRole('button', { name: 'Create network' }));
  expect((await s.findByRole('alert')).textContent).toMatch(/Another network already has this name|overlaps|VLAN 10/);
  expect(await byId('lab')).toBeUndefined();
});

test('the DHCP range follows the size until you change it yourself', async () => {
  const { user, s } = await openNew();
  await user.click(s.getByText('Advanced'));
  // earlier tests have created networks, so the free VLAN isn't always 12
  const base = value(s.getByLabelText('Gateway IP')).replace(/1$/, '');
  await user.selectOptions(s.getByLabelText('Size'), '25');
  expect(value(s.getByLabelText('First address'))).toBe(`${base}6`);
  expect(value(s.getByLabelText('Last address'))).toBe(`${base}126`);
  await user.clear(s.getByLabelText('Last address'));
  await user.type(s.getByLabelText('Last address'), `${base}50`);
  await user.selectOptions(s.getByLabelText('Size'), '24');
  expect(value(s.getByLabelText('Last address'))).toBe(`${base}50`);
  expect(value(s.getByLabelText('Gateway IP'))).toBe(`${base}1`);
});

test('an invalid gateway is explained on create', async () => {
  const { user, s } = await openNew();
  await user.clear(s.getByLabelText('Gateway IP'));
  await user.click(s.getByRole('button', { name: 'Create network' }));
  expect((await s.findByRole('alert')).textContent).toBe('Gateway IP isn’t a valid address.');
});

test('after creating, the next steps put the network on ports', async () => {
  const { user, s } = await openNew();
  await user.clear(s.getByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'Studio');
  await user.click(s.getByText('Advanced'));
  await user.selectOptions(s.getByLabelText('DNS'), 'cloudflare');
  await user.click(s.getByRole('button', { name: 'Create network' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Create network' }));
  await expectToast('Created Studio');
  const studio = await byId('Studio');
  expect(studio).toMatchObject({ dns: ['1.1.1.1', '1.0.0.1'] });
  const next = await sheet();
  await user.click(await next.findByRole('button', { name: 'Carry it on ports' }));
  const ports = await sheet();
  await user.click(await ports.findByRole('checkbox', { name: 'LAN2' }));
  await user.click(ports.getByRole('button', { name: 'Apply' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Apply' }));
  await expectToast(/^Studio is on LAN2/);
  const lan2 = (await api.internet.ports()).find((p) => p.label === 'LAN2');
  expect(lan2?.untagged).toBe(studio?.vlanId);
});

test('the next steps can start a Wi-Fi network for it', async () => {
  const { user, s } = await openNew();
  await user.clear(s.getByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'Den & Study');
  await user.click(s.getByRole('button', { name: 'Create network' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Create network' }));
  await expectToast('Created Den & Study');
  await user.click(await (await sheet()).findByRole('button', { name: 'Add WiFi for it' }));
  expect(location.hash).toBe('#wifi?create=Den%20%26%20Study&ssid=Den%20%26%20Study');
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
