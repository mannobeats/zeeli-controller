import { screen, waitFor, within } from '@testing-library/react';
import { isOwn, type OwnWifi, type OwnWifiInput } from '@zeeli/router-api';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import WifiPage from './WifiPage.tsx';

afterEach(() => vi.restoreAllMocks());

/** The demo remembers across tests, so each one starts from the same two networks. */
beforeEach(async () => {
  await api.session.login('demo');
  for (const n of await mine()) await api.wifiNetworks.remove(n.id);
  await api.wifiNetworks.create({
    ...base,
    ssid: 'Kids',
    password: 'dino-nuggets-42',
    bands: ['5g'],
    network: 'Kids',
    isolate: true,
    schedule: { enabled: true, days: ['sun', 'mon', 'tue', 'wed', 'thu'], off: '21:00', on: '07:00' },
  });
  await api.wifiNetworks.create({
    ...base,
    ssid: 'Workshop',
    bands: ['2g', '5g'],
    network: 'Lab',
    security: 'psk2',
    hidden: true,
    options: { maxClients: 12 },
  });
  await api.wifiNetworks.apply();
});

const mine = async () => (await api.wifiNetworks.overview()).networks.filter(isOwn);
const named = async (ssid: string) => (await mine()).find((n) => n.ssid === ssid) as OwnWifi;
const customTable = () => screen.findByRole('table', { name: 'Custom networks' });
const rowOf = async (ssid: string) =>
  (await within(await customTable()).findByText(ssid, { selector: '.name' })).closest('tr') as HTMLElement;

const base: OwnWifiInput = {
  ssid: 'Spare',
  password: 'spare password',
  bands: ['2g'],
  network: 'main',
  security: 'sae-mixed',
  hidden: false,
  isolate: false,
  options: {},
};

test('lists the networks made here with their bands, network and schedule', async () => {
  await renderPage(<WifiPage />);
  const kids = within(await rowOf('Kids'));
  expect(kids.getByText('5 GHz')).toBeTruthy();
  expect(kids.getByText('Kids', { selector: 'td:nth-child(4)' })).toBeTruthy();
  expect(kids.getByText('Off 21:00 to 07:00')).toBeTruthy();
  const shop = within(await rowOf('Workshop'));
  expect(shop.getByText('Hidden')).toBeTruthy();
  expect(shop.getByText('2.4 GHz')).toBeTruthy();
  expect(shop.getByText('5 GHz')).toBeTruthy();
});

test('adds a network: generated password, two bands, a schedule', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  const s = await sheet();
  await user.type(s.getByLabelText(/^Network name/), 'Garage');
  await user.click(s.getByRole('button', { name: 'Generate' }));
  expect((s.getByLabelText(/^Password/) as HTMLInputElement).value).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  await user.click(s.getByRole('checkbox', { name: /^2\.4 GHz/ }));
  await user.selectOptions(s.getByLabelText(/^Joins network/), 'Lab');
  await user.click(s.getByRole('checkbox', { name: 'Turn off at set times' }));
  await user.click(s.getByRole('button', { name: 'Add network' }));
  await expectToast('Added Garage. Devices can join in a few seconds.');
  const garage = await named('Garage');
  expect(garage).toMatchObject({ bands: ['2g', '5g'], network: 'Lab', security: 'sae-mixed' });
  expect(garage.schedule).toMatchObject({ off: '22:00', on: '07:00' });
  expect((await api.wifiNetworks.overview()).pending).toBe(false);
  expect(await rowOf('Garage')).toBeTruthy();
});

test('says why the form can’t be saved', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Add network' }));
  expect((await s.findByRole('alert')).textContent).toBe('The network name must be 1 to 32 bytes.');
  await user.type(s.getByLabelText(/^Network name/), 'Spare room');
  await user.type(s.getByLabelText(/^Password/), 'short');
  await user.click(s.getByRole('button', { name: 'Add network' }));
  await waitFor(() => expect(s.getByRole('alert').textContent).toBe('The password must be 8 to 63 characters.'));
  await user.type(s.getByLabelText(/^Password/), '-enough');
  await user.click(s.getByRole('checkbox', { name: /^5 GHz/ }));
  await user.click(s.getByRole('button', { name: 'Add network' }));
  await waitFor(() => expect(s.getByRole('alert').textContent).toBe('Pick at least one band.'));
});

test('choosing 6 GHz switches to WPA3 and leaves no other choice', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  const s = await sheet();
  const security = () => s.getByLabelText(/^Security/) as HTMLSelectElement;
  expect([...security().options].map((o) => o.value)).toEqual(['sae-mixed', 'sae', 'psk2']);
  await user.click(s.getByRole('checkbox', { name: /^6 GHz/ }));
  expect([...security().options].map((o) => o.value)).toEqual(['sae']);
  expect(security().value).toBe('sae');
  await user.click(s.getByRole('checkbox', { name: /^6 GHz/ }));
  expect(security().options.length).toBe(3);
});

test('a full radio can’t be picked, and says so', async () => {
  for (let i = 0; i < 14; i++) await api.wifiNetworks.create({ ...base, ssid: `Fill ${i}`, bands: ['6g'], security: 'sae' });
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  const s = await sheet();
  const full = s.getByRole('checkbox', { name: /^6 GHz/ }) as HTMLInputElement;
  expect(full.disabled).toBe(true);
  expect(s.getByText('Full: 17 of 17 networks')).toBeTruthy();
  expect((s.getByRole('checkbox', { name: /^5 GHz/ }) as HTMLInputElement).disabled).toBe(false);
  expect(s.getAllByText(/of 17 networks/, { selector: '.hint' }).length).toBe(3);
});

test('editing keeps the password unless one is typed, and can show the current one', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click(await rowOf('Kids'));
  const s = await sheet();
  expect((s.getByLabelText(/^Password/) as HTMLInputElement).placeholder).toBe('Unchanged');
  await user.click(s.getByRole('button', { name: 'Show current' }));
  await waitFor(() => expect((s.getByLabelText(/^Password/) as HTMLInputElement).value).toBe('dino-nuggets-42'));
  await user.clear(s.getByLabelText(/^Password/));
  await user.clear(s.getByLabelText(/^Network name/));
  await user.type(s.getByLabelText(/^Network name/), 'Kids Room');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved Kids Room. Devices on it reconnect in a few seconds.');
  expect(await named('Kids Room')).toMatchObject({ network: 'Kids' });
  expect(await api.wifiNetworks.reveal((await named('Kids Room')).id)).toBe('dino-nuggets-42');
  await user.click(await rowOf('Kids Room'));
  const again = await sheet();
  await user.click(again.getByRole('button', { name: 'Advanced' }));
  await user.type(again.getByLabelText(/^Max devices/), '9');
  await user.click(again.getByRole('checkbox', { name: /^Fast roaming/ }));
  await user.click(again.getByRole('checkbox', { name: 'Turn off at set times' }));
  await user.click(again.getByRole('button', { name: 'Save' }));
  await waitFor(async () => expect((await named('Kids Room')).options).toMatchObject({ maxClients: 9, fastRoaming: true }));
  expect((await named('Kids Room')).schedule).toBeNull();
});

test('deleting asks first and names the network', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click(await rowOf('Workshop'));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Delete network' }));
  const dialog = await confirmDialog();
  expect(dialog.getByText('Delete “Workshop”?')).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: 'Delete' }));
  await expectToast('Deleted Workshop');
  expect((await mine()).map((n) => n.ssid)).not.toContain('Workshop');
});

test('turning a network off asks first, and bulk actions work on a selection', async () => {
  const keep = await api.wifiNetworks.create({ ...base, ssid: 'Bulk A' });
  await api.wifiNetworks.create({ ...base, ssid: 'Bulk B' });
  const user = await renderPage(<WifiPage />);
  await user.click(within(await rowOf('Bulk A')).getByRole('checkbox', { name: 'Bulk A on' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Turn off' }));
  await expectToast('“Bulk A” turned off.');
  expect((await mine()).find((n) => n.id === keep.id)?.disabled).toBe(true);
  const table = within(await customTable());
  await user.click(table.getByRole('checkbox', { name: 'Select row 3' }));
  await user.click(table.getByRole('checkbox', { name: 'Select row 4' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await confirmDialog();
  expect(dialog.getByText('Delete 2 networks?')).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: 'Delete' }));
  await expectToast('Deleted 2 networks');
  expect((await mine()).map((n) => n.ssid)).toEqual(['Kids', 'Workshop']);
});

test('changes saved but not applied show a notice with an Apply button', async () => {
  const created = await api.wifiNetworks.create({ ...base, ssid: 'Waiting' });
  await api.wifiNetworks.remove(created.id);
  expect((await api.wifiNetworks.overview()).pending).toBe(true);
  const user = await renderPage(<WifiPage />);
  expect(await screen.findByText(/saved but not on the radios yet/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Apply now' }));
  await expectToast('WiFi reloaded. Devices on changed networks reconnect in a few seconds.');
  await waitFor(() => expect(screen.queryByText(/saved but not on the radios yet/)).toBeNull());
});

test('a router without the agent gets a note, not a broken page', async () => {
  vi.spyOn(api.agent, 'version').mockResolvedValue(null);
  await renderPage(<WifiPage />);
  expect(await screen.findByText(/need Zeeli’s agent on the router/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Go to updates' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add network' })).toBeNull();
  expect(screen.queryByRole('table', { name: 'Custom networks' })).toBeNull();
});
