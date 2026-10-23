import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import FirewallPage from './FirewallPage.tsx';

// The demo router has the agent, so this is the page with editable zones and rule order.
afterEach(() => vi.restoreAllMocks());

const rules = () => api.safety.firewall.rules();
const names = async () => (await rules()).map((r) => r.name);
const rulesTable = async () => within(await screen.findByRole('table', { name: 'Traffic rules' }));
const zonesTable = async () => within(await screen.findByRole('table', { name: 'Zones' }));

test('zones can be opened and edited, except the ones router services own', async () => {
  const user = await renderPage(<FirewallPage />);
  await user.click((await zonesTable()).getByText('Tailscale', { selector: '.name' }));
  expect((await sheet()).getByText(/^Made by a router service/)).toBeTruthy();
  expect((await sheet()).queryByRole('button', { name: 'Save and apply' })).toBeNull();
  await user.keyboard('{Escape}');

  await user.click((await zonesTable()).getByText('Guest', { selector: '.name' }));
  const s = await sheet();
  await user.selectOptions(s.getByLabelText('To the router'), 'ACCEPT');
  await user.click(s.getByLabelText('MSS clamping'));
  await user.click(s.getByRole('button', { name: 'Save and apply' }));
  await expectToast('Saved the Guest zone');
  expect((await api.safety.firewall.zones()).find((z) => z.name === 'guest')).toMatchObject({ input: 'ACCEPT', mssClamp: true });
});

test('a network that is in another zone is refused with the reason', async () => {
  const user = await renderPage(<FirewallPage />);
  await user.click((await zonesTable()).getByText('Guest', { selector: '.name' }));
  const s = await sheet();
  await user.click(s.getByLabelText('IoT (in IoT)'));
  await user.click(s.getByRole('button', { name: 'Save and apply' }));
  expect((await s.findByRole('alert')).textContent).toBe('iot is already in the iot zone. Take it out of there first.');
});

test('rules move up and down, and the ends can’t move further', async () => {
  const user = await renderPage(<FirewallPage />);
  const before = await names();
  const second = before[1] as string;
  expect((await screen.findByRole('button', { name: `Move ${before[0]} up` })).hasAttribute('disabled')).toBe(true);
  await user.click(await screen.findByRole('button', { name: `Move ${second} up` }));
  await expectToast(`Moved ${second}`);
  expect((await names()).slice(0, 2)).toEqual([second, before[0]]);
  // the first toast is still up, so wait for the order itself
  await user.click(await screen.findByRole('button', { name: `Move ${second} down` }));
  await waitFor(async () => expect(await names()).toEqual(before));
});

test('rules made by router services show but stay put', async () => {
  const user = await renderPage(<FirewallPage />);
  const table = await rulesTable();
  expect(await screen.findByRole('checkbox', { name: 'Allow-Tailscale on' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Move Allow-Tailscale up' }).hasAttribute('disabled')).toBe(true);
  await user.click(table.getByText('Allow-Tailscale'));
  expect((await sheet()).queryByRole('button', { name: /Save/ })).toBeNull();
});

test('a rule turns off from its switch', async () => {
  const user = await renderPage(<FirewallPage />);
  await user.click(await screen.findByRole('checkbox', { name: 'Keep cameras off the internet on' }));
  await expectToast('Keep cameras off the internet turned off');
  expect((await rules()).find((r) => r.name === 'Keep cameras off the internet')?.enabled).toBe(false);
});

test('a new rule is checked, then added', async () => {
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
  await user.type(s.getByLabelText(/^Destination port/), '27015');
  await user.selectOptions(s.getByLabelText('Protocol'), 'udp');
  await user.click(s.getByRole('button', { name: 'Add rule' }));
  await expectToast('Added Game server');
  expect((await rules()).find((r) => r.name === 'Game server')).toMatchObject({ proto: 'udp', destPort: '27015', owner: 'custom' });
});

test('editing and deleting a rule', async () => {
  const user = await renderPage(<FirewallPage />);
  await user.click((await rulesTable()).getByText('Block guests from the printer'));
  let s = await sheet();
  await user.selectOptions(s.getByLabelText('Action'), 'REJECT');
  await user.click(s.getByRole('button', { name: 'Save and apply' }));
  await expectToast('Saved Block guests from the printer');
  expect((await rules()).find((r) => r.name === 'Block guests from the printer')?.target).toBe('REJECT');

  await user.click((await rulesTable()).getByText('Block guests from the printer'));
  s = await sheet();
  await user.click(s.getByRole('button', { name: 'Delete rule' }));
  await expectToast('Deleted Block guests from the printer');
  expect(await names()).not.toContain('Block guests from the printer');
});

test('zones can be connected and disconnected', async () => {
  const user = await renderPage(<FirewallPage />);
  await user.click(await screen.findByRole('button', { name: 'Connect zones' }));
  const s = await sheet();
  await user.selectOptions(s.getByLabelText('From zone'), 'iot');
  await user.selectOptions(s.getByLabelText('To zone'), 'guest');
  await user.click(s.getByRole('button', { name: 'Connect' }));
  await expectToast('IoT can now reach Guest');
  await user.click(await screen.findByRole('button', { name: 'Remove IoT to Guest' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove' }));
  await expectToast('IoT no longer reaches Guest');
  expect((await api.safety.firewall.forwardings()).some((f) => f.src === 'iot' && f.dest === 'guest')).toBe(false);
  expect(screen.queryByRole('button', { name: 'Remove Main LAN to Tailscale' })).toBeNull();
});

test('while the router confirms, the page says so', async () => {
  const user = await renderPage(<FirewallPage />);
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
  await user.click(await screen.findByRole('checkbox', { name: 'Plex from the TV on' }));
  await confirmAsked;
  expect(screen.getByText('Confirming your change…')).toBeTruthy();
  release();
  await expectToast('Plex from the TV turned off');
  await waitFor(() => expect(screen.queryByText('Confirming your change…')).toBeNull());
});

test('when the router undid the change, the page says so and shows the old state', async () => {
  const user = await renderPage(<FirewallPage />);
  const real = api.transport.zeeli.bind(api.transport);
  // the router never hears the confirm, so its timer fires
  vi.spyOn(api.transport, 'zeeli').mockImplementation(async (area, method, args) => {
    if (method !== 'confirm') return real(area, method, args);
    return real(area, 'revert', args);
  });
  await user.click(await screen.findByRole('checkbox', { name: 'Allow-Ping on' }));
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('The router undid your change')).toBeTruthy();
  expect(within(alert).getByText(/because it wasn’t confirmed in time/)).toBeTruthy();
  expect((await rules()).find((r) => r.name === 'Allow-Ping')?.enabled).toBe(true);
  await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('The router undid your change')).toBeNull();
});

test('a router that can’t say what became of the change is reported as such', async () => {
  const user = await renderPage(<FirewallPage />);
  const real = api.transport.zeeli.bind(api.transport);
  vi.spyOn(api.transport, 'zeeli').mockImplementation(async (area, method, args) => {
    if (method === 'confirm') return { state: 'unknown', message: 'The router has no record of that change.' };
    return real(area, method, args);
  });
  await user.click(await screen.findByRole('checkbox', { name: 'Allow-Ping on' }));
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('Couldn’t confirm your change')).toBeTruthy();
  expect(within(alert).getByText('The router has no record of that change.')).toBeTruthy();
});

test('a write the router refuses is shown where it was made', async () => {
  const user = await renderPage(<FirewallPage />);
  const real = api.transport.zeeli.bind(api.transport);
  vi.spyOn(api.transport, 'zeeli').mockImplementation(async (area, method, args) => {
    if (method === 'rule_enable') throw new Error('The firewall changed since you loaded it. Reload the list.');
    return real(area, method, args);
  });
  await user.click(await screen.findByRole('checkbox', { name: 'Allow-Ping on' }));
  await expectToast('Couldn’t change the firewall: The firewall changed since you loaded it. Reload the list.');
});
