import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { expectToast, renderPage, sheet } from '../../test/render.tsx';
import ClientsPage from './ClientsPage.tsx';

afterEach(() => vi.restoreAllMocks());

const rowOf = async (name: string) =>
  (await within(await screen.findByRole('table', { name: 'Clients' })).findByText(name)).closest('tr') as HTMLElement;
const macOf = async (name: string) => (await api.clients.list()).find((c) => c.name === name)?.mac ?? '';
const policiesOf = async (tag: string) => (await api.policies.list()).policies.filter((p) => p.tag === tag);

async function openDevice(name: string) {
  const user = await renderPage(<ClientsPage />);
  await user.click(await rowOf(name));
  const s = await sheet();
  return {
    user,
    s,
    group: within(await s.findByRole('heading', { name: 'Groups and policies' }).then((h) => h.closest('section') as HTMLElement)),
  };
}

test('a device shows its groups and the policies that reach it', async () => {
  const { group } = await openDevice('Leo-iPad');
  expect(group.getByRole('button', { name: 'Remove from Kids' })).toBeTruthy();
  const sentences = group.getAllByRole('listitem').map((li) => li.textContent);
  // Bedtime shows "Active" only between 22:00 and 07:00, so the test can't depend on the clock
  expect(sentences).toEqual([
    expect.stringMatching(/^Block Kids from the internet every day 22:00–07:00(Active)?$/),
    'Block Kids from tiktok.com and tiktokv.comActive',
  ]);
});

test('a device is added to a group and taken out again', async () => {
  const mac = await macOf('Printer');
  const { user, group } = await openDevice('Printer');
  expect(group.getByText('Not in a group')).toBeTruthy();
  await user.selectOptions(group.getByLabelText('Add to a group'), 'Cameras');
  await expectToast('Printer added to Cameras');
  expect((await api.policies.groups.list()).find((g) => g.name === 'Cameras')?.members).toContain(mac);
  await user.click(await group.findByRole('button', { name: 'Remove from Cameras' }));
  await expectToast('Printer removed from Cameras');
  expect((await api.policies.groups.list()).find((g) => g.name === 'Cameras')?.members).not.toContain(mac);
});

test('pausing for an hour, then resuming', async () => {
  const mac = await macOf('Old-Kindle');
  const { user, group } = await openDevice('Old-Kindle');
  await user.click(group.getByRole('button', { name: 'Pause internet for 1 hour' }));
  await expectToast(/^Old-Kindle paused until /);
  const [paused] = await policiesOf(`pause:${mac}`);
  expect(paused).toMatchObject({ who: [{ type: 'client', id: mac }], what: { kind: 'internet' }, action: { kind: 'block' } });
  expect((paused?.until ?? 0) - Date.now() / 1000).toBeGreaterThan(3500);
  await user.click(await group.findByRole('button', { name: 'Resume internet' }));
  await expectToast('Old-Kindle back online');
  expect(await policiesOf(`pause:${mac}`)).toEqual([]);
});

test('the pause toast can be undone', async () => {
  const mac = await macOf('Old-Kindle');
  const { user, group } = await openDevice('Old-Kindle');
  await user.click(group.getByRole('button', { name: 'Pause internet for 1 hour' }));
  await expectToast(/^Old-Kindle paused/);
  // the sheet is modal, which switches off clicks outside it; the toast works in the real page
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await expectToast('Undone');
  await waitFor(async () => expect(await policiesOf(`pause:${mac}`)).toEqual([]));
});

test('blocking as a policy makes a policy that can then be scheduled', async () => {
  const mac = await macOf('Garage-Cam');
  const { user, group } = await openDevice('Garage-Cam');
  await user.click(group.getByRole('button', { name: 'Block as a policy' }));
  await expectToast('Blocked Garage-Cam with a policy');
  const made = (await api.policies.list()).policies.find((p) => p.name === 'Block Garage-Cam');
  expect(made).toMatchObject({ who: [{ type: 'client', id: mac }], what: { kind: 'everything' }, when: { kind: 'always' }, until: null });
  await user.click(await group.findByRole('button', { name: 'Open Policies' }));
  expect(location.hash).toBe('#policies');
});

test('a failed change says why', async () => {
  vi.spyOn(api.policies.groups, 'addMembers').mockRejectedValue(
    new Error('The router is busy applying another change. Try again in a moment.'),
  );
  const { user, group } = await openDevice('Watch');
  await user.selectOptions(group.getByLabelText('Add to a group'), 'Cameras');
  await expectToast('The router is busy applying another change. Try again in a moment.');
});

test('without the agent the sheet has no groups section', async () => {
  vi.spyOn(api.agent, 'version').mockResolvedValue(null);
  const user = await renderPage(<ClientsPage />);
  await user.click(await rowOf('Printer'));
  const s = await sheet();
  expect(s.getByRole('heading', { name: 'Name and type' })).toBeTruthy();
  expect(s.queryByRole('heading', { name: 'Groups and policies' })).toBeNull();
});
