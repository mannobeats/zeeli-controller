import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import BackupPage from './BackupPage.tsx';

afterEach(() => vi.restoreAllMocks());

const table = async () => within(await screen.findByRole('table', { name: 'Snapshots' }));
const rowOf = async (reason: string) => (await (await table()).findByText(reason)).closest('tr') as HTMLElement;
const list = async () => (await api.safety.backup.snapshots.list()).snapshots;

test('without the agent the page says what is missing instead of failing', async () => {
  vi.spyOn(api.agent, 'version').mockResolvedValue(null);
  const user = await renderPage(<BackupPage />);
  expect(await screen.findByText('The Zeeli agent isn’t on this router yet')).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Snapshots' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Go to Firmware' }));
  expect(location.hash).toBe('#firmware');
});

test('snapshots list when, why and how big, newest first', async () => {
  await renderPage(<BackupPage />);
  const t = await table();
  const rows = await t.findAllByRole('row');
  expect(rows).toHaveLength(4);
  expect(within(rows[1] as HTMLElement).getByText('Before adding a firewall rule')).toBeTruthy();
  expect(within(rows[1] as HTMLElement).getByText('3 h ago')).toBeTruthy();
  expect(within(rows[1] as HTMLElement).getByText('458 KB')).toBeTruthy();
  expect(screen.getByText('2 of 10 kept, 1 automatic (the newest 10 are kept)')).toBeTruthy();
  expect(within(rows[1] as HTMLElement).getByText('Automatic')).toBeTruthy();
});

test('taking a snapshot needs a reason', async () => {
  const user = await renderPage(<BackupPage />);
  await user.click(await screen.findByRole('button', { name: 'Take a snapshot' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Take snapshot' }));
  expect((await s.findByRole('alert')).textContent).toBe('Say what it’s for, like “Before the holiday”.');
  await user.type(s.getByLabelText('What is it for?'), 'Before the test');
  await user.click(s.getByRole('button', { name: 'Take snapshot' }));
  await expectToast('Snapshot taken');
  expect((await list())[0]?.reason).toBe('Before the test');
  expect(await rowOf('Before the test')).toBeTruthy();
});

test('the changes since a snapshot name sections and options, not values', async () => {
  const user = await renderPage(<BackupPage />);
  await user.click(within(await rowOf('Before adding a firewall rule')).getByRole('button', { name: /^Changes since/ }));
  const s = await sheet();
  expect(await s.findByText('firewall')).toBeTruthy();
  expect(s.getByText('rule Block guests from the printer (new since)')).toBeTruthy();
  expect(s.getByText(/Values stay on the router/)).toBeTruthy();
  await user.keyboard('{Escape}');

  await user.click(within(await rowOf('Before the test')).getByRole('button', { name: /^Changes since/ }));
  expect(await (await sheet()).findByText('The settings are the same as in this snapshot.')).toBeTruthy();
});

test('restoring says what it writes back and what it does about the router', async () => {
  const user = await renderPage(<BackupPage />);
  await user.click(within(await rowOf('Before adding a firewall rule')).getByRole('button', { name: /^Restore/ }));
  const c = await confirmDialog();
  expect(c.getByText(/writes back firewall/)).toBeTruthy();
  expect(c.getByText(/saves the current settings as a snapshot first/)).toBeTruthy();
  await user.click(c.getByRole('button', { name: 'Cancel' }));
  expect((await api.safety.firewall.rules()).some((r) => r.name === 'Block guests from the printer')).toBe(true);

  await user.click(within(await rowOf('Before adding a firewall rule')).getByRole('button', { name: /^Restore/ }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Restore' }));
  await expectToast(/^Restored firewall\. Reloaded firewall so the change is live now\./);
  expect((await api.safety.firewall.rules()).some((r) => r.name === 'Block guests from the printer')).toBe(false);
  expect(screen.queryByText('Restart the router to finish')).toBeNull();
  expect((await list())[0]).toMatchObject({ reason: 'Before restoring a snapshot', kind: 'auto' });
});

test('settings that are only read at startup ask for a restart', async () => {
  const user = await renderPage(<BackupPage />);
  await user.click(within(await rowOf('Before restoring a backup file')).getByRole('button', { name: /^Restore/ }));
  const c = await confirmDialog();
  expect(c.getByText(/kmwan/)).toBeTruthy();
  await user.click(c.getByRole('button', { name: 'Restore' }));
  expect(await screen.findByText('Restart the router to finish')).toBeTruthy();
  expect(screen.getAllByText(/kmwan is only read when the router starts/).length).toBeGreaterThan(0);
  await user.click(screen.getByRole('button', { name: 'Restart now' }));
  await expectToast('Rebooting. This page reconnects when the router is back.');
});

test('a snapshot that already matches is not restored', async () => {
  const user = await renderPage(<BackupPage />);
  await user.click(await screen.findByRole('button', { name: 'Take a snapshot' }));
  await user.type((await sheet()).getByLabelText('What is it for?'), 'Same');
  await user.click((await sheet()).getByRole('button', { name: 'Take snapshot' }));
  await expectToast('Snapshot taken');
  await user.click(within(await rowOf('Same')).getByRole('button', { name: /^Restore/ }));
  await expectToast('The router already matches that snapshot.');
});

test('deleting a snapshot asks first', async () => {
  const user = await renderPage(<BackupPage />);
  await user.click(within(await rowOf('Before the holiday')).getByRole('button', { name: /^Delete/ }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete' }));
  await expectToast('Snapshot deleted');
  expect((await list()).some((s) => s.reason === 'Before the holiday')).toBe(false);
});

test('the backup file downloads through the browser', async () => {
  const urls = { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() };
  Object.assign(URL, urls);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  const user = await renderPage(<BackupPage />);
  await user.click(await screen.findByRole('button', { name: 'Download backup' }));
  await expectToast(/^Saved backup-\d+\.tar\.gz$/);
  expect(click).toHaveBeenCalled();
});

test('a backup file is sent, checked, confirmed, restored, then the router restarts', async () => {
  const user = await renderPage(<BackupPage />);
  await user.upload(await screen.findByLabelText('Backup file'), new File(['archive'], 'backup.tar.gz'));
  const c = await confirmDialog();
  expect(c.getByText(/91 files, 54 of them router settings/)).toBeTruthy();
  expect(c.getByText(/must restart afterwards/)).toBeTruthy();
  await user.click(c.getByRole('button', { name: 'Restore' }));
  await expectToast('Backup restored');
  expect(await screen.findByText('Restart the router to finish')).toBeTruthy();
  expect((await list())[0]?.reason).toBe('Before restoring a backup file');
});

test('a backup file the person backs out of is thrown away', async () => {
  const discard = vi.spyOn(api.safety.backup, 'discard');
  const user = await renderPage(<BackupPage />);
  await user.upload(await screen.findByLabelText('Backup file'), new File(['archive'], 'backup.tar.gz'));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Cancel' }));
  expect(discard).toHaveBeenCalled();
});

test('a file the router refuses shows why', async () => {
  vi.spyOn(api.safety.backup, 'inspect').mockRejectedValue(
    new Error('That archive holds files outside /etc (root/x), so it wasn’t restored.'),
  );
  const user = await renderPage(<BackupPage />);
  await user.upload(await screen.findByLabelText('Backup file'), new File(['archive'], 'backup.tar.gz'));
  expect((await screen.findByRole('alert')).textContent).toBe('That archive holds files outside /etc (root/x), so it wasn’t restored.');
});

test('a restore the router had to undo says so', async () => {
  await api.safety.backup.snapshots.create('Rollback test');
  await api.safety.firewall.updateZone('iot', { forward: 'ACCEPT' });
  const real = api.transport.zeeli.bind(api.transport);
  // the page never reaches the router again, so the router's own timer fires
  vi.spyOn(api.transport, 'zeeli').mockImplementation(async (area, method, args) =>
    real(area, method === 'confirm' ? 'revert' : method, args),
  );
  const user = await renderPage(<BackupPage />);
  await user.click(within(await rowOf('Rollback test')).getByRole('button', { name: /^Restore/ }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Restore' }));
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('The router undid the restore')).toBeTruthy();
  expect(within(alert).getByText(/because it wasn’t confirmed in time/)).toBeTruthy();
  expect(screen.queryByText('Restart the router to finish')).toBeNull();
  await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('The router undid the restore')).toBeNull();
});

test('while the router confirms a restore, the page says so', async () => {
  const real = api.transport.zeeli.bind(api.transport);
  let release: () => void = () => undefined;
  let asked: () => void = () => undefined;
  const confirmAsked = new Promise<void>((r) => (asked = r));
  const gate = new Promise<void>((r) => (release = r));
  vi.spyOn(api.transport, 'zeeli').mockImplementation(async (area, method, args) => {
    if (method === 'confirm') {
      asked();
      await gate;
    }
    return real(area, method, args);
  });
  const user = await renderPage(<BackupPage />);
  await user.click(within(await rowOf('Before adding a firewall rule')).getByRole('button', { name: /^Restore/ }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Restore' }));
  await confirmAsked;
  expect(screen.getByText('Confirming your change…')).toBeTruthy();
  release();
  await expectToast(/^Restored firewall/);
});
