import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { suggestClass } from '../../lib/devices.ts';
import { expectToast, renderPage, sheet } from '../../test/render.tsx';
import ClientsPage from './ClientsPage.tsx';

const macOf = async (name: string) => (await api.clients.list()).find((c) => c.hostname === name)?.mac ?? '';
const strip = () => screen.findByRole('heading', { name: 'New devices' }).then((h) => within(h.closest('section') as HTMLElement));

test('a device that just joined is offered for setup, and "Not now" sets it aside', async () => {
  const mac = await macOf('Guest-Phone');
  const user = await renderPage(<ClientsPage />);
  await user.click((await strip()).getByRole('button', { name: 'Set up' }));
  const s = await sheet();
  expect(await s.findByRole('heading', { name: 'New device' })).toBeTruthy();
  // the hostname gives away what it is
  expect((s.getByLabelText('Device type') as HTMLSelectElement).value).toBe('phone');
  await user.click(s.getByRole('button', { name: 'Not now' }));
  await expectToast('Left as it is');
  expect((await api.names.list()).dismissed).toContain(mac);
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'New devices' })).toBeNull());
  await api.names.dismiss([mac], false);
});

test('setting up a new device names it, keeps its address, files it and gives it a .lan name', async () => {
  const mac = await macOf('Guest-Phone');
  const user = await renderPage(<ClientsPage />);
  await user.click((await strip()).getByRole('button', { name: 'Set up' }));
  const s = await sheet();
  await user.clear(await s.findByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'Visitor Phone');
  await user.selectOptions(await s.findByLabelText('Group'), 'Kids');
  expect((s.getByRole('checkbox', { name: 'Keep this IP' }) as HTMLInputElement).checked).toBe(true);
  await user.click(s.getByRole('button', { name: 'Done' }));
  await expectToast('Visitor Phone is set up');
  const client = (await api.clients.list()).find((c) => c.mac === mac);
  expect(client?.alias).toBe('Visitor Phone');
  expect((await api.networks.reservations()).find((r) => r.mac === mac)).toMatchObject({ ip: client?.ip, name: 'Visitor Phone' });
  expect((await api.policies.groups.list()).find((g) => g.name === 'Kids')?.members).toContain(mac);
  expect((await api.names.list()).dismissed).toContain(mac);
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'New devices' })).toBeNull());
  // the panel now reads as an ordinary device that answers to its name
  expect(await (await sheet()).findByText('visitor-phone.lan')).toBeTruthy();
});

test('Keep this IP reserves the address under the device name, then says why it is off', async () => {
  const mac = await macOf('Printer');
  const user = await renderPage(<ClientsPage />);
  await user.click(
    (await screen.findByRole('table', { name: 'Clients' }).then((t) => within(t).getByText('Printer'))).closest('tr') as HTMLElement,
  );
  const s = await sheet();
  const keep = await s.findByRole('button', { name: 'Keep this IP' });
  expect((keep as HTMLButtonElement).disabled).toBe(false);
  await user.click(keep);
  await expectToast(/^Printer keeps /);
  expect((await api.networks.reservations()).find((r) => r.mac === mac)?.name).toBe('Printer');
  await waitFor(() => expect((s.getByRole('button', { name: 'Keep this IP' }) as HTMLButtonElement).disabled).toBe(true));
  expect(s.getByRole('button', { name: 'Keep this IP' }).getAttribute('title')).toBe('This address is already kept for this device');
  expect(s.getByText('Kept: this device always gets this address')).toBeTruthy();
});

test('a named device shows how to reach it, and the switch turns local names off and on', async () => {
  const c = (await api.clients.list()).find((x) => x.hostname === 'nas-01');
  await api.clients.setInfo(c?.mac ?? '', 'NAS Main', 'nas');
  const user = await renderPage(<ClientsPage />);
  await user.click(
    (await screen.findByRole('table', { name: 'Clients' }).then((t) => within(t).getByText('NAS Main'))).closest('tr') as HTMLElement,
  );
  const s = await sheet();
  expect(await s.findByText('nas-main.lan')).toBeTruthy();
  const forwarded = await api.transport.adguard<{ upstream_dns: string[] }>('dns_info');
  expect(forwarded.upstream_dns[0]).toBe('[/lan/]127.0.0.1:53');
  await user.click(s.getByRole('checkbox', { name: 'Give devices local names' }));
  await waitFor(() => expect(s.queryByText('nas-main.lan')).toBeNull());
  expect((await api.names.list()).enabled).toBe(false);
  await user.click(s.getByRole('checkbox', { name: 'Give devices local names' }));
  expect(await s.findByText('nas-main.lan')).toBeTruthy();
});

test('device types are guessed from the name', () => {
  const guess = (hostname: string) => suggestClass({ hostname, alias: '', deviceClass: '' });
  expect(['Maya-iPhone', 'DESKTOP-4F2', 'HP-LaserJet-400', 'ps5-living-room', 'Synology-DS220', 'Reolink-Cam', 'zzz'].map(guess)).toEqual([
    'phone',
    'computer',
    'printer',
    'games',
    'nas',
    'camera',
    '',
  ]);
  expect(suggestClass({ hostname: 'Maya-iPhone', alias: '', deviceClass: 'watch' })).toBe('watch');
});
