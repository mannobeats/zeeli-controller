import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { APPLYING, confirmDialog, expectApplied, renderPage, sheet } from '../../test/render.tsx';
import FirewallPage from './FirewallPage.tsx';

// Every firewall write waits out OpenWrt's apply-and-confirm (about 2.5 s), so these tests write sparingly.
// This is the page on a router without the Zeeli agent, which edits through LuCI.
beforeEach(() => {
  vi.spyOn(api.agent, 'version').mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

const rowOf = async (name: string) =>
  within(await screen.findByRole('table', { name: 'Traffic rules' }))
    .getByText(name)
    .closest('tr') as HTMLElement;
const ruleNamed = async (name: string) => (await api.openwrt.firewall()).rules.find((r) => r.name === name);

test('rules made by a router service open read-only and offer no bulk actions', async () => {
  const user = await renderPage(<FirewallPage />);
  expect(await screen.findByRole('checkbox', { name: 'Allow-Tailscale on' })).toHaveProperty('disabled', true);
  await user.click(await rowOf('Allow-Tailscale'));
  const s = await sheet();
  expect(s.getByText(/^Made by a router service/)).toBeTruthy();
  expect(s.queryByRole('button', { name: /Save/ })).toBeNull();
  await user.keyboard('{Escape}');
  await user.click(within(await rowOf('Allow-Tailscale')).getByRole('checkbox', { name: /^Select row/ }));
  expect(
    within(screen.getByRole('toolbar'))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent),
  ).toEqual(['Clear selection']);
});

test(
  'a new rule is checked, then added',
  async () => {
    const user = await renderPage(<FirewallPage />);
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    const s = await sheet();
    await user.click(s.getByRole('button', { name: 'Add rule' }));
    expect((await s.findByRole('alert')).textContent).toBe('Give the rule a name.');
    await user.type(s.getByLabelText('Name'), 'Game server');
    await user.type(s.getByLabelText(/^Destination port/), '99999');
    await user.click(s.getByRole('button', { name: 'Add rule' }));
    expect((await s.findByRole('alert')).textContent).toBe('Ports must be 1 to 65535: 443, 8000-8010 or 80 443.');
    await user.clear(s.getByLabelText(/^Destination port/));
    await user.type(s.getByLabelText(/^Destination port/), '27015 27016');
    await user.selectOptions(s.getByLabelText('Protocol'), 'icmp');
    await user.click(s.getByRole('button', { name: 'Add rule' }));
    expect((await s.findByRole('alert')).textContent).toBe('Ports only apply to TCP or UDP.');
    await user.selectOptions(s.getByLabelText('Protocol'), 'udp');
    await user.selectOptions(s.getByLabelText('IP version'), 'ipv4');
    await user.click(s.getByRole('button', { name: 'Add rule' }));
    await expectApplied('Added Game server');
    expect(await ruleNamed('Game server')).toMatchObject({ proto: 'udp', destPort: '27015 27016', family: 'ipv4', origin: 'custom' });
  },
  APPLYING,
);

test(
  'a custom rule turns off from its switch',
  async () => {
    const user = await renderPage(<FirewallPage />);
    await user.click(await screen.findByRole('checkbox', { name: 'Keep cameras off the internet on' }));
    await expectApplied('Keep cameras off the internet turned off');
    expect(await ruleNamed('Keep cameras off the internet')).toMatchObject({ enabled: false });
  },
  APPLYING,
);

test(
  'deleting an OpenWrt default warns what it can break',
  async () => {
    const user = await renderPage(<FirewallPage />);
    await user.click(await rowOf('Allow-DHCP-Renew'));
    await user.click((await sheet()).getByRole('button', { name: 'Delete rule' }));
    const c = await confirmDialog();
    expect(c.getByText(/^This includes OpenWrt defaults/)).toBeTruthy();
    await user.click(c.getByRole('button', { name: 'Delete' }));
    await expectApplied('Deleted Allow-DHCP-Renew');
    expect(await ruleNamed('Allow-DHCP-Renew')).toBeUndefined();
  },
  APPLYING,
);
