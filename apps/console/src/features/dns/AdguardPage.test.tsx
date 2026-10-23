import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { expectToast, renderPage, sheet } from '../../test/render.tsx';
import AdguardPage from './AdguardPage.tsx';

const tab = async (user: Awaited<ReturnType<typeof renderPage>>, name: string) => user.click(await screen.findByRole('button', { name }));
const table = async (name: string) => within(await screen.findByRole('table', { name }));

test('a button opens AdGuard Home’s own screen in a new tab', async () => {
  await renderPage(<AdguardPage />);
  const link = await screen.findByRole('link', { name: 'Open AdGuard Home' });
  expect(link.getAttribute('href')).toBe(`http://${location.hostname}:3000/`);
  expect(link.getAttribute('target')).toBe('_blank');
});

test('a query is blocked or allowed from the log, and undone from the toast', async () => {
  const user = await renderPage(<AdguardPage />);
  await user.click(await screen.findByRole('button', { name: 'Allow doubleclick.net' }));
  await expectToast('Allowed doubleclick.net');
  expect(await api.dns.userRules()).toContain('@@||doubleclick.net^');
  // a rule of yours now covers it, so the row offers to take it back instead
  expect(await screen.findByRole('button', { name: 'Remove allow doubleclick.net' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  await expectToast('Undone');
  expect(await api.dns.userRules()).not.toContain('@@||doubleclick.net^');

  await user.click(await screen.findByRole('button', { name: 'Block github.com' }));
  await expectToast('Blocked github.com');
  expect(await api.dns.userRules()).toContain('||github.com^');
  await user.click(await screen.findByRole('button', { name: 'Unblock github.com' }));
  await expectToast('Unblocked github.com');
  expect(await api.dns.userRules()).not.toContain('||github.com^');
});

test('custom rules read as sentences, and are added and deleted', async () => {
  const user = await renderPage(<AdguardPage />);
  await tab(user, 'Filtering');
  const rules = await table('Custom rules');
  expect(rules.getByText('Blocked: ads.example.com')).toBeTruthy();
  expect(rules.getByText('Allowed: cdn.example.org')).toBeTruthy();
  expect(rules.getByText('/tracker[0-9]+\\.example\\.net/').className).toContain('mono');

  await user.type(screen.getByLabelText(/^Domain/), 'not a domain');
  await user.click(screen.getByRole('button', { name: 'Add rule' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/isn’t a domain name/);

  await user.clear(screen.getByLabelText(/^Domain/));
  await user.type(screen.getByLabelText(/^Domain/), 'https://Ads.Test/path');
  await user.click(screen.getByRole('button', { name: 'Allow' }));
  await user.click(screen.getByRole('button', { name: 'Add rule' }));
  await expectToast('Allowed ads.test');
  expect(await api.dns.userRules()).toContain('@@||ads.test^');

  await user.click(await screen.findByRole('button', { name: 'Delete rule @@||ads.test^' }));
  await expectToast('Rule deleted');
  expect(await api.dns.userRules()).not.toContain('@@||ads.test^');
});

test('blocking a service saves the list and keeps the schedule', async () => {
  const user = await renderPage(<AdguardPage />);
  await tab(user, 'Filtering');
  expect(await screen.findByText('2 blocked')).toBeTruthy();
  const before = await api.dns.blockedServices();
  const logo = (await screen.findByRole('checkbox', { name: 'Block TikTok' })).closest('li')?.querySelector('img');
  expect(logo?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
  await user.click(screen.getByRole('checkbox', { name: 'Block TikTok' }));
  await expectToast('TikTok blocked');
  const after = await api.dns.blockedServices();
  expect(after.ids).toEqual([...before.ids, 'tiktok']);
  expect(after.schedule).toEqual(before.schedule);
  expect(await screen.findByText('3 blocked')).toBeTruthy();
  await user.type(screen.getByRole('searchbox', { name: 'Find a service' }), 'nothing like this');
  expect(screen.getByText('No services match.')).toBeTruthy();
});

test('a profile reads as a sentence and a new one takes the group’s devices', async () => {
  const user = await renderPage(<AdguardPage />);
  await tab(user, 'Devices');
  const list = await table('Device profiles');
  expect(await list.findByText('Malware protection on, parental control on, SafeSearch on, TikTok and YouTube blocked')).toBeTruthy();

  const create = await screen.findByRole('button', { name: 'New profile' });
  // groups arrive a moment after the page
  await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
  await user.click(create);
  const s = await sheet();
  await s.findByRole('option', { name: 'Cameras (group)' });
  await user.selectOptions(s.getByLabelText('For'), 'Cameras (group)');
  await user.click(s.getByRole('checkbox', { name: 'Use different protection than everyone else' }));
  await user.click(s.getByRole('checkbox', { name: 'Adult content' }));
  await user.click(s.getByRole('button', { name: 'Create profile' }));
  await expectToast('Saved the Cameras profile');

  const cameras = (await api.clients.list()).filter((c) => ['Front-Door-Cam', 'Garage-Cam'].includes(c.hostname));
  const made = (await api.dns.adguardClients()).find((c) => c.name === 'Zeeli: Cameras');
  expect(cameras).toHaveLength(2);
  expect(made?.ids.sort()).toEqual([...cameras.flatMap((c) => [c.ip, c.mac.toLowerCase()])].sort());
  expect(made).toMatchObject({ use_global_settings: false, parental_enabled: true, use_global_blocked_services: true });
  expect((await table('Device profiles')).getByText('Parental control on')).toBeTruthy();
});

test('a profile that blocks its own services, then goes away', async () => {
  const user = await renderPage(<AdguardPage />);
  await tab(user, 'Devices');
  await user.click((await table('Device profiles')).getByText('Cameras'));
  const s = await sheet();
  await user.click(s.getByRole('checkbox', { name: 'Block different services than everyone else' }));
  // it starts from what the whole network blocks
  await waitFor(() => expect((s.getByRole('checkbox', { name: 'Block Snapchat' }) as HTMLInputElement).checked).toBe(true));
  await user.click(s.getByRole('checkbox', { name: 'Block Discord' }));
  await user.click(s.getByRole('button', { name: 'Save profile' }));
  await expectToast('Saved the Cameras profile');
  const saved = (await api.dns.adguardClients()).find((c) => c.name === 'Zeeli: Cameras');
  expect(saved).toMatchObject({ use_global_blocked_services: false });
  expect(saved?.blocked_services).toEqual(expect.arrayContaining(['snapchat', 'fortnite', 'discord']));

  await user.click((await table('Device profiles')).getByText('Cameras'));
  await user.click((await sheet()).getByRole('button', { name: 'Delete profile' }));
  await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  await waitFor(async () => expect((await api.dns.adguardClients()).some((c) => c.name === 'Zeeli: Cameras')).toBe(false));
});

test('rewrites are checked, added and deleted', async () => {
  const user = await renderPage(<AdguardPage />);
  await tab(user, 'DNS rewrites');
  expect((await table('DNS rewrites')).getByText('nas.home')).toBeTruthy();

  await user.type(screen.getByLabelText(/^Name/), 'printer.home');
  await user.type(screen.getByLabelText(/^Answers with/), '192.168.8.999!');
  await user.click(screen.getByRole('button', { name: 'Add rewrite' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/isn’t an IP address or a name/);

  await user.clear(screen.getByLabelText(/^Answers with/));
  await user.type(screen.getByLabelText(/^Answers with/), '192.168.8.30');
  await user.click(screen.getByRole('button', { name: 'Add rewrite' }));
  await expectToast('printer.home now answers 192.168.8.30');
  expect(await api.dns.rewrites()).toContainEqual({ domain: 'printer.home', answer: '192.168.8.30' });

  await user.click(await screen.findByRole('button', { name: 'Delete nas.home' }));
  await expectToast('Deleted nas.home');
  expect((await api.dns.rewrites()).map((r) => r.domain)).toEqual(['printer.home']);
});
