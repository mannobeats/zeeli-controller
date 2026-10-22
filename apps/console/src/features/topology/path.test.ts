import { expect, test } from 'vitest';
import { absolute, litPath } from './path.ts';

const at = (x: number, y: number) => ({ x, y });
const nodes = [
  { id: 'internet', position: at(0, 0) },
  { id: 'router', position: at(500, 0) },
  { id: 'net-main', position: at(700, 100) },
  { id: 'net-guest', position: at(700, 400) },
  { id: 'dev-a', type: 'device', parentId: 'net-main', position: at(16, 52) },
];
const edges = [
  { id: 'e-i-r', source: 'internet', target: 'router' },
  { id: 'e-r-main', source: 'router', target: 'net-main' },
  { id: 'e-r-guest', source: 'router', target: 'net-guest' },
];

test('a device lights its network, the router and the way out', () => {
  expect([...litPath(nodes, edges, 'dev-a')].sort()).toEqual(['dev-a', 'e-i-r', 'e-r-main', 'internet', 'net-main', 'router'].sort());
});

test('the internet node lights only itself', () => {
  expect([...litPath(nodes, edges, 'internet')]).toEqual(['internet']);
});

test('device positions are made absolute through their network box', () => {
  expect(absolute(nodes, nodes[4] as (typeof nodes)[number])).toEqual({ x: 716, y: 152 });
  expect(absolute(nodes, nodes[1] as (typeof nodes)[number])).toEqual({ x: 500, y: 0 });
});
