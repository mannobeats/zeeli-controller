import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { expectToast, renderPage, settled, sheet } from '../../test/render.tsx';
import DnsPage from './DnsPage.tsx';

const form = async (title: string) => within((await screen.findByRole('heading', { name: title })).closest('form') as HTMLElement);

test('encrypted DNS through NextDNS needs its configuration ID', async () => {
  const user = await renderPage(<DnsPage />);
  expect(await screen.findByText('Quad9')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Change' }));
  const s = await sheet();
  await settled();
  await user.selectOptions(s.getByLabelText('Provider'), 'nextdns');
  await user.type(s.getByLabelText('NextDNS configuration ID'), 'nope');
  await user.click(s.getByRole('button', { name: 'Apply' }));
  expect((await s.findByRole('alert')).textContent).toBe('Enter the six-character ID from your NextDNS dashboard.');
  await user.clear(s.getByLabelText('NextDNS configuration ID'));
  await user.type(s.getByLabelText('NextDNS configuration ID'), 'abc123');
  await user.click(s.getByRole('button', { name: 'Apply' }));
  await expectToast('DNS now uses NextDNS');
  expect(await api.dns.config.get()).toMatchObject({ mode: 'secure', provider: 'nextdns', nextdns_id: 'abc123' });
  expect(await screen.findByText('abc123')).toBeTruthy();
});

test('servers you choose are checked before saving', async () => {
  const user = await renderPage(<DnsPage />);
  await user.click(await screen.findByRole('button', { name: 'Change' }));
  await user.selectOptions((await sheet()).getByLabelText('Source'), 'manual');
  await user.click((await sheet()).getByRole('button', { name: 'Apply' }));
  await expectToast('DNS now servers you choose');
  await user.click(await screen.findByRole('button', { name: 'Edit servers' }));
  const s = await sheet();
  await user.clear(s.getByLabelText('Server 1'));
  await user.clear(s.getByLabelText('Server 2'));
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Add at least one server.');
  await user.type(s.getByLabelText('Server 1'), 'dns.example');
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('dns.example isn’t an IP address.');
  await user.clear(s.getByLabelText('Server 1'));
  await user.type(s.getByLabelText('Server 1'), '9.9.9.9');
  await user.type(s.getByLabelText('Server 3'), '2620:fe::fe');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('DNS servers saved');
  expect((await api.dns.config.get()).manual_list).toEqual(['9.9.9.9', '2620:fe::fe']);
  expect(await screen.findByText('Server 2')).toBeTruthy();
});

test('back to the internet provider’s servers', async () => {
  const user = await renderPage(<DnsPage />);
  await user.click(await screen.findByRole('button', { name: 'Change' }));
  await user.selectOptions((await sheet()).getByLabelText('Source'), 'auto');
  await user.click((await sheet()).getByRole('button', { name: 'Apply' }));
  await expectToast('DNS now from your internet provider');
  expect(await screen.findByText('192.168.1.1')).toBeTruthy();
});

test('protections save', async () => {
  const user = await renderPage(<DnsPage />);
  const f = await form('Protections');
  await user.click(f.getByRole('checkbox', { name: 'DNS rebinding protection' }));
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('DNS protections saved');
  expect(await api.dns.config.get()).toMatchObject({ rebind_protection: false, force_dns: true });
});

test('local names need an address and a name', async () => {
  const user = await renderPage(<DnsPage />);
  const f = await form('Local names');
  const box = f.getByLabelText('One per line: address, then name');
  await user.type(box, '{Enter}printer.home');
  await user.click(f.getByRole('button', { name: 'Save' }));
  expect((await f.findByRole('alert')).textContent).toBe('“printer.home” should be an address then a name, like 192.168.8.10 nas.home');
  await user.clear(box);
  await user.type(box, '# lab{Enter}192.168.8.30 printer.home');
  await user.click(f.getByRole('button', { name: 'Save' }));
  await expectToast('Local names saved');
  expect(await api.dns.hosts()).toBe('# lab\n192.168.8.30 printer.home');
});
