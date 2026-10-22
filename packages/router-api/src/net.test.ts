import { expect, test } from 'vitest';
import { inSubnet, isIpv4, isMac, maskToPrefix, parseRoute, prefixToMask } from './net.ts';

test('netmasks', () => {
  expect(prefixToMask(24)).toBe('255.255.255.0');
  expect(prefixToMask(20)).toBe('255.255.240.0');
  expect(prefixToMask(0)).toBe('0.0.0.0');
  expect(prefixToMask(32)).toBe('255.255.255.255');
  expect(maskToPrefix('255.255.252.0')).toBe(22);
});

test('address checks', () => {
  expect(isIpv4('192.168.8.1')).toBe(true);
  expect(isIpv4('192.168.8.256')).toBe(false);
  expect(isMac('02:5E:E1:00:00:01')).toBe(true);
  expect(isMac('02:5E:E1:00:00')).toBe(false);
  expect(inSubnet('10.20.0.77', '10.20.0.1', '255.255.255.0')).toBe(true);
  expect(inSubnet('10.21.0.77', '10.20.0.1', '255.255.255.0')).toBe(false);
});

test('routes', () => {
  expect(parseRoute('default via 192.168.1.254 dev wan proto static src 192.168.1.2 metric 20')).toEqual({
    type: 'unicast',
    dst: 'default',
    gateway: '192.168.1.254',
    dev: 'wan',
    proto: 'static',
    src: '192.168.1.2',
    metric: 20,
  });
  expect(parseRoute('local 192.168.8.1 dev br-lan table local proto kernel scope host src 192.168.8.1')?.table).toBe('local');
  expect(parseRoute('100.64.0.0/10 dev tailscale0 table 52')?.dst).toBe('100.64.0.0/10');
  expect(parseRoute('   ')).toBeNull();
});
