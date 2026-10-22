import { screen, within } from '@testing-library/react';
import { beforeAll, expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage } from '../../test/render.tsx';
import { AdminPage, DevicePage, FirmwarePage, LogsPage, ResetPage, SchedulesPage } from './pages.tsx';

beforeAll(() => api.session.login('demo'));

const form = async (title: string) =>
  within((await screen.findByRole('heading', { name: title, level: 2 })).closest('form') as HTMLElement);
const save = (f: ReturnType<typeof within>, name = 'Save') => f.getByRole('button', { name });

test('the device page lists the router facts', async () => {
  const info = await api.system.info();
  await renderPage(<DevicePage />);
  expect(await screen.findByText(info.model)).toBeTruthy();
  expect(await screen.findByText('Uptime')).toBeTruthy();
  expect(await screen.findByText('Temperature')).toBeTruthy();
  expect(screen.getByText(info.serial)).toBeTruthy();
});

test('rebooting asks first', async () => {
  const user = await renderPage(<DevicePage />);
  await user.click(screen.getByRole('button', { name: 'Reboot router' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Reboot' }));
  await expectToast('Rebooting. This page reconnects when the router is back.');
});

test('the fan temperature must be 50 to 100 °C', async () => {
  const user = await renderPage(<DevicePage />);
  const f = await form('Fan');
  await user.clear(f.getByLabelText(/^Start the fan at/));
  await user.type(f.getByLabelText(/^Start the fan at/), '40');
  await user.click(save(f));
  expect((await f.findByRole('alert')).textContent).toBe('Pick a temperature from 50 to 100 °C.');
  await user.clear(f.getByLabelText(/^Start the fan at/));
  await user.type(f.getByLabelText(/^Start the fan at/), '65');
  await user.click(save(f));
  await expectToast('The fan starts at 65 °C');
  expect(await api.device.fan.get()).toMatchObject({ temperature: 65 });
});

test('installing firmware from a file', async () => {
  const user = await renderPage(<FirmwarePage />);
  expect(await screen.findByText('Up to date')).toBeTruthy();
  await user.upload(screen.getByLabelText('Firmware file'), new File(['img'], 'openwrt.bin'));
  expect(await screen.findByText('c0ffee')).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: 'Keep settings and installed packages' }));
  await user.click(screen.getByRole('button', { name: 'Install 4.10.2' }));
  const dialog = await confirmDialog();
  expect(dialog.getByText(/with factory settings, at its factory address/)).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: 'Install and restart' }));
  await expectToast('Installing. The router restarts when it’s done.');
});

test('a scheduled reboot needs a day', async () => {
  const user = await renderPage(<SchedulesPage />);
  const f = await form('Scheduled reboot');
  await user.click(f.getByRole('checkbox', { name: 'Reboot on a schedule' }));
  for (const day of f.getAllByRole('checkbox').slice(1)) await user.click(day);
  await user.click(save(f));
  expect((await f.findByRole('alert')).textContent).toBe('Pick at least one day.');
  await user.click(f.getAllByRole('checkbox')[1] as HTMLElement);
  await user.click(save(f));
  await expectToast('Reboots at 03:00');
  const reboot = await api.device.reboot.get();
  expect(reboot).toMatchObject({ enable: true, hour: '03' });
  expect(reboot.week).toHaveLength(1);
});

test('a WiFi night schedule turns the band off', async () => {
  const user = await renderPage(<SchedulesPage />);
  const f = await form('5 GHz WiFi schedule');
  await user.click(f.getByRole('checkbox', { name: 'Turn 5 GHz off at night' }));
  await user.clear(f.getByLabelText('On at'));
  await user.type(f.getByLabelText('On at'), '23:00');
  await user.click(save(f));
  expect((await f.findByRole('alert')).textContent).toBe('On and off times must differ.');
  await user.clear(f.getByLabelText('On at'));
  await user.type(f.getByLabelText('On at'), '07:00');
  await user.click(save(f));
  await expectToast('5 GHz turns off at 23:00');
  expect((await api.device.wifiTimers()).find((w) => w.band === '5G')).toMatchObject({ enable: true, turnon_hour: '07' });
});

test('the admin password change checks its fields', async () => {
  const user = await renderPage(<AdminPage />);
  const f = await form('Admin password');
  await user.type(f.getByLabelText(/^Current password/), 'oldpassword');
  await user.type(f.getAllByLabelText(/^New password/)[0] as HTMLElement, 'short');
  await user.click(save(f, 'Change password'));
  expect(await f.findByText('Use at least 8 characters.')).toBeTruthy();
  await user.type(f.getAllByLabelText(/^New password/)[0] as HTMLElement, 'er-one');
  await user.click(save(f, 'Change password'));
  expect(await f.findByText('The two new passwords don’t match.')).toBeTruthy();
});

test('a factory reset needs RESET typed, then a confirm', async () => {
  const user = await renderPage(<ResetPage />);
  const f = await form('Erase every setting');
  await user.type(f.getByLabelText('Type RESET to confirm'), 'reset');
  await user.click(save(f, 'Reset to factory settings'));
  expect((await f.findByRole('alert')).textContent).toBe('Type RESET in capitals to confirm.');
  await user.clear(f.getByLabelText('Type RESET to confirm'));
  await user.type(f.getByLabelText('Type RESET to confirm'), 'RESET');
  await user.click(save(f, 'Reset to factory settings'));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Reset router' }));
  await expectToast('Resetting. The router restarts with factory settings.');
});

test('logs switch kind and filter lines', async () => {
  const user = await renderPage(<LogsPage />);
  await user.click(screen.getByRole('button', { name: 'Kernel' }));
  expect(await screen.findByText(/Booting Linux on physical CPU/)).toBeTruthy();
  await user.type(screen.getByRole('searchbox', { name: 'Filter log lines' }), 'all good');
  expect(await screen.findByText('1 lines.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Crashes' }));
  expect(await screen.findByText('Nothing logged.')).toBeTruthy();
});
