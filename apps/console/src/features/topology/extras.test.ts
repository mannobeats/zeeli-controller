import type { MeshMember, PortLink } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { extraGraph, NODE } from './extras.ts';

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
const origin = { x: 520, y: 100 };
const none = new Set<string>();

test('mesh nodes hang under the uplink, ports under the router, each wired to the router', () => {
  const g = extraGraph(origin, {
    mesh: [member({}), member({ mac: 'AA:00:00:00:00:02', name: 'Loft', backhaul: 'wireless', signal: -61, online: false })],
    ports: [port({}), port({ name: 'lan4', label: 'LAN4', speedMbps: 100 })],
    deviceIds: none,
  });
  expect(g.nodes.map((n) => [n.id, n.position])).toEqual([
    ['mesh-AA:00:00:00:00:01', { x: 260, y: 190 }],
    ['mesh-AA:00:00:00:00:02', { x: 260, y: 190 + NODE.height + 12 }],
    ['port-secondwan', { x: 520, y: 190 }],
    ['port-lan4', { x: 520, y: 190 + NODE.height + 12 }],
  ]);
  expect(g.edges.map((e) => [e.source, e.sourceHandle, e.target])).toEqual(g.nodes.map((n) => ['router', 'below', n.id]));
  expect(g.nodes.map((n) => n.data.sub)).toEqual(['Wired · 2 clients', 'Offline · 2 clients', '2.5 Gb/s', '100 Mb/s']);
  // an offline node's wire is dashed, not live
  expect(g.edges[1]?.className).toBe('topo-edge offline');
});

test('this router, and ports without a cable, are left out', () => {
  const g = extraGraph(origin, { mesh: [member({ self: true })], ports: [port({ link: false }), port({ link: null })], deviceIds: none });
  expect(g.nodes).toEqual([]);
  expect(g.edges).toEqual([]);
});

test('a wired device known to sit behind a port gets a wire from it, if it is on the map', () => {
  const g = extraGraph(origin, {
    mesh: [],
    ports: [
      port({
        devices: [
          { mac: 'BB:00:00:00:00:01', inferred: true },
          { mac: 'BB:00:00:00:00:02', inferred: true },
        ],
      }),
    ],
    deviceIds: new Set(['dev-BB:00:00:00:00:01']),
  });
  expect(g.nodes[0]?.data.sub).toBe('2.5 Gb/s · 2 devices');
  expect(g.edges.map((e) => [e.source, e.target])).toEqual([
    ['router', 'port-secondwan'],
    ['port-secondwan', 'dev-BB:00:00:00:00:01'],
  ]);
});

test('the internet port says so', () => {
  const g = extraGraph(origin, { mesh: [], ports: [port({ name: 'wan', label: 'WAN', role: 'wan' })], deviceIds: none });
  expect(g.nodes[0]?.data.sub).toBe('Internet · 2.5 Gb/s');
});
