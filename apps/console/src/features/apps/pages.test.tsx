import { screen, within } from '@testing-library/react';
import type { AppState } from '@zeeli/router-api';
import { beforeAll, expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { expectToast, renderPage } from '../../test/render.tsx';
import { AppStorePage, BarkPage, DdnsPage, TorPage } from './pages.tsx';

beforeAll(async () => {
  await api.session.login('demo');
  await api.session.unlockAdvanced('demo');
});

const app = async (id: string) => (await api.apps.list()).find((a) => a.id === id) as AppState;
const tile = async (name: string) => within((await screen.findByRole('heading', { name, level: 3 })).closest('article') as HTMLElement);
const form = async (title: string) =>
  within((await screen.findByRole('heading', { name: title, level: 2 })).closest('form') as HTMLElement);

test('installing an app names the wait, then offers Open', async () => {
  const vnstat = await app('vnstat');
  const user = await renderPage(<AppStorePage />);
  await user.click((await tile(vnstat.name)).getByRole('button', { name: 'Install' }));
  expect((await screen.findByText(/^Installing Traffic history…/, { selector: 'output' })).textContent).toMatch(/few minutes/);
  await expectToast(`${vnstat.name} installed`);
  expect(await app('vnstat')).toMatchObject({ installed: true, versions: { vnstat2: '2.11-1' } });
  expect(await (await tile(vnstat.name)).findByRole('button', { name: 'Open' })).toBeTruthy();
});

test('running is the only green chip; installed apps open their page', async () => {
  const user = await renderPage(<AppStorePage />);
  const adguard = await tile((await app('adguard')).name);
  expect(adguard.getByText('Running').className).toBe('chip ok');
  const iperf = await tile((await app('iperf3')).name);
  expect(iperf.getByText('Installed').className).toBe('chip');
  await user.click(iperf.getByRole('button', { name: 'Open' }));
  expect(location.hash).toBe('#app-iperf3');
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
