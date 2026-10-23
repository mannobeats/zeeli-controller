import { expect, test } from 'vitest';
import { qrPath, wifiQrText } from './wifi-qr.ts';

test('writes the join text, escaping \\ ; , : and "', () => {
  expect(wifiQrText('Home', 'secret-pass')).toBe('WIFI:T:WPA;S:Home;P:secret-pass;;');
  expect(wifiQrText('a;b,c:d', 'p"q\\r')).toBe('WIFI:T:WPA;S:a\\;b\\,c\\:d;P:p\\"q\\\\r;;');
  expect(wifiQrText('Hidden', 'secret-pass', true)).toBe('WIFI:T:WPA;S:Hidden;P:secret-pass;H:true;;');
});

test('draws a square code with the three finder corners', () => {
  const { d, size } = qrPath(wifiQrText('Guest', 'maple-river-cobalt-tiger-482'));
  // version 3 to 5 is 29 to 37 modules, plus a 2 module quiet zone each side
  expect(size).toBeGreaterThanOrEqual(33);
  expect(size).toBeLessThanOrEqual(41);
  const dark = new Set(d.match(/M\d+ \d+/g));
  // a finder pattern's outer ring is dark in three corners, not the fourth
  for (const at of ['M2 2', 'M8 2', 'M2 8', `M${size - 3} 2`, `M2 ${size - 3}`]) expect(dark.has(at)).toBe(true);
  expect(dark.has(`M${size - 3} ${size - 3}`)).toBe(false);
});
