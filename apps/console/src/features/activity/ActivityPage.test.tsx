import { screen, waitFor, within } from '@testing-library/react';
import type { ActivityEvent, Client } from '@zeeli/router-api';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { renderPage } from '../../test/render.tsx';
import ActivityPage from './ActivityPage.tsx';

afterEach(() => {
  vi.restoreAllMocks();
  location.hash = '';
});

/** `n` events: even ones are the first device joining, odd ones are the second leaving. */
async function stubEvents(n: number) {
  const [a, b] = (await api.clients.list()) as [Client, Client];
  const events: ActivityEvent[] = Array.from({ length: n }, (_, i) => ({
    time: new Date(Date.now() - i * 60_000),
    kind: i % 2 ? 'device.left' : 'device.joined',
    subject: i % 2 ? b.mac : a.mac,
    detail: i % 2 ? 'Left the network' : 'Joined the network',
    count: 1,
  }));
  vi.spyOn(api.activity, 'recent').mockResolvedValue(events);
  return { a, b };
}

const items = () => within(screen.getByRole('list')).getAllByRole('listitem');

test('a long log stops at 25 events and shows more on request', async () => {
  await stubEvents(60);
  const user = await renderPage(<ActivityPage />);
  await screen.findByRole('list');
  expect(items()).toHaveLength(25);
  await user.click(screen.getByRole('button', { name: 'Show 25 more' }));
  expect(items()).toHaveLength(50);
  await user.click(screen.getByRole('button', { name: 'Show 10 more' }));
  expect(items()).toHaveLength(60);
});

test('the device menu narrows the log to one device and Clear brings the rest back', async () => {
  const { a } = await stubEvents(10);
  const user = await renderPage(<ActivityPage />);
  await screen.findByRole('list');
  await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Device' })).getAllByRole('option').length).toBeGreaterThan(1));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Device' }), a.mac);
  expect(items()).toHaveLength(5);
  expect(screen.getByText('5 of 10')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Clear' }));
  expect(items()).toHaveLength(10);
});

test('search narrows by words, and says so when nothing matches', async () => {
  await stubEvents(10);
  const user = await renderPage(<ActivityPage />);
  await screen.findByRole('list');
  await user.type(screen.getByRole('searchbox', { name: 'Search the activity log' }), 'left network');
  expect(items()).toHaveLength(5);
  await user.type(screen.getByRole('searchbox', { name: 'Search the activity log' }), ' zzz');
  expect(await screen.findByText('No events match.')).toBeTruthy();
});

test('#activity?device= opens the log already narrowed to that device', async () => {
  const { b } = await stubEvents(10);
  location.hash = `activity?device=${encodeURIComponent(b.mac)}`;
  await renderPage(<ActivityPage />);
  await screen.findByRole('list');
  expect(items()).toHaveLength(5);
  expect((screen.getByRole('combobox', { name: 'Device' }) as HTMLSelectElement).value).toBe(b.mac);
});
