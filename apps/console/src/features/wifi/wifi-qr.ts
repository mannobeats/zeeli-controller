import { encode } from 'uqr';

/** Backslash-escape what the WIFI: format treats as syntax. */
const esc = (s: string) => s.replace(/[\\;,:"]/g, '\\$&');

/** What phone cameras read to join a network: `WIFI:T:WPA;S:name;P:key;;`. WPA covers WPA2 and WPA3. */
export const wifiQrText = (ssid: string, password: string, hidden = false) =>
  `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};${hidden ? 'H:true;' : ''};`;

/** The QR code for `text` as one SVG path (one square per dark module) and its size in modules, ECC level M. */
export function qrPath(text: string): { d: string; size: number } {
  const rows = encode(text, { ecc: 'M', border: 2 }).data;
  const d = rows.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join('');
  return { d, size: rows.length };
}
