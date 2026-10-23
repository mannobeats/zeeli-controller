import type { MeshMember, PortLink } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { meshGraph, NODE, portOf, routerPorts } from './extras.ts';

const member = (over: Partial<MeshMember>): MeshMember => ({
  mac: 'AA:00:00:00:00:01',
  name: 'Hall',
  model: 'GL-MT6000',
  ip: '192.168.8.2',
  self: false,
  online: true,
  backhaul: 'wired',
  band: null,
  signal: null,
  clients: 2,
  uptime: 100,
  ...over,
});
const port = (over: Partial<PortLink>): PortLink => ({
  name: 'secondwan',
  label: 'LAN1',
  role: 'lan',
  kind: 'switch',
  link: true,
  speedMbps: 2500,
  duplex: 'full',
  devices: [],
  ...over,
});
const router = { x: 520, y: 100, height: 70 };

test('mesh nodes stack under the router, each with one wire from it', () => {
  const g = meshGraph(router, [
    member({}),
    member({ mac: 'AA:00:00:00:00:02', name: 'Loft', backhaul: 'wireless', signal: -61, online: false }),
  ]);
  expect(g.nodes.map((n) => [n.id, n.position])).toEqual([
    ['mesh-AA:00:00:00:00:01', { x: 520, y: 100 + 70 + 90 - NODE.height }],
    ['mesh-AA:00:00:00:00:02', { x: 520, y: 100 + 70 + 90 - NODE.height + NODE.height + 12 }],
  ]);
  expect(g.edges.map((e) => [e.source, e.sourceHandle, e.target])).toEqual(g.nodes.map((n) => ['router', 'below', n.id]));
  expect(g.nodes.map((n) => n.data.sub)).toEqual(['Wired · 2 clients', 'Offline · 2 clients']);
  // an offline node's wire is dashed, not live
  expect(g.edges[1]?.className).toBe('topo-edge offline');
});

test('this router is left out of the mesh', () => {
  expect(meshGraph(router, [member({ self: true })])).toEqual({ nodes: [], edges: [] });
});

test('every port shows in the router card, lit when a cable is in', () => {
  expect(
    routerPorts([
      port({ name: 'wan', label: 'WAN', role: 'wan' }),
      port({ devices: [{ mac: 'BB:00:00:00:00:01', inferred: true }] }),
      port({ name: 'lan2', label: 'LAN2', link: false }),
    ]),
  ).toEqual([
    { label: 'WAN', up: true, detail: 'Internet · 2.5 Gb/s' },
    { label: 'LAN1', up: true, detail: '2.5 Gb/s · 1 device' },
    { label: 'LAN2', up: false, detail: 'No cable' },
  ]);
});

test('wired devices behind a LAN port are named by it, instead of getting a wire', () => {
  const map = portOf([
    port({ devices: [{ mac: 'BB:00:00:00:00:01', inferred: true }] }),
    port({ name: 'wan', label: 'WAN', role: 'wan', devices: [{ mac: 'CC:00:00:00:00:01', inferred: false }] }),
  ]);
  expect([...map]).toEqual([['BB:00:00:00:00:01', 'LAN1']]);
});
