import { expect, test } from 'vitest';
import { sameValue } from './settings.ts';

test('kept values compare by meaning', () => {
  expect(sameValue(100, '100')).toBe(true);
  expect(sameValue(true, 1)).toBe(true);
  expect(sameValue(false, 0)).toBe(true);
  expect(sameValue('month', 'week')).toBe(false);
  expect(sameValue([1, 2], [1, 2])).toBe(true);
  expect(sameValue([1, 2], [2, 1])).toBe(false);
  expect(sameValue('x', undefined)).toBe(true);
  expect(sameValue({ a: 1 }, { a: '1', b: 2 })).toBe(true);
});
