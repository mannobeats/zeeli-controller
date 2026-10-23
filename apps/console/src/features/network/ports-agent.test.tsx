import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import { PortsPage } from './pages.tsx';

afterEach(() => vi.restoreAllMocks());

const details = async () => within(await screen.findByRole('table', { name: 'Port details' }));
const profiles = async () => within(await screen.findByRole('table', { name: 'Port profiles' }));
const portNamed = async (name: string) => (await api.internet.ports()).find((p) => p.name === name);

test('each port shows its link, speed, role and networks', async () => {
  await renderPage(<PortsPage />);
  const t = await details();
  const lan1 = (await t.findByText('LAN1', { selector: '.name' })).closest('tr') as HTMLElement;
  expect(within(lan1).getByText('Connected')).toBeTruthy();
  expect(within(lan1).getByText('1 Gb/s')).toBeTruthy();
  expect(within(lan1).getByText(/full duplex/)).toBeTruthy();
  expect(within(lan1).getByText('LAN')).toBeTruthy();
  expect(within(lan1).getByText('Main LAN')).toBeTruthy();
  const lan2 = t.getByText('LAN2', { selector: '.name' }).closest('tr') as HTMLElement;
  expect(within(lan2).getByText('No cable')).toBeTruthy();
  const lan4 = t.getByText('LAN4', { selector: '.name' }).closest('tr') as HTMLElement;
  expect(within(lan4).getByText(/\+ .* tagged/)).toBeTruthy();
  expect(within(t.getByText('WAN', { selector: '.name' }).closest('tr') as HTMLElement).getByText('2.5 Gb/s')).toBeTruthy();
});

test('wired devices that the switch can’t place are said to be on the switch, not guessed', async () => {
  await renderPage(<PortsPage />);
  expect(await screen.findByText(/sit behind the LAN switch/)).toBeTruthy();
});

test('a device on the only cabled port is named under it', async () => {
  const real = await api.safety.ports.status();
  const mac = (await api.clients.list()).find((c) => c.name === 'Studio-Mac')?.mac as string;
  vi.spyOn(api.safety.ports, 'status').mockResolvedValue({
    unattributed: [],
    ports: real.ports.map((p) => (p.name === 'secondwan' ? { ...p, devices: [{ mac, inferred: true }] } : p)),
  });
  await renderPage(<PortsPage />);
  const lan1 = (await (await details()).findByText('LAN1', { selector: '.name' })).closest('tr') as HTMLElement;
  expect(await within(lan1).findByText('Studio-Mac (the only cable on this switch)')).toBeTruthy();
  expect(screen.queryByText(/sit behind the LAN switch/)).toBeNull();
});

test('profiles are created, edited and deleted', async () => {
  const user = await renderPage(<PortsPage />);
  expect(await (await profiles()).findByText('Camera port')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'New profile' }));
  let s = await sheet();
  await user.click(s.getByRole('button', { name: 'Add profile' }));
  expect((await s.findByRole('alert')).textContent).toBe('Give the profile a name.');
  await user.type(s.getByLabelText('Name'), 'camera port');
  await user.click(s.getByRole('button', { name: 'Add profile' }));
  expect((await s.findByRole('alert')).textContent).toBe('A profile called camera port already exists.');
  await user.clear(s.getByLabelText('Name'));
  await user.type(s.getByLabelText('Name'), 'Access point');
  await user.click(within(s.getByRole('group', { name: 'Tagged networks' })).getByLabelText('Guest'));
  await user.click(s.getByRole('button', { name: 'Add profile' }));
  await expectToast('Added Access point');
  expect((await api.safety.ports.profiles()).find((p) => p.name === 'Access point')).toMatchObject({ untagged: 'main', tagged: ['guest'] });

  await user.click((await profiles()).getByText('Access point'));
  s = await sheet();
  await user.selectOptions(s.getByLabelText('Untagged network'), 'iot');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Saved Access point');
  expect((await api.safety.ports.profiles()).find((p) => p.name === 'Access point')).toMatchObject({ untagged: 'iot' });

  await user.click(await screen.findByRole('button', { name: 'Delete Access point' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Delete' }));
  await expectToast('Deleted Access point');
  expect((await api.safety.ports.profiles()).some((p) => p.name === 'Access point')).toBe(false);
});

test('a profile goes onto ports through GL’s own port settings', async () => {
  const user = await renderPage(<PortsPage />);
  await user.click(await screen.findByRole('button', { name: 'Apply Lab trunk' }));
  let s = await sheet();
  await user.click(s.getByRole('button', { name: 'Apply' }));
  expect((await s.findByRole('alert')).textContent).toBe('Pick at least one port.');
  await user.click(s.getByLabelText('LAN2'));
  await user.click(s.getByRole('button', { name: 'Apply' }));
  // cancelling the confirm leaves the sheet and the port alone
  await user.click((await confirmDialog()).getByRole('button', { name: 'Cancel' }));
  expect(await portNamed('lan2')).toMatchObject({ vlanMode: 'Standard', tagged: [] });

  s = await sheet();
  await user.click(s.getByRole('button', { name: 'Apply' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Apply' }));
  await expectToast('Lab trunk is on LAN2');
  expect(await portNamed('lan2')).toMatchObject({ vlanMode: 'Multiple VLANs', untagged: 1, tagged: [9, 10] });
  // the existing table reads the same settings
  await waitFor(async () =>
    expect(await within(await screen.findByRole('table', { name: 'Ethernet ports' })).findAllByText(/tagged/)).not.toHaveLength(0),
  );
});

test('a profile with only an untagged network sets the port to carry just that', async () => {
  const user = await renderPage(<PortsPage />);
  await user.click(await screen.findByRole('button', { name: 'Apply Camera port' }));
  const s = await sheet();
  await user.click(s.getByLabelText('LAN3'));
  await user.click(s.getByRole('button', { name: 'Apply' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Apply' }));
  await expectToast('Camera port is on LAN3');
  expect(await portNamed('lan3')).toMatchObject({ vlanMode: 'Standard', untagged: 10, tagged: [] });
});

test('without the agent the page is the one it always was', async () => {
  vi.spyOn(api.agent, 'version').mockResolvedValue(null);
  await renderPage(<PortsPage />);
  expect(await screen.findByRole('table', { name: 'Ethernet ports' })).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Port details' })).toBeNull();
  expect(screen.queryByText('Port profiles')).toBeNull();
});
