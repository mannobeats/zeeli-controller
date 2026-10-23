import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import GroupsPage from './GroupsPage.tsx';

afterEach(() => vi.restoreAllMocks());

const table = async () => within(await screen.findByRole('table', { name: 'Groups' }));
const rowOf = async (name: string) => (await table()).getByText(name).closest('tr') as HTMLElement;
const groups = () => api.policies.groups.list();

test('groups list their devices and how many policies use them', async () => {
  await renderPage(<GroupsPage />);
  const kids = await rowOf('Kids');
  expect(within(kids).getByText('Person')).toBeTruthy();
  expect(kids.textContent).toMatch(/Maya-iPhone, Leo-iPad, Leo-Switch/);
  expect(kids.querySelector('td:last-child')?.textContent).toBe('2');
  expect(within(await rowOf('Cameras')).getByText('Devices')).toBeTruthy();
});

test('the section panel switches between Clients and Groups', async () => {
  const user = await renderPage(<GroupsPage />);
  const pages = within(await screen.findByRole('region', { name: 'Pages' }));
  expect(pages.getByRole('button', { name: 'Groups' }).getAttribute('aria-current')).toBe('page');
  await user.click(pages.getByRole('button', { name: 'Clients' }));
  expect(location.hash).toBe('#clients');
});

test('a group is created from the devices picked in its sheet', async () => {
  const user = await renderPage(<GroupsPage />);
  await screen.findByRole('table', { name: 'Groups' });
  await user.click(screen.getByRole('button', { name: 'New group' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Create group' }));
  expect((await s.findByRole('alert')).textContent).toBe('Give the group a name.');
  await user.type(s.getByLabelText('Name'), 'Grandparents');
  await user.click(s.getByRole('button', { name: 'A person' }));
  await user.type(s.getByRole('searchbox', { name: 'Find a device' }), 'Kindle');
  await user.click(s.getByRole('checkbox', { name: /Old-Kindle/ }));
  expect(s.getByRole('heading', { name: 'Devices (1)' })).toBeTruthy();
  await user.click(s.getByRole('button', { name: 'Create group' }));
  await expectToast('Created Grandparents');
  const made = (await groups()).find((g) => g.name === 'Grandparents');
  expect(made).toMatchObject({ kind: 'person' });
  expect(made?.members).toHaveLength(1);
});

test('two groups can’t share a name', async () => {
  const user = await renderPage(<GroupsPage />);
  await screen.findByRole('table', { name: 'Groups' });
  await user.click(screen.getByRole('button', { name: 'New group' }));
  const s = await sheet();
  await user.type(s.getByLabelText('Name'), 'kids');
  await user.click(s.getByRole('button', { name: 'Create group' }));
  expect((await s.findByRole('alert')).textContent).toBe('There is already a group called kids.');
});

test('a group is renamed and its members changed', async () => {
  const user = await renderPage(<GroupsPage />);
  await user.click(await rowOf('Cameras'));
  const s = await sheet();
  await user.clear(s.getByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'Security cameras');
  await user.click(s.getByRole('checkbox', { name: /Garage-Cam/ }));
  await user.click(s.getByRole('button', { name: 'Save group' }));
  await expectToast('Saved Security cameras');
  const saved = (await groups()).find((g) => g.name === 'Security cameras');
  expect(saved?.members).toHaveLength(1);
});

test('deleting a group says which policies it leaves, then deletes it', async () => {
  const user = await renderPage(<GroupsPage />);
  await user.click(await rowOf('Kids'));
  await user.click((await sheet()).getByRole('button', { name: 'Delete group' }));
  const dialog = await confirmDialog();
  expect(dialog.getByText(/taken out of 2 policies/)).toBeTruthy();
  await user.click(dialog.getByRole('button', { name: 'Delete group' }));
  await expectToast('Deleted Kids');
  expect((await groups()).map((g) => g.name)).not.toContain('Kids');
  expect((await api.policies.list()).policies.find((p) => p.name === 'Bedtime')).toMatchObject({ enabled: false, who: [] });
});

test('several groups are deleted from the bulk bar', async () => {
  const user = await renderPage(<GroupsPage />);
  const t = await table();
  for (const box of t.getAllByRole('checkbox', { name: /^Select row/ })) await user.click(box);
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete' }));
  await expectToast(/^Deleted \d+ groups$/);
  expect(await groups()).toEqual([]);
  expect(await screen.findByText(/No groups yet/)).toBeTruthy();
});

test('without the agent the page explains what to do', async () => {
  vi.spyOn(api.agent, 'version').mockResolvedValue(null);
  await renderPage(<GroupsPage />);
  expect(await screen.findByRole('heading', { name: 'Groups need the Zeeli agent' })).toBeTruthy();
});
