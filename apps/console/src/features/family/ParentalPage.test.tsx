import { fireEvent, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { APPLYING, confirmDialog, expectApplied, expectToast, renderPage, settled, sheet } from '../../test/render.tsx';
import ParentalPage from './ParentalPage.tsx';

const leo = async () => (await api.family.config()).profiles.find((p) => p.name === 'Leo');

test('editing a profile: per-day bedtime, apps and sites', async () => {
  const user = await renderPage(<ParentalPage />);
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  const s = await sheet();
  await settled();
  await user.click(s.getByRole('button', { name: 'Different per day' }));
  await user.click(s.getByRole('checkbox', { name: 'Sun' }));
  fireEvent.change(s.getByLabelText('Mon starts'), { target: { value: '21:00' } });
  await user.type(s.getByRole('searchbox', { name: 'Find an app' }), 'zz');
  expect(s.getByText('No app by that name. Add its website below instead.')).toBeTruthy();
  await user.clear(s.getByRole('searchbox', { name: 'Find an app' }));
  await user.type(s.getByRole('searchbox', { name: 'Find an app' }), 'rob');
  await user.click(s.getByRole('button', { name: /^Roblox/ }));
  await user.click(s.getByRole('button', { name: 'Unblock TikTok' }));
  await user.type(s.getByLabelText('Block these websites, one per line'), 'https://www.twitch.tv/');
  await user.click(s.getByRole('button', { name: 'Save profile' }));
  await expectToast('Saved Leo');
  const saved = await leo();
  expect(saved).toMatchObject({ bedtimeDays: 'customize', apps: ['roblox'], sites: ['www.twitch.tv'] });
  expect(saved?.bedtimes.find((b) => b.week === 1)).toMatchObject({ begin: '21:00' });
  expect(saved?.bedtimes.find((b) => b.week === 7)).toMatchObject({ enabled: false });
});

test('a new profile needs devices that aren’t in another profile', async () => {
  const user = await renderPage(<ParentalPage />);
  await user.click(await screen.findByRole('button', { name: 'New profile' }));
  const s = await sheet();
  await user.type(s.getByLabelText('Profile name'), 'Maya');
  await user.click(s.getByRole('button', { name: 'Create profile' }));
  expect((await s.findByRole('alert')).textContent).toBe('Pick at least one device.');
  expect(await s.findAllByText('In Leo')).toHaveLength(2);
  const free = s.getAllByRole('checkbox').filter((b) => b.closest('.pick') && !(b as HTMLInputElement).disabled);
  await user.click(free[0] as HTMLElement);
  await user.click(s.getByRole('button', { name: 'Create profile' }));
  await expectToast('Created Maya');
  expect((await api.family.config()).profiles.find((p) => p.name === 'Maya')).toMatchObject({ macs: [expect.any(String)] });
});

test('the device picker searches by name, IP or MAC', async () => {
  const user = await renderPage(<ParentalPage />);
  await user.click(await screen.findByRole('button', { name: 'New profile' }));
  const s = await sheet();
  await user.type(s.getByRole('searchbox', { name: 'Find a device' }), 'no-such-device');
  expect(s.queryAllByRole('checkbox').filter((b) => b.closest('.pick'))).toEqual([]);
});

test('pausing a profile for an hour is a policy the router ends by itself', async () => {
  const user = await renderPage(<ParentalPage />);
  const card = (await screen.findByRole('heading', { name: 'Leo' })).closest('article') as HTMLElement;
  await user.click(within(card).getByRole('button', { name: 'Pause internet' }));
  const s = await sheet();
  await user.click(s.getByRole('radio', { name: '1 hour' }));
  await user.click(s.getByRole('button', { name: 'Pause now' }));
  await expectToast(/^Leo paused until /);
  const mine = (await api.family.pauses()).find((p) => p.agent);
  expect(mine).toMatchObject({ until: expect.any(Date) });
  const policy = (await api.policies.list()).policies.find((p) => p.tag === `family:${mine?.profileId}`);
  expect(policy).toMatchObject({ action: { kind: 'block' }, what: { kind: 'everything' } });
  expect(policy?.until).toBeGreaterThan(Date.now() / 1000);
});

test('parental control and single profiles switch off', async () => {
  const user = await renderPage(<ParentalPage />);
  await user.click(await screen.findByRole('checkbox', { name: 'Leo on' }));
  await expectToast('Leo off');
  await user.click(screen.getByRole('checkbox', { name: 'Parental control on' }));
  await expectToast('Parental control off');
  expect(await screen.findByText(/^Parental control is off/)).toBeTruthy();
  expect(await api.family.config()).toMatchObject({ enabled: false });
});

test(
  'deleting every profile leads back to the presets',
  async () => {
    const user = await renderPage(<ParentalPage />);
    for (const name of ['Leo', 'Maya']) {
      const card = (await screen.findByRole('heading', { name })).closest('article') as HTMLElement;
      await user.click(within(card).getByRole('button', { name: 'Edit' }));
      await user.click((await sheet()).getByRole('button', { name: 'Delete profile' }));
      await user.click((await confirmDialog()).getByRole('button', { name: 'Delete profile' }));
      // Leo's pauses are lifted too: the policy and the OpenWrt rule the demo starts with
      await expectApplied(`Deleted ${name}`);
    }
    await user.click(await screen.findByRole('button', { name: /^Teenager/ }));
    const s = await sheet();
    expect(s.getByRole('heading', { name: 'New profile: Teenager' })).toBeTruthy();
    expect(s.getByLabelText('Starts')).toHaveProperty('value', '23:00');
  },
  APPLYING,
);
