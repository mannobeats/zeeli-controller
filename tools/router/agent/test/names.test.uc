// zeeli.names: device names as .lan host names, and the hosts file dnsmasq reads.
'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { readfile, unlink } from 'fs';
import { paths } from 'zeeli.common';
import { reset } from 'sandbox';
import * as names from 'zeeli.names';

const api = plugin('names')['zeeli.names'];
const A = '02:00:00:00:00:0A', B = '02:00:00:00:00:0B', C = '02:00:00:00:00:0C';
const hosts = () => readfile(`${paths.state}/hosts-zeeli`);

function fresh() {
	reset();
	unlink(`${paths.state}/hosts-zeeli`);
}

test('slugify makes a DNS label', () => {
	eq(names.slugify('NAS 01'), 'nas-01');
	eq(names.slugify('  Maya’s iPhone (work)! '), 'maya-s-iphone-work');
	eq(names.slugify('---'), '');
	eq(names.slugify('Wohnzimmer Küche'), 'wohnzimmer-k-che');
	eq(length(names.slugify(replace(sprintf('%80s', ''), ' ', 'a'))), 63);
});

test('repeated names get -2, -3 in MAC order, so they stay put', () => {
	const got = names.hostnames([{ mac: C, name: 'Camera' }, { mac: A, name: 'camera' }, { mac: B, name: 'CAMERA!' }, { mac: '02:00:00:00:00:0D', name: '??' }]);
	eq(map(got, (d) => d.host), ['camera', 'camera-2', 'camera-3', '']);
	eq(map(got, (d) => d.mac), [A, B, C, '02:00:00:00:00:0D']);
});

test('a duplicate of a name already taken by a number stays unique', () => {
	const got = names.hostnames([{ mac: A, name: 'tv' }, { mac: B, name: 'tv-2' }, { mac: C, name: 'tv' }]);
	eq(map(got, (d) => d.host), ['tv', 'tv-2', 'tv-3']);
});

test('the hosts file has a line per named device with an address, in the router’s local zone', () => {
	eq(names.zone({ get: () => '/lan/' }), 'lan');
	eq(names.zone({ get: () => 'example.ts.net' }), 'lan');
	eq(names.render([{ mac: A, name: 'NAS 01' }, { mac: B, name: 'Ghost' }], { [A]: '192.168.8.20' }, 'lan'), '# Zeeli: device names\n192.168.8.20 nas-01.lan\n');
	eq(names.render([], {}, 'lan'), '');
});

test('sync stores the names and writes the hosts file', () => {
	fresh();
	const r = api.sync.call({ args: { devices: [{ mac: A, name: ' NAS 01 ', ip: '10.0.10.20' }, { mac: B, name: 'NAS 01', ip: '10.0.10.21' }, { mac: C, name: 'No address' }] } });
	eq(r.devices, [{ mac: A, name: 'NAS 01', host: 'nas-01' }, { mac: B, name: 'NAS 01', host: 'nas-01-2' }, { mac: C, name: 'No address', host: 'no-address' }]);
	eq(hosts(), '# Zeeli: device names\n10.0.10.20 nas-01.lan\n10.0.10.21 nas-01-2.lan\n');
	eq(api.list.call({ args: {} }).devices[0].name, 'NAS 01');
});

test('sync refuses what is not a device list', () => {
	fresh();
	ok(api.sync.call({ args: { devices: [{ mac: 'nope', name: 'x' }] } }).error);
	ok(api.sync.call({ args: { devices: [{ mac: A, name: 'a\nb' }] } }).error);
	eq(hosts(), null);
});

test('refresh moves a name to the device’s new address, and does nothing when nothing changed', () => {
	fresh();
	api.sync.call({ args: { devices: [{ mac: A, name: 'nas', ip: '10.0.10.20' }] } });
	names.refresh([{ mac: A, ip: '10.0.10.55' }]);
	eq(hosts(), '# Zeeli: device names\n10.0.10.55 nas.lan\n');
	eq(names.refresh([{ mac: A, ip: '10.0.10.55' }]), null);
});

test('switching local names off empties the hosts file, and refresh keeps it empty', () => {
	fresh();
	api.sync.call({ args: { devices: [{ mac: A, name: 'nas', ip: '10.0.10.20' }] } });
	eq(api.set_enabled.call({ args: { enabled: false } }).enabled, false);
	eq(hosts(), null);
	names.refresh([{ mac: A, ip: '10.0.10.20' }]);
	eq(hosts(), null);
	ok(api.set_enabled.call({ args: { enabled: 'yes' } }).error);
	api.set_enabled.call({ args: { enabled: true } });
	names.refresh([{ mac: A, ip: '10.0.10.20' }]);
	eq(hosts(), '# Zeeli: device names\n10.0.10.20 nas.lan\n');
});

test('dismissed devices are remembered, once each, and can come back as new', () => {
	fresh();
	api.dismiss.call({ args: { macs: [lc(A), B], dismissed: true } });
	eq(api.dismiss.call({ args: { macs: [A], dismissed: true } }).dismissed, [B, A]);
	eq(api.dismiss.call({ args: { macs: [A], dismissed: false } }).dismissed, [B]);
	ok(api.dismiss.call({ args: { macs: ['x'], dismissed: true } }).error);
});

done();
