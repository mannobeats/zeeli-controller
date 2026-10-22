import type { Tunnel } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { nextTunnelName, tunnelFrom, tunnelTo } from './tunnel.ts';

const named = (...names: string[]) => names.map((name) => ({ name }) as Tunnel);

test('a new tunnel takes the first free number', () => {
  expect(nextTunnelName([])).toBe('Tunnel 1');
  expect(nextTunnelName(named('Tunnel 1', 'Tunnel 3', 'Work'))).toBe('Tunnel 2');
});

test('who a tunnel covers', () => {
  expect(tunnelFrom('default', ['A'], [])).toEqual({ type: 'default' });
  expect(tunnelFrom('mac', ['A'], [])).toEqual({ type: 'mac', mac_list: ['A'] });
  expect(tunnelFrom('exclude_mac', ['A'], [])).toEqual({ type: 'exclude_mac', exclude_mac_list: ['A'] });
  expect(tunnelFrom('interface', [], ['lan'])).toEqual({ type: 'interface', interface_list: ['lan'] });
});

test('a choice that needs picks refuses an empty list', () => {
  expect(() => tunnelFrom('exclude_mac', [], ['lan'])).toThrow('Pick at least one device.');
  expect(() => tunnelFrom('interface', ['A'], [])).toThrow('Pick at least one network.');
});

test('which sites a tunnel covers', () => {
  expect(tunnelTo('default', 'ignored.com')).toEqual({ type: 'default' });
  expect(tunnelTo('domain', ' netflix.com\n\n hulu.com ')).toEqual({ type: 'domain', manual: true, domain_list: 'netflix.com\nhulu.com' });
  expect(() => tunnelTo('exclude_domain', '  \n')).toThrow('Enter at least one site.');
});
