import type { Network } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { formValues, toNetworkInput } from './form.ts';

const fresh = { ...formValues(null), label: 'Cameras', ip: '10.0.30.1', vlanId: '30', dhcpStart: '10.0.30.100', dhcpEnd: '10.0.30.200' };

test('a new VLAN network becomes router input', () => {
  expect(toNetworkInput(fresh, null)).toMatchObject({ label: 'Cameras', vlanId: 30, dns: [] });
});

test('bad input is explained', () => {
  expect(() => toNetworkInput({ ...fresh, ip: '10.0.30' }, null)).toThrow(/Gateway IP/);
  expect(() => toNetworkInput({ ...fresh, vlanId: '1' }, null)).toThrow(/VLAN ID/);
  expect(() => toNetworkInput({ ...fresh, label: ' ' }, null)).toThrow(/name/);
  expect(() => toNetworkInput({ ...fresh, dhcpEnd: '' }, null)).toThrow(/DHCP/);
});

test('the main network carries no VLAN ID', () => {
  const main = { id: 'main', fixed: true, dns: [] } as unknown as Network;
  expect(toNetworkInput({ ...fresh, vlanId: '' }, main).vlanId).toBeNull();
});

test('an existing network fills the form, with blanks where the firmware sent nothing', () => {
  const guest = { id: 'guest', label: 'Guest', ip: '192.168.9.1', vlanId: 9, dns: ['1.1.1.1'], leaseTime: undefined } as unknown as Network;
  expect(formValues(guest)).toMatchObject({ label: 'Guest', ip: '192.168.9.1', vlanId: '9', dns1: '1.1.1.1', dns2: '', leaseTime: '12h' });
  expect(formValues(null)).toMatchObject({ netmask: '255.255.255.0', dhcp: true, enabled: true });
});
