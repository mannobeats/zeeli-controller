import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, settled, sheet } from '../../test/render.tsx';
import PoliciesPage from './PoliciesPage.tsx';

afterEach(() => vi.restoreAllMocks());

const table = async () => within(await screen.findByRole('table', { name: 'Policies' }));
const rowOf = async (text: string) => (await table()).getAllByText(text, { exact: false })[0]?.closest('tr') as HTMLElement;
const enabled = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const names = async () => (await api.policies.list()).policies.map((p) => p.name);
const preview = (s: ReturnType<typeof within>) => s.getByTestId('policy-preview').textContent;

test('policies read as sentences, with what is applying marked', async () => {
  await renderPage(<PoliciesPage />);
  const t = await table();
  const rows = t.getAllByRole('row').slice(1);
  expect(rows[0]?.textContent).toContain('Block Kids from the internet every day 22:00–07:00');
  expect(rows[1]?.textContent).toContain('Block Kids from tiktok.com and tiktokv.com');
  expect(rows[2]?.textContent).toMatch(/Block Living-Room-TV from the internet until \S/);
  expect(within(rows[1] as HTMLElement).getByText('Active')).toBeTruthy();
  expect(screen.getByText(/3 policies, \d applying now/)).toBeTruthy();
});

test('a policy switches off and on from its row', async () => {
  const user = await renderPage(<PoliciesPage />);
  await table();
  await user.click(screen.getByRole('checkbox', { name: 'No TikTok on' }));
  await expectToast('No TikTok turned off');
  expect((await api.policies.list()).policies.find((p) => p.name === 'No TikTok')?.enabled).toBe(false);
  expect(within(await rowOf('tiktok.com')).getByText('Off')).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: 'No TikTok on' }));
  await expectToast('No TikTok turned on');
});

test('policies move up and down the list', async () => {
  const user = await renderPage(<PoliciesPage />);
  await table();
  expect((screen.getByRole('button', { name: 'Move Bedtime up' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Move Bedtime down' }));
  await waitFor(() => expect(enabled('Move Bedtime up').disabled).toBe(false));
  expect((await names()).slice(0, 2)).toEqual(['No TikTok', 'Bedtime']);
  await user.click(enabled('Move Bedtime up'));
  await waitFor(async () => expect((await names()).slice(0, 2)).toEqual(['Bedtime', 'No TikTok']));
});

test('the bulk bar turns policies off together and deletes them after a confirm', async () => {
  const user = await renderPage(<PoliciesPage />);
  await table();
  const pick = async (text: string) => user.click(within(await rowOf(text)).getByRole('checkbox', { name: /^Select row/ }));
  await pick('Living-Room-TV');
  await pick('tiktok.com');
  await user.click(screen.getByRole('button', { name: 'Turn off' }));
  await expectToast('2 policies turned off');
  await pick('tiktok.com');
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete' }));
  await expectToast('Deleted No TikTok');
  expect(await names()).not.toContain('No TikTok');
});

test('a new policy is built step by step with a live sentence', async () => {
  const user = await renderPage(<PoliciesPage />);
  await table();
  await user.click(screen.getByRole('button', { name: 'New policy' }));
  const s = await sheet();
  expect(preview(s)).toBe('Block Kids from the internet');
  await user.click(s.getByRole('button', { name: 'Specific sites' }));
  fireEvent.change(s.getByLabelText(/^Sites, one per line/), { target: { value: 'https://www.youtube.com/watch\nroblox.com' } });
  expect(preview(s)).toBe('Block Kids from www.youtube.com and roblox.com');
  await user.click(s.getByRole('button', { name: 'On a schedule' }));
  expect(preview(s)).toBe('Block Kids from www.youtube.com and roblox.com every day 22:00–07:00');
  await user.click(s.getByRole('checkbox', { name: 'Sat' }));
  await user.click(s.getByRole('checkbox', { name: 'Sun' }));
  expect(preview(s)).toBe('Block Kids from www.youtube.com and roblox.com weekdays 22:00–07:00');
  await user.selectOptions(s.getByLabelText(/^Ends/), '4h');
  expect(preview(s)).toMatch(/ until \S/);
  await user.click(s.getByRole('button', { name: 'Block' }));
  await user.click(s.getByRole('button', { name: 'Create policy' }));
  await expectToast(/^Created Block Kids from www\.youtube\.com/);
  const made = (await api.policies.list()).policies.find((p) => p.what.kind === 'sites' && p.what.sites.includes('roblox.com'));
  expect(made).toMatchObject({ when: { kind: 'schedule', days: [1, 2, 3, 4, 5], from: '22:00', to: '07:00' }, action: { kind: 'block' } });
  expect(made?.until).toBeGreaterThan(Date.now() / 1000);
});

test('choosing a speed limit hides what to cover and the router’s complaint shows in the sheet', async () => {
  const user = await renderPage(<PoliciesPage />);
  await table();
  await user.click(screen.getByRole('button', { name: 'New policy' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Limit speed' }));
  expect(s.getByText('A speed limit covers all of a device’s traffic.')).toBeTruthy();
  expect(s.queryByRole('button', { name: 'Networks' })).toBeNull();
  await user.click(s.getByRole('button', { name: 'Create policy' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter a download or an upload limit.');
  await user.type(s.getByLabelText(/^Download/), '5');
  await user.type(s.getByLabelText(/^Upload/), '1');
  expect(preview(s)).toBe('Limit Kids to 5 Mbps down, 1 up');
  await user.click(s.getByRole('button', { name: 'Create policy' }));
  await expectToast('Created Limit Kids to 5 Mbps down, 1 up');
});

test('a policy that blocks another network picks it from the list', async () => {
  const user = await renderPage(<PoliciesPage />);
  await table();
  await user.click(screen.getByRole('button', { name: 'New policy' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Networks' }));
  await user.click(s.getByRole('checkbox', { name: /Guest/ }));
  await user.click(s.getByRole('button', { name: 'Another network' }));
  await user.selectOptions(s.getByLabelText('Network'), 'iot');
  expect(preview(s)).toBe('Block Kids and everyone on Guest from reaching IoT');
  await user.click(s.getByRole('button', { name: 'Create policy' }));
  await expectToast(/^Created Block Kids and everyone on/);
});

test('who is picked from groups, devices and networks, and taken off again', async () => {
  const user = await renderPage(<PoliciesPage />);
  await table();
  await user.click(screen.getByRole('button', { name: 'New policy' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Devices' }));
  await user.type(s.getByRole('searchbox', { name: 'Find a device' }), 'no-such-device');
  expect(s.queryAllByRole('checkbox').filter((b) => b.closest('.pick'))).toEqual([]);
  await user.clear(s.getByRole('searchbox', { name: 'Find a device' }));
  await user.type(s.getByRole('searchbox', { name: 'Find a device' }), 'Printer');
  await user.click(s.getByRole('checkbox', { name: /Printer/ }));
  expect(preview(s)).toBe('Block Kids and Printer from the internet');
  await user.click(s.getByRole('button', { name: 'Remove Kids' }));
  expect(preview(s)).toBe('Block Printer from the internet');
  await user.click(s.getByRole('button', { name: 'Remove Printer' }));
  expect(preview(s)).toBe('Block nobody from the internet');
  await user.click(s.getByRole('button', { name: 'Create policy' }));
  expect((await s.findByRole('alert')).textContent).toBe('Choose who the policy is for.');
});

test('editing keeps the end time unless it is changed, and a policy can be deleted from its sheet', async () => {
  const user = await renderPage(<PoliciesPage />);
  await user.click(await rowOf('Living-Room-TV'));
  const s = await sheet();
  expect(s.getByRole('heading', { name: 'Edit Living-Room-TV paused' })).toBeTruthy();
  expect(s.getByTestId('policy-preview').textContent).toMatch(/^Block Living-Room-TV from the internet until \S/);
  expect((s.getByLabelText(/^Ends/) as HTMLSelectElement).value).toBe('keep');
  const before = (await api.policies.list()).policies.find((p) => p.name === 'Living-Room-TV paused')?.until;
  await user.click(s.getByRole('button', { name: 'Save policy' }));
  await expectToast('Saved Living-Room-TV paused');
  expect((await api.policies.list()).policies.find((p) => p.name === 'Living-Room-TV paused')?.until).toBe(before);
  await user.click(await rowOf('Living-Room-TV'));
  await user.click((await sheet()).getByRole('button', { name: 'Delete policy' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete policy' }));
  await expectToast('Deleted Living-Room-TV paused');
  await settled();
  expect(await names()).not.toContain('Living-Room-TV paused');
});

test('an empty list starts from a preset', async () => {
  for (const p of (await api.policies.list()).policies) await api.policies.remove(p.id);
  const user = await renderPage(<PoliciesPage />);
  await user.click(await screen.findByRole('button', { name: /^Bedtime/ }));
  const s = await sheet();
  expect(preview(s)).toBe('Block Kids from the internet every day 22:00–07:00');
});

test('without the agent the page explains what to do', async () => {
  vi.spyOn(api.agent, 'version').mockResolvedValue(null);
  const user = await renderPage(<PoliciesPage />);
  expect(await screen.findByRole('heading', { name: 'Policies need the Zeeli agent' })).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Firmware' }));
  expect(location.hash).toBe('#firmware');
});
