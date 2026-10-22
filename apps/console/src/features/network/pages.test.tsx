import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { APPLYING, confirmDialog, expectApplied, expectToast, renderPage, sheet } from '../../test/render.tsx';
import { DhcpPage, MeshPage, MultiWanPage, PortsPage, RoutesPage } from './pages.tsx';

const portsTable = async () => within(await screen.findByRole('table', { name: 'Ethernet ports' }));
const portNamed = async (name: string) => (await api.internet.ports()).find((p) => p.name === name);
const staticRoutes = async () => (await api.openwrt.routes()).statics;
const inputValue = (el: HTMLElement) => (el as HTMLInputElement).value;

async function confirmWith(label: string) {
  await userEvent.setup().click((await confirmDialog()).getByRole('button', { name: label }));
}

test('a LAN port can become a WAN uplink and back', async () => {
  const user = await renderPage(<PortsPage />);
  await user.click((await portsTable()).getByRole('button', { name: 'Use as WAN' }));
  await confirmWith('Make it WAN');
  await expectToast('LAN1 is now a WAN port');
  expect(await portNamed('secondwan')).toMatchObject({ role: 'wan' });
  await user.click(await (await portsTable()).findByRole('button', { name: 'Use as LAN' }));
  await confirmWith('Make it LAN');
  await expectToast('LAN1 is now a LAN port');
  expect(await portNamed('secondwan')).toMatchObject({ role: 'lan' });
});

test('the WAN port can copy a device’s MAC address', async () => {
  const user = await renderPage(<PortsPage />);
  await user.click((await portsTable()).getByText('WAN', { selector: '.name' }));
  const s = await sheet();
  const own = inputValue(s.getByLabelText(/^Address/));
  await user.selectOptions(s.getByLabelText('MAC address'), 'random');
  expect(inputValue(s.getByLabelText(/^Address/))).not.toBe(own);
  await user.selectOptions(s.getByLabelText('MAC address'), 'clone');
  await user.clear(s.getByLabelText(/^Address/));
  await user.type(s.getByLabelText(/^Address/), 'nope');
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter a MAC address like 02:00:00:00:00:01.');
  const mac = (await api.clients.list())[0]?.mac as string;
  await user.selectOptions(await s.findByLabelText('Device to copy'), mac);
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast(`WAN now uses ${mac}`);
  expect((await portNamed('wan'))?.mac).toMatchObject({ mode: 'clone', address: mac });
  expect(await (await portsTable()).findByText('(copied)')).toBeTruthy();
});

test('switching the WAN MAC back to the router’s own', async () => {
  const user = await renderPage(<PortsPage />);
  await user.click((await portsTable()).getByText('WAN', { selector: '.name' }));
  const s = await sheet();
  await user.selectOptions(s.getByLabelText('MAC address'), 'default');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast(/^WAN now uses /);
  expect((await portNamed('wan'))?.mac).toMatchObject({ mode: 'default' });
});

test('a LAN port can carry tagged networks', async () => {
  const user = await renderPage(<PortsPage />);
  await user.click((await portsTable()).getByText('LAN2', { selector: '.name' }));
  const s = await sheet();
  await user.selectOptions(s.getByLabelText('Port carries'), 'Multiple VLANs');
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Pick at least one tagged network other than the untagged one.');
  await user.click(within(s.getByRole('group', { name: 'Tagged networks' })).getByLabelText(/^Guest/));
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('LAN2 saved');
  expect(await portNamed('lan2')).toMatchObject({ vlanMode: 'Multiple VLANs', tagged: [9] });
});

test('reserving leased addresses from the DHCP list', async () => {
  const user = await renderPage(<DhcpPage />);
  const leases = within(await screen.findByRole('table', { name: 'IPv4 leases' }));
  const row = leases.getAllByRole('button', { name: 'Reserve' })[0]?.closest('tr') as HTMLElement;
  const ip = within(row).getByText(/^\d+\.\d+\.\d+\.\d+$/).textContent as string;
  await user.click(within(row).getByRole('button', { name: 'Reserve' }));
  await expectToast('Reserved 1 address');
  expect((await api.networks.reservations()).map((r) => r.ip)).toContain(ip);
  await user.click(leases.getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Reserve these addresses' }));
  await expectToast(/^Reserved \d+ addresses$/);
  expect(leases.queryAllByRole('button', { name: 'Reserve' })).toHaveLength(0);
});

test(
  'adding a static route checks every field',
  async () => {
    const user = await renderPage(<RoutesPage />);
    await user.click(await screen.findByRole('button', { name: 'New route' }));
    const s = await sheet();
    const add = () => user.click(s.getByRole('button', { name: 'Add route' }));
    const alertText = async () => (await s.findByRole('alert')).textContent;
    await user.type(s.getByLabelText('Destination network'), '192.168.50/24');
    await add();
    expect(await alertText()).toBe('Destination must look like 192.168.50.0/24.');
    await user.clear(s.getByLabelText('Destination network'));
    await user.type(s.getByLabelText('Destination network'), '192.168.50.0/24');
    await user.type(s.getByLabelText(/^Gateway/), 'router');
    await add();
    expect(await alertText()).toBe('Gateway must be an IPv4 address.');
    await user.clear(s.getByLabelText(/^Gateway/));
    await user.type(s.getByLabelText(/^Gateway/), '192.168.8.2');
    await user.type(s.getByLabelText('Metric'), 'x');
    await add();
    expect(await alertText()).toBe('Metric is a whole number.');
    await user.clear(s.getByLabelText('Metric'));
    await user.type(s.getByLabelText('Metric'), '5');
    await add();
    await expectApplied('Added route to 192.168.50.0/24');
    expect(await staticRoutes()).toContainEqual(
      expect.objectContaining({ target: '192.168.50.0/24', gateway: '192.168.8.2', metric: '5' }),
    );
  },
  APPLYING,
);

test(
  'editing and deleting a static route',
  async () => {
    const user = await renderPage(<RoutesPage />);
    const routes = within(await screen.findByRole('table', { name: 'Static routes' }));
    const target = (await staticRoutes())[0]?.target as string;
    await user.click(routes.getByText(target));
    const s = await sheet();
    await user.clear(s.getByLabelText('Metric'));
    await user.type(s.getByLabelText('Metric'), '9');
    await user.click(s.getByRole('button', { name: 'Save and apply' }));
    await expectApplied(`Saved route to ${target}`);
    expect((await staticRoutes())[0]).toMatchObject({ metric: '9' });
    await user.click(routes.getByText(target));
    await user.click((await sheet()).getByRole('button', { name: 'Delete route' }));
    await confirmWith('Delete');
    await expectApplied(`Deleted the route to ${target}`);
    expect((await staticRoutes()).map((r) => r.target)).not.toContain(target);
  },
  APPLYING,
);

test('the routing table can show every table', async () => {
  const user = await renderPage(<RoutesPage />);
  const table = within(await screen.findByRole('table', { name: 'Routing table' }));
  const before = table.getAllByRole('row').length;
  await user.click(screen.getByRole('checkbox', { name: /^Show all/ }));
  expect(table.getAllByRole('row').length).toBeGreaterThanOrEqual(before);
  expect(table.getByText('Default (internet)')).toBeTruthy();
});

test('multi-WAN failover order and switch-over speed', async () => {
  const user = await renderPage(<MultiWanPage />);
  await user.click(await screen.findByRole('button', { name: 'Move Repeater up' }));
  const [mode, speed] = screen.getAllByRole('button', { name: 'Save' }) as [HTMLElement, HTMLElement];
  await user.click(mode);
  await expectToast('Multi-WAN saved. Uplinks re-check within about 10 seconds.');
  expect((await api.internet.multiWan()).uplinks.map((u) => u.id)).toEqual(['wan', 'wwan', 'secondwan']);
  await user.selectOptions(screen.getByLabelText('How fast to switch when an uplink fails'), '5');
  await user.click(speed);
  await expectToast('Switch-over speed saved');
  expect(await api.internet.multiWan()).toMatchObject({ sensitivity: 5 });
});

test('multi-WAN load balancing needs two weighted uplinks', async () => {
  const user = await renderPage(<MultiWanPage />);
  await user.selectOptions(await screen.findByLabelText('Use uplinks'), '1');
  for (const id of ['Ethernet 2', 'Repeater']) {
    await user.clear(screen.getByLabelText(`Weight for ${id}`));
    await user.type(screen.getByLabelText(`Weight for ${id}`), '0');
  }
  const mode = screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement;
  await user.click(mode);
  expect((await screen.findByRole('alert')).textContent).toBe('Load balancing needs at least two uplinks with a weight above 0.');
  await user.clear(screen.getByLabelText('Weight for Repeater'));
  await user.type(screen.getByLabelText('Weight for Repeater'), '2');
  await user.click(mode);
  await expectToast(/^Multi-WAN saved/);
  const mw = await api.internet.multiWan();
  expect(mw.mode).toBe(1);
  expect(mw.uplinks.find((u) => u.id === 'wwan')).toMatchObject({ weight: 2 });
});

test('mesh: turn on, add a scanned node, turn off', async () => {
  const user = await renderPage(<MeshPage />);
  await user.click(await screen.findByRole('button', { name: 'Turn mesh on' }));
  await confirmWith('Turn on');
  await expectToast('Mesh on');
  expect(await api.networkExtras.mesh.config.get()).toMatchObject({ enabled: true });
  await user.click(await screen.findByRole('button', { name: 'Add nodes' }));
  const s = await sheet();
  expect(s.getByText('Reset a GL.iNet router, place it nearby, then scan.')).toBeTruthy();
  await user.click(s.getByRole('button', { name: 'Add selected' }));
  expect((await s.findByRole('alert')).textContent).toBe('Pick at least one node.');
  await user.click(s.getByRole('button', { name: 'Scan for nodes' }));
  await user.click(await s.findByLabelText('GL-MT6000 · 02:5E:E1:77:00:01 · -58 dBm'));
  expect(s.getByText('Scan finished.')).toBeTruthy();
  await user.click(s.getByRole('button', { name: 'Add selected' }));
  await expectToast('Added 1 node. They finish setting up in a few minutes.');
  await user.click(screen.getByRole('button', { name: 'Turn mesh off' }));
  await confirmWith('Turn off');
  await expectToast('Mesh off');
});
