import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import InternetPage from './InternetPage.tsx';

async function openWan() {
  const user = await renderPage(<InternetPage />);
  const uplinks = within(await screen.findByRole('table', { name: 'Uplinks' }));
  await user.click(await uplinks.findByRole('button', { name: 'Set up' }));
  return { user, s: await sheet() };
}

async function scanAndPick(name: string) {
  const user = await renderPage(<InternetPage />);
  await user.click(await screen.findByRole('button', { name: 'Find networks' }));
  const nearby = within(await screen.findByRole('table', { name: 'Nearby networks' }));
  await user.click(nearby.getByText(name));
  return { user, s: await sheet() };
}

test('a static WAN address is checked, confirmed and stored', async () => {
  const { user, s } = await openWan();
  await user.selectOptions(s.getByLabelText('Connection'), 'static');
  await user.type(s.getByLabelText('IP address'), '203.0.113.10');
  await user.click(s.getByRole('button', { name: 'Apply' }));
  expect((await s.findByRole('alert')).textContent).toMatch(/^Enter the address, mask/);
  await user.type(s.getByLabelText('Gateway'), '203.0.113.1');
  await user.type(s.getByLabelText('DNS server'), '1.1.1.1');
  await user.type(s.getByLabelText('Second DNS server'), 'dns');
  await user.click(s.getByRole('button', { name: 'Apply' }));
  expect((await s.findByRole('alert')).textContent).toBe('The second DNS server isn’t an IPv4 address.');
  await user.clear(s.getByLabelText('Second DNS server'));
  await user.click(s.getByRole('button', { name: 'Apply' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Apply' }));
  await expectToast('WAN settings applied. Reconnecting…');
  expect(await api.internet.wan.get()).toMatchObject({ protocol: 'static', ipv4: { ip: '203.0.113.10', dns: ['1.1.1.1'] } });
});

test('PPPoE asks before applying and keeps the sheet open on cancel', async () => {
  const { user, s } = await openWan();
  await user.selectOptions(s.getByLabelText('Connection'), 'pppoe');
  await user.type(s.getByLabelText('Username'), 'isp-user');
  await user.type(s.getByLabelText('Password'), 'secret');
  await user.click(s.getByRole('button', { name: 'Apply' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Cancel' }));
  expect((await api.internet.wan.get()).protocol).not.toBe('pppoe');
  await user.click(s.getByRole('button', { name: 'Apply' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Apply' }));
  await expectToast('WAN settings applied. Reconnecting…');
  expect(await api.internet.wan.get()).toMatchObject({ protocol: 'pppoe', username: 'isp-user' });
});

test('joining a secured network, then disconnecting', async () => {
  const { user, s } = await scanAndPick('Neighbour-5G');
  await user.type(s.getByLabelText('Password'), 'short');
  await user.click(s.getByRole('button', { name: 'Join network' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter the network password.');
  await user.type(s.getByLabelText('Password'), '-and-long');
  await user.click(s.getByRole('button', { name: 'Join network' }));
  await expectToast('Joining Neighbour-5G. The dashboard updates once it’s online.');
  expect(await api.internet.repeater()).toMatchObject({ connected: true, ssid: 'Neighbour-5G' });
  await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Disconnect' }));
  await expectToast('Disconnected from Neighbour-5G');
  expect(await screen.findByText('The repeater isn’t connected. Find a network below.')).toBeTruthy();
});

test('an open network needs no password and is remembered', async () => {
  const { user, s } = await scanAndPick('Library Free WiFi');
  expect(s.getByText('This network is open, no password needed.')).toBeTruthy();
  await user.click(s.getByRole('button', { name: 'Join network' }));
  await expectToast(/^Joining Library Free WiFi/);
  expect((await api.internet.saved()).map((n) => n.ssid)).toContain('Library Free WiFi');
  expect(await screen.findByText('Router MAC on this network')).toBeTruthy();
});

test('forgetting a saved network', async () => {
  const user = await renderPage(<InternetPage />);
  const saved = within(await screen.findByRole('table', { name: 'Saved networks' }));
  await user.click(saved.getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Forget' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Forget' }));
  await expectToast('Forgot the selected networks');
  expect(await screen.findByText('No saved networks.')).toBeTruthy();
});

test('repeater settings lock the band and stop auto-joining', async () => {
  const user = await renderPage(<InternetPage />);
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  const s = await sheet();
  await user.click(s.getByRole('checkbox', { name: 'Join saved networks automatically' }));
  await user.selectOptions(s.getByLabelText('Band'), '5g');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Repeater settings saved');
  expect(await api.internet.repeaterConfig.get()).toMatchObject({ auto: false, lock_band: '5g' });
});
