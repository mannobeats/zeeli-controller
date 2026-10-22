import { screen, within } from '@testing-library/react';
import { beforeAll, expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage } from '../../test/render.tsx';
import { PackagesPage } from './PackagesPage.tsx';

beforeAll(async () => {
  await api.session.login('demo');
  await api.session.unlockAdvanced('demo');
});

const row = async (name: string) => within((await screen.findByText(name, { selector: '.name' })).closest('tr') as HTMLElement);
const search = () => screen.getByRole('searchbox', { name: 'Search packages' });

test('search covers names and descriptions, and long lists page', async () => {
  const user = await renderPage(<PackagesPage />);
  await screen.findByRole('table', { name: 'Packages' });
  await user.type(search(), 'bandwidth');
  expect(await row('iperf3')).toBeTruthy();
  expect(screen.queryByText('minidlna', { selector: '.name' })).toBeNull();

  await user.click(screen.getByRole('button', { name: /^Available/ }));
  expect(await screen.findByRole('button', { name: 'Available 151' })).toBeTruthy();
  await user.clear(search());
  await user.type(search(), 'kmod-demo');
  expect(await screen.findByText('Showing 100 of 140. Search to narrow the list.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Show more' }));
  expect(await row('kmod-demo-140')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  await user.type(search(), 'zzz');
  expect(screen.getByText('No package matches “kmod-demozzz”.')).toBeTruthy();
});

test('install, update and remove are confirmed and read back', async () => {
  const user = await renderPage(<PackagesPage />);
  await screen.findByRole('table', { name: 'Packages' });
  await user.click(screen.getByRole('button', { name: /^Available/ }));
  await user.type(search(), 'nlbwmon');
  await user.click((await row('nlbwmon')).getByRole('button', { name: 'Install' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Install nlbwmon' }));
  await expectToast('nlbwmon installed');
  expect((await row('nlbwmon')).getByText('Installed').className).toBe('chip');

  await user.click(screen.getByRole('button', { name: 'Updates 1' }));
  await user.clear(search());
  expect((await row('tailscale')).getByText('1.84.0-1 → 1.86.2-1')).toBeTruthy();
  await user.click((await row('tailscale')).getByRole('button', { name: 'Update' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Update tailscale' }));
  await expectToast('tailscale updated');
  expect(await screen.findByText('Everything installed is up to date.')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /^Installed/ }));
  await user.type(search(), 'nlbwmon');
  await user.click((await row('nlbwmon')).getByRole('button', { name: 'Remove' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove nlbwmon' }));
  await expectToast('nlbwmon removed');
  expect((await api.openwrt.packages.installed()).map((p) => p.name)).not.toContain('nlbwmon');
  expect(await screen.findByText('No package matches “nlbwmon”.')).toBeTruthy();
});

test('refreshing the list names the outcome', async () => {
  const user = await renderPage(<PackagesPage />);
  await user.click(await screen.findByRole('button', { name: 'Refresh list' }));
  await expectToast('Package list refreshed');
});
