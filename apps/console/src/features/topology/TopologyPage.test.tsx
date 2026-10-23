import { fireEvent, screen } from '@testing-library/react';
import type { Client } from '@zeeli/router-api';
import { expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { renderPage } from '../../test/render.tsx';
import TopologyPage from './TopologyPage.tsx';

const search = () => screen.getByRole('searchbox', { name: 'Find a device on the map' });
const nodeOf = (name: string) => screen.getByText(name).closest('.react-flow__node') as HTMLElement;

async function split() {
  const list = await api.clients.list();
  return { on: list.find((c) => c.online) as Client, off: list.find((c) => !c.online) as Client };
}

test('offline devices show only when asked', async () => {
  const { on, off } = await split();
  const user = await renderPage(<TopologyPage />);
  await screen.findByText(on.name);
  expect(screen.queryByText(off.name)).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: 'Show offline' }));
  expect(await screen.findByText(off.name)).toBeTruthy();
});

test('finding a device lights its path and Fit clears it', async () => {
  const { on } = await split();
  const user = await renderPage(<TopologyPage />);
  await screen.findByText(on.name);
  await user.type(search(), on.name);
  expect(nodeOf(on.name).classList).toContain('lit');
  expect(nodeOf('Internet').classList).toContain('lit');
  await user.click(screen.getByRole('button', { name: 'Fit' }));
  expect((search() as HTMLInputElement).value).toBe('');
  expect(nodeOf(on.name).classList).not.toContain('lit');
});

test('a search with no match leaves the map alone', async () => {
  const { on } = await split();
  const user = await renderPage(<TopologyPage />);
  await screen.findByText(on.name);
  await user.type(search(), 'zz-nothing');
  expect(nodeOf(on.name).classList).not.toContain('dim');
});

// a plain click: d3-zoom's mousedown handler needs a `view` that user-event's pointer events don't carry
test('clicking a node focuses it, clicking again lets go', async () => {
  const { on } = await split();
  await renderPage(<TopologyPage />);
  fireEvent.click(await screen.findByText(on.name));
  expect(nodeOf(on.name).classList).toContain('lit');
  fireEvent.click(screen.getByText(on.name));
  expect(nodeOf(on.name).classList).not.toContain('lit');
});

test('mesh nodes and the ports with a cable join the map', async () => {
  await api.networkExtras.mesh.config.set({ enabled: true, mode: 'controller' });
  await renderPage(<TopologyPage />);
  expect(await screen.findByText('Upstairs')).toBeTruthy();
  expect(await screen.findByText('WiFi · -57 dBm · 6 clients')).toBeTruthy();
  expect(await screen.findByText('Wired · 3 clients')).toBeTruthy();
  expect(await screen.findByText('LAN1')).toBeTruthy();
  expect(screen.getAllByText('1 Gb/s')).toHaveLength(2);
  expect(screen.getByText('Internet · 2.5 Gb/s')).toBeTruthy();
  expect(screen.queryByText('LAN2')).toBeNull();
  await api.networkExtras.mesh.config.set({ enabled: false });
});

test('without the agent or mesh the map is just clients and networks', async () => {
  vi.spyOn(api.agent, 'version').mockResolvedValue(null);
  const { on } = await split();
  await renderPage(<TopologyPage />);
  await screen.findByText(on.name);
  expect(screen.queryByText('LAN1')).toBeNull();
  expect(screen.queryByText('Upstairs')).toBeNull();
  vi.restoreAllMocks();
});
