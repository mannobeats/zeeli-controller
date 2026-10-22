import { expect, test } from 'vitest';
import { parseActivity } from './activity.ts';

const LOG = [
  'Thu Oct 22 18:40:00 2026 daemon.info hostapd: wlan1: AP-STA-CONNECTED 02:5e:e1:00:00:aa',
  'Thu Oct 22 18:40:01 2026 daemon.info dnsmasq-dhcp[1234]: DHCPACK(br-lan) 192.168.8.41 02:5e:e1:00:00:aa Maya-iPhone',
  "Thu Oct 22 18:41:00 2026 authpriv.warn dropbear[99]: Bad password attempt for 'root' from 203.0.113.7:5000",
  "Thu Oct 22 18:41:05 2026 authpriv.warn dropbear[99]: Bad password attempt for 'root' from 203.0.113.7:5001",
  "Thu Oct 22 18:42:00 2026 daemon.notice netifd: Interface 'wan' is now down",
  'Thu Oct 22 18:42:01 2026 kern.info kernel: [123.4] something unrelated',
].join('\n');

test('log lines become events, newest first, with repeats folded', () => {
  const events = parseActivity(LOG);
  expect(events.map((e) => e.kind)).toEqual(['uplink.down', 'admin.failed', 'device.address', 'device.joined']);
  expect(events[1]?.count).toBe(2);
  expect(events[2]?.detail).toBe('Got 192.168.8.41 as Maya-iPhone');
  expect(events[3]?.subject).toBe('02:5E:E1:00:00:AA');
});
