import { expect, test } from 'vitest';
import {
  type Cidr,
  cidrOf,
  cidrText,
  hostCount,
  inSubnet,
  ipToInt,
  isIpv4,
  isMac,
  lastHost,
  maskToPrefix,
  nthAddress,
  overlaps,
  parseCidr,
  parseRoute,
  prefixToMask,
} from './net.ts';

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

test('subnet helpers find networks, overlaps and their addresses', () => {
  const lab = cidrOf('10.0.30.1', '255.255.255.0');
  expect(cidrText(lab)).toBe('10.0.30.0/24');
  expect(overlaps(lab, parseCidr('10.0.0.0/16') as Cidr)).toBe(true);
  expect(overlaps(lab, parseCidr('10.0.31.0/24') as Cidr)).toBe(false);
  expect(overlaps(parseCidr('100.64.0.0/10') as Cidr, parseCidr('100.95.118.113') as Cidr)).toBe(true);
  expect(parseCidr('10.0.0.0/33')).toBeNull();
  expect(hostCount(24)).toBe(254);
  expect(nthAddress(lab, 6)).toBe('10.0.30.6');
  expect(lastHost(lab)).toBe('10.0.30.254');
  expect(lastHost(parseCidr('192.168.8.0/22') as Cidr)).toBe('192.168.11.254');
});

test('addresses compare as numbers', () => {
  expect(ipToInt('10.0.0.2') > ipToInt('10.0.0.1')).toBe(true);
  expect(ipToInt('10.0.1.0') > ipToInt('10.0.0.255')).toBe(true);
});
