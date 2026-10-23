import { screen, waitFor, within } from '@testing-library/react';
import { isOwn, type OwnWifi, type OwnWifiInput } from '@zeeli/router-api';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { APPLYING, confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import WifiPage from './WifiPage.tsx';

afterEach(() => vi.restoreAllMocks());

/** The demo remembers across tests, so each one starts from the same two networks. */
beforeEach(async () => {
  await api.session.login('demo');
  for (const n of await mine()) await api.wifiNetworks.remove(n.id);
  // deleting a multi-link network leaves a restart waiting, and a restart clears it
  await api.system.reboot();
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
  expect([...security().options].map((o) => o.text)).toEqual(['WPA2/WPA3', 'WPA3', 'WPA2']);
  expect(s.getByText('WPA2/WPA3 works with older devices too.')).toBeTruthy();
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

test('editing keeps the password unless one is typed, and can show the current one', { timeout: APPLYING }, async () => {
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
  // the options and the schedule are separate calls, so wait for both
  await waitFor(async () => {
    const n = await named('Kids Room');
    expect(n.options).toMatchObject({ maxClients: 9, fastRoaming: true });
    expect(n.schedule).toBeNull();
  });
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

test('counts the online devices on each network by band and subnet', async () => {
  const everywhere = await api.wifiNetworks.create({
    ...base,
    ssid: 'Everyone',
    bands: ['2g', '5g', '6g'],
    security: 'sae',
    network: 'main',
  });
  const want = (await api.clients.list()).filter(
    (c) => c.online && c.link.medium === 'wifi' && ['2.4', '5', '6'].includes(c.link.band ?? '') && c.ip.startsWith('192.168.8.'),
  ).length;
  expect(want).toBeGreaterThan(0);
  await renderPage(<WifiPage />);
  const row = within(await rowOf('Everyone'));
  await waitFor(() => expect(row.getByText(String(want), { selector: '.num' })).toBeTruthy());
  expect(within(await rowOf('Kids')).getByText('0', { selector: '.num' })).toBeTruthy();
  await api.wifiNetworks.setEnabled(everywhere.id, false);
});

const mloInput: OwnWifiInput = { ...base, ssid: 'Wi-Fi 7', bands: ['5g', '6g'], security: 'sae', mlo: true };

test('a multi-link network shows as MLO over its bands', async () => {
  await api.wifiNetworks.create(mloInput);
  await renderPage(<WifiPage />);
  const row = within(await rowOf('Wi-Fi 7'));
  expect(row.getByText('MLO · 5 GHz + 6 GHz')).toBeTruthy();
  expect(row.getByText('WPA3')).toBeTruthy();
});

test('choosing multi-link picks 5 and 6 GHz, forces WPA3 and makes one network', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  const s = await sheet();
  await user.type(s.getByLabelText(/^Network name/), 'Wi-Fi 7');
  await user.type(s.getByLabelText(/^Password/), 'a long password');
  await user.click(s.getByRole('checkbox', { name: /^Multi-link/ }));
  expect((s.getByRole('checkbox', { name: /^5 GHz/ }) as HTMLInputElement).checked).toBe(true);
  expect((s.getByRole('checkbox', { name: /^6 GHz/ }) as HTMLInputElement).checked).toBe(true);
  expect((s.getByLabelText(/^Security/) as HTMLSelectElement).value).toBe('sae');
  expect(s.getByText('Multi-link needs WPA3.')).toBeTruthy();
  await user.click(s.getByRole('checkbox', { name: /^6 GHz/ }));
  await user.click(s.getByRole('button', { name: 'Add network' }));
  await waitFor(() => expect(s.getByRole('alert').textContent).toBe('Multi-link needs at least two bands.'));
  await user.click(s.getByRole('checkbox', { name: /^2\.4 GHz/ }));
  await user.click(s.getByRole('button', { name: 'Add network' }));
  await expectToast('Added Wi-Fi 7. Devices can join in a few seconds.');
  expect(await named('Wi-Fi 7')).toMatchObject({ mlo: true, bands: ['2g', '5g'], security: 'sae' });
  expect(within(await rowOf('Wi-Fi 7')).getByText('MLO · 2.4 GHz + 5 GHz')).toBeTruthy();
});

test('multi-link is off, with the reason, when the router can’t make another', async () => {
  const real = await api.wifiNetworks.overview();
  const reason = 'This router’s firmware has no multi-link (Wi-Fi 7 MLO) support.';
  vi.spyOn(api.wifiNetworks, 'overview').mockResolvedValue({ ...real, mlo: { supported: false, bands: [], reason } });
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  const s = await sheet();
  expect((s.getByRole('checkbox', { name: /^Multi-link/ }) as HTMLInputElement).disabled).toBe(true);
  expect(s.getByText(reason)).toBeTruthy();
});

test('a multi-link network opens read-only, with why, and can be deleted', async () => {
  await api.wifiNetworks.create(mloInput);
  const user = await renderPage(<WifiPage />);
  await user.click(await rowOf('Wi-Fi 7'));
  const s = await sheet();
  expect(s.getByText(/can’t be changed or switched off while the router runs/)).toBeTruthy();
  expect(s.getByText('MLO · 5 GHz + 6 GHz')).toBeTruthy();
  expect(s.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(s.queryByLabelText(/^Network name/)).toBeNull();
  await user.click(s.getByRole('button', { name: 'Show password' }));
  expect(await s.findByText('spare password')).toBeTruthy();
  expect(s.getByRole('button', { name: 'Delete network' })).toBeTruthy();
});

test('the switch of a multi-link network is off limits, in the table and in bulk', async () => {
  const { id } = await api.wifiNetworks.create(mloInput);
  const user = await renderPage(<WifiPage />);
  const row = within(await rowOf('Wi-Fi 7'));
  expect((row.getByRole('checkbox', { name: 'Wi-Fi 7 on' }) as HTMLInputElement).disabled).toBe(true);
  await user.click(row.getByRole('checkbox', { name: 'Select row 3' }));
  await user.click(screen.getByRole('button', { name: 'Turn off' }));
  await expectToast(/can’t be changed or switched off/);
  expect((await mine()).find((n) => n.id === id)?.disabled).toBe(false);
});

test('deleting a multi-link network says it stays until a restart, then offers the restart', { timeout: APPLYING }, async () => {
  await api.wifiNetworks.create(mloInput);
  const user = await renderPage(<WifiPage />);
  await user.click(await rowOf('Wi-Fi 7'));
  await user.click((await sheet()).getByRole('button', { name: 'Delete network' }));
  const dialog = await confirmDialog();
  expect(dialog.getByText(/stays on the air until the router restarts, which takes about two minutes/)).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: 'Delete' }));
  await expectToast('Deleted Wi-Fi 7. Restart the router to finish removing it.');
  expect((await mine()).map((n) => n.ssid)).not.toContain('Wi-Fi 7');
  expect(await screen.findByText(/Restart the router to finish removing ‘Wi-Fi 7’/)).toBeTruthy();
  // WiFi changes wait, and the add sheet says why multi-link does
  await user.click(screen.getByRole('button', { name: 'Add network' }));
  const add = await sheet();
  expect((add.getByRole('checkbox', { name: /^Multi-link/ }) as HTMLInputElement).disabled).toBe(true);
  expect(add.getByText(/Restart the router first/)).toBeTruthy();
  await user.click(add.getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'Restart router' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Reboot' }));
  await expectToast('Rebooting. This page reconnects when the router is back.');
  await waitFor(() => expect(screen.queryByText(/Restart the router to finish removing/)).toBeNull());
});

test('the add sheet’s multi-link help says what removal costs', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  expect((await sheet()).getByText(/deleting it needs a router restart/)).toBeTruthy();
});
