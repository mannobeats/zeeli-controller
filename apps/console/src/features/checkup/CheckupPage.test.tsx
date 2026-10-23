import { screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage } from '../../test/render.tsx';
import CheckupPage from './CheckupPage.tsx';

afterEach(() => vi.restoreAllMocks());

test('the demo router’s problems are listed, worst first, with a summary', async () => {
  await renderPage(<CheckupPage />);
  const items = await screen.findAllByRole('listitem');
  expect(items[0]?.textContent).toMatch(/^Problem: WiFi “Zeeli Things” has no password/);
  expect(screen.getByText(/1 problem, \d+ warning/)).toBeTruthy();
  expect(screen.getByText(/printer/)).toBeTruthy();
});

test('Open buttons go to the right page', async () => {
  const user = await renderPage(<CheckupPage />);
  await user.click(await screen.findByRole('button', { name: /^Open DHCP: / }));
  expect(location.hash).toBe('#dhcp');
});

test('a fix asks first, then calls the API and says so', async () => {
  vi.spyOn(api.networks, 'list').mockResolvedValue([]);
  vi.spyOn(api.wifiNetworks, 'overview').mockRejectedValue(new Error('no agent'));
  vi.spyOn(api.security.wanAccess, 'get').mockResolvedValue({
    enable_https: false,
    enable_ssh: true,
    enable_ping: false,
    enable_whitelist: false,
    whitelist: [],
  });
  const set = vi.spyOn(api.security.wanAccess, 'set').mockResolvedValue(undefined as never);
  const user = await renderPage(<CheckupPage />);
  await user.click(await screen.findByRole('button', { name: /^Turn off remote SSH: / }));
  expect(set).not.toHaveBeenCalled();
  await user.click((await confirmDialog()).getByRole('button', { name: 'Turn off remote SSH' }));
  await waitFor(() => expect(set).toHaveBeenCalledWith({ enable_ssh: false }, 'Remote access'));
  await expectToast('Remote SSH is off');
});

test('cancelling the confirm changes nothing', async () => {
  vi.spyOn(api.security.wanAccess, 'get').mockResolvedValue({
    enable_https: false,
    enable_ssh: true,
    enable_ping: false,
    enable_whitelist: false,
    whitelist: [],
  });
  const set = vi.spyOn(api.security.wanAccess, 'set');
  const user = await renderPage(<CheckupPage />);
  await user.click(await screen.findByRole('button', { name: /^Turn off remote SSH: / }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Cancel' }));
  expect(set).not.toHaveBeenCalled();
});

test('with nothing wrong it says all good, and names what it could not check', async () => {
  vi.spyOn(api.networks, 'list').mockResolvedValue([]);
  vi.spyOn(api.wifiNetworks, 'overview').mockRejectedValue(new Error('no agent'));
  vi.spyOn(api.security.wanAccess, 'get').mockResolvedValue({
    enable_https: false,
    enable_ssh: false,
    enable_ping: false,
    enable_whitelist: false,
    whitelist: [],
  });
  vi.spyOn(api.dns.adguard, 'get').mockResolvedValue({ enabled: false, dns_enabled: false });
  vi.spyOn(api.device, 'firmware').mockResolvedValue({ current: '4.10.1', currentType: 'release', built: '', available: null, notes: '' });
  await renderPage(<CheckupPage />);
  expect(await screen.findByText('All good. Nothing needs your attention.')).toBeTruthy();
  expect(screen.getByText(/Not checked/).textContent).toMatch(/wifi security/);
});
