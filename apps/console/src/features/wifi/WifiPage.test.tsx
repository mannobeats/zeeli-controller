import { screen, within } from '@testing-library/react';
import type { WifiNetwork } from '@zeeli/router-api';
import { beforeAll, expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import WifiPage from './WifiPage.tsx';

beforeAll(() => api.session.login('demo'));

const find = async (pick: (n: WifiNetwork) => boolean) => (await api.wifi.list()).find(pick) as WifiNetwork;
const rowOf = async (ssid: string) => (await screen.findAllByText(ssid))[0]?.closest('tr') as HTMLElement;

test('editing a main network checks the password, then saves', async () => {
  const n = await find((x) => x.role === 'main' && x.kind === 'band');
  const user = await renderPage(<WifiPage />);
  await user.click(await rowOf(n.ssid));
  const s = await sheet();
  expect(s.getByLabelText('Channel')).toBeTruthy();
  await user.selectOptions(s.getByLabelText(/^Transmit power/), 'low');
  await user.clear(s.getByLabelText('Network name'));
  await user.type(s.getByLabelText('Network name'), 'Upstairs');
  await user.clear(s.getByLabelText(/^Password/));
  await user.type(s.getByLabelText(/^Password/), 'short');
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Password must be 8 to 63 characters.');
  await user.type(s.getByLabelText(/^Password/), '-enough');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved Upstairs. Devices reconnect in a few seconds.');
  expect(await find((x) => x.name === n.name)).toMatchObject({ ssid: 'Upstairs', key: 'short-enough' });
});

test('an empty name is refused and an open network needs no password', async () => {
  const n = await find((x) => x.role === 'guest');
  const user = await renderPage(<WifiPage />);
  await user.click(await rowOf(n.ssid));
  const s = await sheet();
  expect(s.queryByLabelText('Channel')).toBeNull();
  await user.clear(s.getByLabelText('Network name'));
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Network name must be 1 to 32 bytes.');
  await user.type(s.getByLabelText('Network name'), 'Visitors');
  await user.selectOptions(s.getByLabelText('Security'), 'none');
  expect(s.queryByLabelText(/^Password/)).toBeNull();
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved Visitors. Devices reconnect in a few seconds.');
  expect(await find((x) => x.name === n.name)).toMatchObject({ ssid: 'Visitors', encryption: 'none' });
});

test('turning a network off asks first; turning it on does not', async () => {
  const n = await find((x) => x.enabled && x.kind === 'band');
  const user = await renderPage(<WifiPage />);
  await user.click(within(await rowOf(n.ssid)).getByRole('checkbox', { name: `${n.ssid} on` }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Turn off' }));
  await expectToast(`${n.ssid} turned off. Radios restart for a few seconds.`);
  expect(await find((x) => x.name === n.name)).toMatchObject({ enabled: false });
  await user.click(within(await rowOf(n.ssid)).getByRole('checkbox', { name: `${n.ssid} on` }));
  await expectToast(`${n.ssid} turned on. Radios restart for a few seconds.`);
});

test('bulk turn on from the selection bar', async () => {
  const user = await renderPage(<WifiPage />);
  const table = await screen.findByRole('table', { name: 'Your networks' });
  await user.click(within(table).getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Turn off' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Turn off' }));
  await expectToast(/networks turned off/);
  await user.click(within(table).getByRole('checkbox', { name: 'Select all' }));
  await user.click(screen.getByRole('button', { name: 'Turn on' }));
  await expectToast(/networks turned on/);
});
