import { expect, test } from 'vitest';
import { checkForwardPorts } from './forward.ts';

test('single ports and equal ranges pass', () => {
  expect(() => checkForwardPorts('443', '8443')).not.toThrow();
  expect(() => checkForwardPorts('8000-8010', '9000-9010')).not.toThrow();
  // a range may land on one port
  expect(() => checkForwardPorts('8000-8010', '80')).not.toThrow();
});

test('bad ports are refused', () => {
  expect(() => checkForwardPorts('0', '80')).toThrow('Ports must be 1 to 65535');
  expect(() => checkForwardPorts('80', '70000')).toThrow('Ports must be 1 to 65535');
  expect(() => checkForwardPorts('http', '80')).toThrow('Ports must be 1 to 65535');
});

test('ranges must line up', () => {
  expect(() => checkForwardPorts('8000-8010', '9000-9005')).toThrow('Both port ranges must be the same size.');
  expect(() => checkForwardPorts('8000', '9000-9005')).toThrow('A single outside port can’t go to a range.');
});
