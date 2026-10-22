import { screen, within } from '@testing-library/react';
import { beforeAll, expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { APPLYING, confirmDialog, expectApplied, expectToast, renderPage } from '../../test/render.tsx';
import { AppPage } from './AppPage.tsx';

beforeAll(async () => {
  await api.session.login('demo');
  await api.session.unlockAdvanced('demo');
});

/** Render the app page the way the router does: the app comes from the route. */
const open = (id: string) => {
  location.hash = `app-${id}`;
  return renderPage(<AppPage />);
};
const panel = async (title: string) =>
  within((await screen.findByRole('heading', { name: title, level: 2 })).closest('section, form') as HTMLElement);

test('an installed app shows its version, service, drive state and settings', { timeout: APPLYING }, async () => {
  const user = await open('minidlna');
  expect(await screen.findByRole('heading', { name: 'Media server (DLNA)', level: 1 })).toBeTruthy();
  expect((await panel('About')).getByText('minidlna 1.3.2-1')).toBeTruthy();
  const service = await panel('Service');
  expect(await service.findByText('Not shown: the router’s permissions hide it')).toBeTruthy();
  expect((service.getByRole('checkbox', { name: 'Start at boot' }) as HTMLInputElement).checked).toBe(true);
  expect(await (await panel('USB drive')).findByText(/No USB drive is mounted/)).toBeTruthy();

  const on = await screen.findByRole('checkbox', { name: 'Media server on' });
  const settings = within(on.closest('form') as HTMLElement);
  await user.click(on);
  const name = settings.getByLabelText('Name TVs show');
  await user.clear(name);
  await user.type(name, 'Living room');
  await user.click(settings.getByRole('button', { name: 'Save' }));
  await expectApplied('Media server (DLNA) settings saved');
  const dlna = (await api.apps.list()).find((a) => a.id === 'minidlna');
  expect((await api.apps.config(dlna as never)).values).toMatchObject({
    'minidlna.config.enabled': true,
    'minidlna.config.friendly_name': 'Living room',
  });
});

test('start at boot and service actions report what the router did', async () => {
  const user = await open('samba');
  const service = await panel('Service');
  await user.click(await service.findByRole('checkbox', { name: 'Start at boot' }));
  await expectToast('File sharing (SMB) starts at boot');
  expect(await api.apps.service('samba4')).toMatchObject({ enabled: true });
  await user.click(service.getByRole('button', { name: 'Restart' }));
  await expectToast('File sharing (SMB) restarted');
  expect(await (await panel('Shares')).findByText(/No shared folders yet/)).toBeTruthy();
});

test('iperf3 says how to run a test against this router, and offers to start the server', async () => {
  await open('iperf3');
  const how = await panel('How to use it');
  expect(await how.findByText('iperf3 -c 192.168.8.1')).toBeTruthy();
  expect(how.getByText(/port 5201/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Service' })).toBeNull();
  expect(await screen.findByRole('button', { name: 'Start a test server' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Coming next' })).toBeNull();
});

test('an app that is not installed installs from its page, and removes again after a named confirm', async () => {
  const user = await open('banip');
  expect((await panel('About')).getByText('Not installed')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Install' }));
  expect(await screen.findByText(/^Installing IP blocklists…/, { selector: 'output' })).toBeTruthy();
  await expectToast('IP blocklists installed');
  expect((await panel('About')).getByText('banip 0.9.4-3')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Remove' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove IP blocklists' }));
  await expectToast('IP blocklists removed');
  expect((await api.apps.list()).find((a) => a.id === 'banip')?.installed).toBe(false);
});
