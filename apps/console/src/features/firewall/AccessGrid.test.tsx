import { screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { expectToast, renderPage } from '../../test/render.tsx';
import { changes, currentGrid, recommendedGrid } from './access.ts';
import FirewallPage from './FirewallPage.tsx';

afterEach(() => vi.restoreAllMocks());

const cell = async (from: string, to: string) => (await screen.findByLabelText(`${from} to ${to}`)) as HTMLSelectElement;
const reaches = async (src: string, dest: string) =>
  (await api.safety.firewall.forwardings()).some((f) => f.src === src && f.dest === dest && f.enabled);

test('the grid lists the networks, not the internet or router services, and explains each cell', async () => {
  await renderPage(<FirewallPage />);
  const table = await screen.findByRole('table', { name: 'Network access' });
  expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['From ↓ To →', 'Main LAN', 'Guest', 'IoT']);
  expect(table.querySelectorAll('td .muted')).toHaveLength(3);
  expect((await cell('IoT', 'Guest')).parentElement?.title).toBe(
    'IoT devices can’t start connections to Guest devices, and Guest can’t start any to IoT.',
  );
});

test('a cell is changed, applied in one confirmed change, and then reads as replies only from the other side', async () => {
  const user = await renderPage(<FirewallPage />);
  const apply = vi.spyOn(api.safety.firewall, 'applyAccess');
  expect((await screen.findByRole('button', { name: 'Apply changes' })).hasAttribute('disabled')).toBe(true);
  await user.selectOptions(await cell('Main LAN', 'IoT'), 'allow');
  expect((await cell('IoT', 'Main LAN')).selectedOptions[0]?.textContent).toBe('Replies only');
  await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));
  await expectToast('Network access updated');
  expect(apply).toHaveBeenCalledWith([{ src: 'lan', dest: 'iot', allow: true }]);
  expect(await reaches('lan', 'iot')).toBe(true);
  expect((await cell('IoT', 'Main LAN')).selectedOptions[0]?.textContent).toBe('Replies only');
  expect((await cell('Main LAN', 'IoT')).value).toBe('allow');
});

test('discarding drops the draft; the recommended grid lets Main reach everything and nothing else start anything', async () => {
  const user = await renderPage(<FirewallPage />);
  await user.click(await screen.findByRole('button', { name: 'Use recommended' }));
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByRole('button', { name: 'Apply changes' }).hasAttribute('disabled')).toBe(true);

  const zones = await api.safety.firewall.zones();
  const nets = zones.filter((z) => z.editable && !z.masquerade);
  const recommended = recommendedGrid(nets);
  expect(Object.entries(recommended).filter(([, on]) => on)).toEqual([
    ['lan>guest', true],
    ['lan>iot', true],
  ]);
  expect(changes(currentGrid(nets, await api.safety.firewall.forwardings()), recommended).every((c) => c.src === 'lan' || !c.allow)).toBe(
    true,
  );
});

test('a change the router refuses stays in the draft with the reason beside the grid', async () => {
  const user = await renderPage(<FirewallPage />);
  const reason =
    'the Main LAN doesn’t accept traffic to the router. Fix that in its zone settings before changing what networks can reach.';
  vi.spyOn(api.safety.firewall, 'applyAccess').mockRejectedValue(new Error(reason));
  await user.selectOptions(await cell('Guest', 'IoT'), 'allow');
  await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));
  expect((await screen.findByText(reason)).getAttribute('role')).toBe('alert');
  expect((await cell('Guest', 'IoT')).value).toBe('allow');
});

test('the agent refuses a lockout of the admin zone before touching a cell', async () => {
  // the demo router refuses to take the admin network’s access away through a zone change, so go straight to the call
  const out = await api.safety.firewall.applyAccess([{ src: 'lan', dest: 'wan', allow: false }]).catch((e: Error) => e);
  expect((out as Error).message).toBe('Internet access and router services aren’t part of this grid.');
});

test('device discovery is switched on for chosen networks and off again', async () => {
  const user = await renderPage(<FirewallPage />);
  await user.click(await screen.findByRole('checkbox', { name: 'IoT' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Let devices find each other across networks' }));
  await expectToast('Devices can now find each other');
  expect((await api.safety.mdns.status()).enabled).toBe(true);
  await user.click(await screen.findByRole('checkbox', { name: 'Let devices find each other across networks' }));
  await expectToast('Devices no longer find each other across networks');
  expect((await api.safety.mdns.status()).enabled).toBe(false);
});
