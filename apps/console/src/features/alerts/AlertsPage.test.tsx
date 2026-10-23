import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { expectToast, renderPage, settled } from '../../test/render.tsx';
import { AlertsBell } from './AlertsBell.tsx';
import AlertsPage from './AlertsPage.tsx';
import { eventText } from './text.ts';

afterEach(() => vi.restoreAllMocks());

const unread = async () => (await api.stats.alerts()).unread;

test('the bell counts unread alerts and opens the Alerts page', async () => {
  const user = await renderPage(<AlertsBell />);
  const n = await unread();
  expect(n).toBeGreaterThan(0);
  await user.click(await screen.findByRole('button', { name: `Alerts, ${n} unread` }));
  expect(location.hash).toBe('#alerts');
});

test('a router that can’t record history has no bell and no alerts', async () => {
  vi.spyOn(api.stats, 'status').mockResolvedValue(null);
  await renderPage(<AlertsBell />);
  await settled();
  expect(screen.queryByRole('button', { name: /^Alerts/ })).toBeNull();
});

test('the Alerts page says so when history is missing, instead of staying blank', async () => {
  vi.spyOn(api.stats, 'status').mockResolvedValue(null);
  await renderPage(<AlertsPage />);
  expect(await screen.findByText(/History needs the Zeeli agent/)).toBeTruthy();
});

test('alerts are listed with the new device and the outage, and each can be acknowledged', async () => {
  const before = await unread();
  const user = await renderPage(<AlertsPage />);
  const list = within(await screen.findByRole('heading', { name: 'Unread', level: 2 }).then((h) => h.closest('section') as HTMLElement));
  expect(await list.findByText(/is new on your network/)).toBeTruthy();
  expect(list.getAllByText('The router switched from Ethernet 1 to Repeater').length).toBeGreaterThan(0);
  await user.click(list.getAllByRole('button', { name: /^Acknowledge: / })[0] as HTMLElement);
  await waitFor(async () => expect(await unread()).toBe(before - 1));
});

test('acknowledging everything clears the list', async () => {
  const user = await renderPage(<AlertsPage />);
  const all = await screen.findByRole('button', { name: 'Acknowledge all' });
  await waitFor(() => expect((all as HTMLButtonElement).disabled).toBe(false));
  await user.click(all);
  await expectToast('All alerts acknowledged');
  expect(await screen.findByText('Nothing needs your attention.')).toBeTruthy();
  expect(await unread()).toBe(0);
  // what was acknowledged moves to the earlier list rather than disappearing
  expect(await screen.findByRole('heading', { name: 'Earlier', level: 2 })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Acknowledge all' }) as HTMLButtonElement).disabled).toBe(true);
});

test('which events raise alerts is saved', async () => {
  const user = await renderPage(<AlertsPage />);
  const form = within(
    (await screen.findByRole('heading', { name: 'Which events raise an alert', level: 2 })).closest('form') as HTMLElement,
  );
  await user.click(form.getByRole('checkbox', { name: 'The router runs hot' }));
  await user.click(form.getByRole('checkbox', { name: 'A device disconnects' }));
  await user.click(form.getByRole('button', { name: 'Save' }));
  await expectToast('Alert settings saved');
  const on = (await api.stats.alerts()).on;
  expect(on).not.toContain('temp.high');
  expect(on).toContain('device.left');
});

test('the ping address and heat limit are checked and saved', async () => {
  const user = await renderPage(<AlertsPage />);
  const form = within((await screen.findByRole('heading', { name: 'Health checks', level: 2 })).closest('form') as HTMLElement);
  await user.clear(form.getByLabelText(/^Heat alert at/));
  await user.type(form.getByLabelText(/^Heat alert at/), '200');
  await user.click(form.getByRole('button', { name: 'Save' }));
  expect((await form.findByRole('alert')).textContent).toBe('Enter a temperature from 50 to 110 °C.');
  await user.clear(form.getByLabelText(/^Heat alert at/));
  await user.type(form.getByLabelText(/^Heat alert at/), '92');
  await user.clear(form.getByLabelText(/^Address to ping/));
  await user.type(form.getByLabelText(/^Address to ping/), '9.9.9.9');
  await user.click(form.getByRole('button', { name: 'Save' }));
  await expectToast('Health check settings saved');
  expect(await api.stats.settings()).toEqual({ target: '9.9.9.9', tempHigh: 92 });
});

test('every kind of event reads as a sentence', async () => {
  const events = await api.stats.events({ limit: 500 });
  const names = (mac: string) => (mac === 'AA' ? 'Laptop' : mac);
  const sample = (kind: string) => events.find((e) => e.kind === kind);
  for (const kind of ['device.new', 'device.joined', 'device.left', 'wan.down', 'wan.up', 'wan.failover', 'temp.high']) {
    const e = sample(kind);
    expect(e, kind).toBeTruthy();
    if (e) expect(eventText({ ...e, subject: e.kind.startsWith('device') ? 'AA' : e.subject }, names)).toMatch(/\w+ .*\w/);
  }
  const hot = sample('temp.high');
  if (hot) expect(eventText(hot, names)).toBe('The router reached 86 °C');
  const down = sample('wan.down');
  if (down) expect(eventText(down, names)).toBe('Ethernet 1 went down');
  const joined = sample('device.joined');
  if (joined) expect(eventText({ ...joined, subject: 'AA' }, names)).toBe('Laptop connected');
  // a device the router no longer lists is still called by the name it had
  if (joined) expect(eventText({ ...joined, subject: 'ZZ', name: 'Old phone' }, names)).toBe('Old phone connected');
});
