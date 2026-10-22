import { expect, test } from 'vitest';
import { bytes, connectedFor, duration, plural, rateText, signal } from './format.ts';

test('format', () => {
  expect(rateText(0)).toBe('0 bps');
  expect(rateText(5304)).toBe('42.4 Kbps');
  expect(rateText(31_250_000)).toBe('250 Mbps');
  expect(bytes('18199244597')).toBe('18.2 GB');
  expect(duration(1_632_263.49)).toBe('18d 21h');
  expect(connectedFor('19h,46m,18s')).toBe('19h 46m');
  expect(signal(-56)).toEqual({ word: 'good', weak: false });
  expect(signal(-64).weak).toBe(true);
  expect(plural(1, 'device')).toBe('1 device');
  expect(plural(3, 'device')).toBe('3 devices');
});
