import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { renderPage } from '../../test/render.tsx';
import { DeviceHistory } from '../clients/DeviceHistory.tsx';
import { TrafficPage } from '../insights/pages.tsx';
import { WanHealth } from '../internet/WanHealth.tsx';
import { SystemHistory } from '../system/SystemHistory.tsx';

afterEach(() => vi.restoreAllMocks());

const noAgent = () => vi.spyOn(api.stats, 'status').mockResolvedValue(null);
const figure = (name: RegExp | string) => screen.findByRole('figure', { name });

test('traffic: the internet, each network and each device over the chosen range', async () => {
  const user = await renderPage(<TrafficPage />);
  expect(await figure(/^Internet traffic: Download up to/)).toBeTruthy();
  expect(screen.getByText('Downloaded')).toBeTruthy();
  const networks = within(await screen.findByRole('table', { name: 'Traffic by network' }));
  expect(networks.getByText('Main LAN')).toBeTruthy();
  const devices = within(await screen.findByRole('table', { name: 'Traffic by device' }));
  expect(devices.getByText('Studio-Mac')).toBeTruthy();
  // a longer range redraws the chart with an hour in each point
  await user.click(screen.getByRole('button', { name: '30 days' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true'));
  expect(await figure(/^Internet traffic/)).toBeTruthy();
  await user.click(within(await screen.findByRole('table', { name: 'Traffic by device' })).getByText('Studio-Mac'));
  expect(location.hash).toMatch(/^#clients\?device=/);
});

test('traffic on a router without history keeps its own counters and says why', async () => {
  noAgent();
  await renderPage(<TrafficPage />);
  expect(await screen.findByText(/History needs the Zeeli agent/)).toBeTruthy();
  // the firmware’s per-device totals stay
  expect(await screen.findByRole('table', { name: 'Traffic by device' })).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Traffic by network' })).toBeNull();
});

test('a device’s usage and the times it connected', async () => {
  const maya = (await api.clients.list()).find((c) => c.hostname === 'Maya-iPhone');
  if (!maya) throw new Error('no demo phone');
  const user = await renderPage(<DeviceHistory client={maya} />);
  expect(await figure(/^Usage of this device: Download up to/)).toBeTruthy();
  expect(screen.getByText('Downloaded')).toBeTruthy();
  const visits = await screen.findByRole('heading', { name: 'Connection history' });
  const section = within(visits.closest('section') as HTMLElement);
  // each visit shows how long it lasted; the phone is on the network now
  expect((await section.findAllByText(/\d+ (min|h)/)).length).toBeGreaterThan(2);
  await user.click(screen.getByRole('button', { name: '12 months' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '12 months' }).getAttribute('aria-pressed')).toBe('true'));
});

test('a device that was first seen shows when', async () => {
  const guest = (await api.clients.list()).find((c) => c.hostname === 'Guest-Phone');
  if (!guest) throw new Error('no demo guest phone');
  await renderPage(<DeviceHistory client={guest} />);
  expect(await screen.findByText(/^First seen /)).toBeTruthy();
});

test('a device sheet on a router without history shows a note instead of charts', async () => {
  noAgent();
  const any = (await api.clients.list())[0];
  if (!any) throw new Error('no demo devices');
  await renderPage(<DeviceHistory client={any} />);
  expect(await screen.findByText(/History needs the Zeeli agent/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Usage' })).toBeNull();
});

test('internet health: latency, loss and the outage that took the main uplink down', async () => {
  const user = await renderPage(<WanHealth />);
  expect(await figure(/^Latency: Internet up to/)).toBeTruthy();
  expect(screen.getByRole('figure', { name: /^Packets lost/ })).toBeTruthy();
  const outages = within(await screen.findByRole('table', { name: 'Outages' }));
  expect(outages.getAllByRole('row')).toHaveLength(2);
  expect(outages.getByText('4 min')).toBeTruthy();
  // a year back there were three
  await user.click(screen.getByRole('button', { name: '12 months' }));
  await waitFor(async () => expect(within(await screen.findByRole('table', { name: 'Outages' })).getAllByRole('row')).toHaveLength(4));
  // the second uplink has its own record
  await user.click(screen.getByRole('button', { name: 'Repeater' }));
  expect(await screen.findByText(/^Router to gateway/)).toBeTruthy();
});

test('internet health on a router without history', async () => {
  noAgent();
  await renderPage(<WanHealth />);
  expect(await screen.findByText(/History needs the Zeeli agent/)).toBeTruthy();
});

test('the router’s CPU, memory and temperature over time', async () => {
  const user = await renderPage(<SystemHistory />);
  for (const title of ['CPU', 'Memory', 'Temperature']) expect(await figure(new RegExp(`^${title}:`))).toBeTruthy();
  expect(screen.getAllByText(/average .* · highest/)).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: '30 days' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')).toBe('true'));
  expect(await figure(/^CPU:/)).toBeTruthy();
});
