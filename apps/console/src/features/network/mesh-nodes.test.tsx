import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { api } from '../../api/router.ts';
import { confirmDialog, expectToast, renderPage, sheet } from '../../test/render.tsx';
import { MeshPage } from './pages.tsx';

const nodesTable = async () => within(await screen.findByRole('table', { name: 'Mesh nodes' }));
const nodes = () => api.networkExtras.mesh.nodes();

test('mesh nodes list how they connect, once mesh is on', async () => {
  await api.networkExtras.mesh.config.set({ enabled: true, mode: 'controller' });
  await renderPage(<MeshPage />);
  const t = await nodesTable();
  const up = (await t.findByText('Upstairs', { selector: '.name' })).closest('tr') as HTMLElement;
  expect(within(up).getByText('GL-MT6000')).toBeTruthy();
  expect(within(up).getByText('Online')).toBeTruthy();
  expect(within(up).getByText('192.168.8.2')).toBeTruthy();
  expect(within(up).getByText(/WiFi 5 GHz/)).toBeTruthy();
  expect(within(up).getByText(/−57 dBm, good/)).toBeTruthy();
  expect(within(up).getByText('6')).toBeTruthy();
  expect(within(up).getByText('3d 0h')).toBeTruthy();
  const garage = t.getByText('Garage', { selector: '.name' }).closest('tr') as HTMLElement;
  expect(within(garage).getByText('Wired')).toBeTruthy();
  // this router is the controller, not a node
  expect(t.queryByText('Zeeli-Demo')).toBeNull();
});

test('a node is renamed, rebooted and removed', async () => {
  const user = await renderPage(<MeshPage />);
  await user.click(await (await nodesTable()).findByText('Garage', { selector: '.name' }));
  const s = await sheet();
  await user.clear(s.getByLabelText('Name'));
  await user.click(s.getByRole('button', { name: 'Save' }));
  expect((await s.findByRole('alert')).textContent).toBe('Give the node a name.');
  await user.type(s.getByLabelText('Name'), 'Workshop');
  await user.click(s.getByRole('button', { name: 'Save' }));
  await expectToast('Renamed to Workshop');
  expect((await nodes()).some((n) => n.name === 'Workshop')).toBe(true);

  await user.click(await screen.findByRole('button', { name: 'Reboot Workshop' }));
  await user.click((await confirmDialog()).getByRole('button', { name: 'Reboot' }));
  await expectToast('Workshop is rebooting');

  await user.click(await screen.findByRole('button', { name: 'Remove Workshop' }));
  expect((await confirmDialog()).getByText(/It stops extending your WiFi/)).toBeTruthy();
  await user.click((await confirmDialog()).getByRole('button', { name: 'Remove' }));
  await expectToast('Removed Workshop');
  expect((await nodes()).some((n) => n.name === 'Workshop')).toBe(false);
});

test('with every node gone the page says how to add one', async () => {
  const left = (await nodes()).filter((n) => !n.self);
  await api.networkExtras.mesh.remove(left.map((n) => n.mac));
  await renderPage(<MeshPage />);
  expect(await screen.findByText(/No nodes yet/)).toBeTruthy();
  await api.networkExtras.mesh.config.set({ enabled: false });
});
