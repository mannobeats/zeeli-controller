import { screen, within } from '@testing-library/react';
import type { AppState } from '@zeeli/router-api';
import { beforeAll, expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage } from '../../test/render.tsx';
import { AppStorePage, BarkPage, DdnsPage, PackagesPage, TorPage } from './pages.tsx';

beforeAll(async () => {
  await api.session.login('demo');
  await api.session.unlockAdvanced('demo');
});

const app = async (id: string) => (await api.apps.list()).find((a) => a.id === id) as AppState;
const tile = async (name: string) => within((await screen.findByRole('heading', { name, level: 3 })).closest('article') as HTMLElement);
const form = async (title: string) =>
  within((await screen.findByRole('heading', { name: title, level: 2 })).closest('form') as HTMLElement);

test('installing and removing an app', async () => {
  const dlna = await app('minidlna');
  const samba = await app('samba');
  const user = await renderPage(<AppStorePage />);
  await user.click((await tile(dlna.name)).getByRole('button', { name: 'Install' }));
  await expectToast(`${dlna.name} installed`);
  expect(await app('minidlna')).toMatchObject({ installed: true });
  await user.click((await tile(samba.name)).getByRole('button', { name: 'Remove' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove' }));
  await expectToast(`${samba.name} removed`);
  expect(await app('samba')).toMatchObject({ installed: false });
});

test('filtering and searching the app store', async () => {
  const adguard = await app('adguard');
  const user = await renderPage(<AppStorePage />);
  await user.click(await screen.findByRole('button', { name: /^Installed/ }));
  expect(await tile(adguard.name)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Available' }));
  expect(screen.queryByRole('heading', { name: adguard.name })).toBeNull();
  await user.type(screen.getByRole('searchbox', { name: 'Search apps' }), 'zzz');
  expect(screen.getByText('No apps match.')).toBeTruthy();
});

test('Tor exit countries must be two-letter codes', async () => {
  const user = await renderPage(<TorPage />);
  const f = await form('Tor');
  await user.click(f.getByRole('checkbox', { name: 'Route traffic through Tor' }));
  await user.click(f.getByRole('checkbox', { name: 'Pick exit countries' }));
  await user.type(f.getByLabelText('Countries, comma separated two-letter codes'), 'de, swiss');
  await user.click(f.getByRole('button', { name: 'Save' }));
  expect((await f.findByRole('alert')).textContent).toBe('Use two-letter country codes, like de or ch.');
  await user.clear(f.getByLabelText('Countries, comma separated two-letter codes'));
  await user.type(f.getByLabelText('Countries, comma separated two-letter codes'), 'DE ch');
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('Tor on');
  expect(await api.vpn.tor.get()).toMatchObject({ enable: true, manual: true, countries: ['de', 'ch'] });
});

test('Dynamic DNS shows the name and turns on', async () => {
  const user = await renderPage(<DdnsPage />);
  expect(await screen.findByText('demo1234.glddns.com')).toBeTruthy();
  expect(await screen.findByText('198.51.100.24')).toBeTruthy();
  const f = await form('GL.iNet Dynamic DNS');
  await user.click(f.getByRole('checkbox', { name: 'Keep this name pointed at my public IP' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('Dynamic DNS on');
  expect(await api.device.ddns.get()).toMatchObject({ enable_ddns: true });
});

test('Bark turns on', async () => {
  const user = await renderPage(<BarkPage />);
  const f = await form('Bark');
  await user.click(f.getByRole('checkbox', { name: 'Bark on' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('Bark on');
  expect(await api.device.bark.get()).toMatchObject({ enable: true });
});

test('packages: install from the full list, remove, refresh', async () => {
  const user = await renderPage(<PackagesPage />);
  await screen.findByRole('table', { name: 'Packages' });
  await user.click(screen.getByRole('button', { name: 'All available' }));
  const iperf = (await screen.findByText('iperf3')).closest('tr') as HTMLElement;
  await user.click(within(iperf).getByRole('button', { name: 'Install' }));
  await expectToast('Installed iperf3');
  await user.click(screen.getByRole('button', { name: 'Installed' }));
  await user.type(screen.getByRole('searchbox', { name: 'Search packages' }), 'iperf');
  await user.click(within((await screen.findByText('iperf3')).closest('tr') as HTMLElement).getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Remove' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove' }));
  await expectToast('Removed');
  expect((await api.openwrt.packages.installed()).map((p) => p.name)).not.toContain('iperf3');
  await user.type(screen.getByRole('searchbox', { name: 'Search packages' }), 'zzz');
  expect(screen.getByText('No package matches.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Refresh list' }));
  await expectToast('Package list refreshed');
});
