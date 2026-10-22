import { screen, within } from '@testing-library/react';
import type { Client } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { categoryOf } from '../../lib/devices.ts';
import { confirmDialog, expectToast, renderPage, settled, sheet } from '../../test/render.tsx';
import ClientsPage from './ClientsPage.tsx';

const table = async () => within(await screen.findByRole('table', { name: 'Clients' }));
const rowOf = async (name: string) => (await table()).getByText(name).closest('tr') as HTMLElement;

async function firstOnline() {
  const list = await api.clients.list();
  return list.find((c) => c.online && !c.blocked) as Client;
}

test('search narrows the list and clears', async () => {
  const user = await renderPage(<ClientsPage />);
  await table();
  await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'no-such-device');
  expect(screen.getByText('No client matches “no-such-device”.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(await table()).toBeTruthy();
});

test('status and connection filters', async () => {
  const user = await renderPage(<ClientsPage />);
  await table();
  const blocked = (await api.clients.list()).filter((c) => c.blocked);
  await user.click(screen.getByRole('button', { name: /^Blocked/ }));
  expect((await table()).getAllByRole('row')).toHaveLength(blocked.length + 1);
  await user.click(screen.getByRole('button', { name: /^All/ }));
  await user.click(within(screen.getByRole('region', { name: 'Filters' })).getAllByRole('checkbox')[0] as HTMLElement);
  const wired = (await api.clients.list()).filter((c) => categoryOf(c) === 'wired');
  expect((await table()).getAllByRole('row')).toHaveLength(wired.length + 1);
});

test('renaming a device and setting a speed limit', async () => {
  const c = await firstOnline();
  const user = await renderPage(<ClientsPage />);
  await user.click(await rowOf(c.name));
  const s = await sheet();
  await user.clear(s.getByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'Renamed');
  await user.click(s.getByRole('checkbox', { name: 'Limit this device' }));
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter a download or upload limit in Mbps.');
  await user.type(s.getByLabelText(/^Download/), '10');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved Renamed');
  const after = (await api.clients.list()).find((x) => x.mac === c.mac);
  expect(after).toMatchObject({ name: 'Renamed' });
  expect(after?.limitRx).toBeGreaterThan(0);
});

test('reserving and releasing the address from the sheet', async () => {
  const reserved = new Set((await api.networks.reservations()).map((r) => r.mac));
  const c = (await api.clients.list()).find((x) => x.online && !reserved.has(x.mac)) as Client;
  const user = await renderPage(<ClientsPage />);
  await user.click(await rowOf(c.name));
  const s = await sheet();
  await settled();
  await user.click(await s.findByRole('button', { name: 'Reserve this IP' }));
  await s.findByRole('button', { name: 'Remove reservation' });
  expect((await api.networks.reservations()).some((r) => r.mac === c.mac)).toBe(true);
  await user.click(s.getByRole('button', { name: 'Remove reservation' }));
  await s.findByRole('button', { name: 'Reserve this IP' });
});

test('blocking from the sheet asks first and can be undone', async () => {
  const c = await firstOnline();
  const user = await renderPage(<ClientsPage />);
  await user.click(await rowOf(c.name));
  await user.click((await sheet()).getByRole('button', { name: 'Block' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Block' }));
  await expectToast(`Blocked ${c.name}`);
  expect((await api.clients.access()).blocked).toContain(c.mac);
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  await expectToast('Undone');
  expect((await api.clients.access()).blocked).not.toContain(c.mac);
});

test('bulk forget only touches offline devices', async () => {
  const before = await api.clients.list();
  const gone = before.find((c) => !c.online) as Client;
  const user = await renderPage(<ClientsPage />);
  await user.click(screen.getByRole('button', { name: /^Offline/ }));
  await user.click(within(await rowOf(gone.name)).getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Forget' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Forget' }));
  await expectToast(`Forgot ${gone.name}`);
  expect((await api.clients.list()).map((c) => c.mac)).not.toContain(gone.mac);
});
