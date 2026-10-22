import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage } from '../../test/render.tsx';
import { DnsInsightsPage, TrafficPage } from './pages.tsx';

const log = async () => within(await screen.findByRole('table', { name: 'DNS query log' }));

test('the query log filters to blocked lookups and by domain or device', async () => {
  const user = await renderPage(<DnsInsightsPage />);
  expect((await log()).getByText('graph.instagram.com')).toBeTruthy();
  await user.click(screen.getByRole('checkbox', { name: 'Blocked only' }));
  expect((await log()).queryByText('graph.instagram.com')).toBeNull();
  expect((await log()).getByText('doubleclick.net')).toBeTruthy();
  await user.type(screen.getByRole('searchbox', { name: 'Filter the query log' }), 'no-such-domain');
  expect(screen.getByText('No queries match.')).toBeTruthy();
});

test('clearing traffic statistics asks first', async () => {
  const user = await renderPage(<TrafficPage />);
  await user.click(await screen.findByRole('button', { name: 'Clear statistics' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Clear statistics' }));
  await expectToast('Statistics cleared');
});

test('the counting period is saved', async () => {
  const next = (await api.traffic.rule.get()).time === 'week' ? 'day' : 'week';
  const user = await renderPage(<TrafficPage />);
  await user.selectOptions(await screen.findByLabelText('Period'), next);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await expectToast('Statistics settings saved');
  expect((await api.traffic.rule.get()).time).toBe(next);
});
