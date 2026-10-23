'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { cursor } from 'zeeli.common';
import * as ports from 'zeeli.ports';

const rpc = plugin('ports')['zeeli.ports'];
const call = (method, args) => rpc[method].call({ args });

// what the router's tools print, for the tests to feed in
let switchOut = {
	'7': 'port:7 link:up speed:2500baseT full-duplex txflow rxflow',
	'6': 'port:6 link:down',
	'5': 'port:5 link:down',
	'4': 'port:4 link:down',
};
let sys = { carrier: '0', speed: '-1', duplex: 'unknown' };
ports.probe.swconfig = (sw, port) => switchOut[`${port}`];
ports.probe.sys = (dev, file) => dev == 'eth0' ? sys[file] : '';
ports.probe.fdb = () => join('\n', [
	'bc:24:11:ac:8c:bb dev eth1.1 master br-lan ',
	'84:47:09:6a:40:ef dev eth1.9 master br-guest ',
	'33:33:00:00:00:01 dev eth1.1 self permanent',
	'94:83:c4:c5:4e:70 dev eth1.1 master br-lan permanent',
	'01:00:5e:00:00:fb dev br-lan self permanent',
	'46:92:0d:df:73:99 dev wlan0 master br-lan permanent',
	'bc:24:11:7a:9a:67 dev wlan0 master br-lan ',
	'01:00:5e:00:00:01 dev eth1.1 master br-lan ',
	'aa:bb:cc:dd:ee:ff dev eth0 master br-wan ',
]);
const port = (r, name) => filter(r.ports, (p) => p.name == name)[0];

test('the port list is GL’s own, with link, speed and duplex from the hardware', () => {
	const r = ports.status();
	eq(map(r.ports, (p) => p.label), ['WAN', 'LAN1', 'LAN2', 'LAN3', 'LAN4']);
	eq([port(r, 'secondwan').link, port(r, 'secondwan').speedMbps, port(r, 'secondwan').duplex], [true, 2500, 'full']);
	eq([port(r, 'lan2').link, port(r, 'lan2').speedMbps, port(r, 'lan2').duplex], [false, null, null]);
	eq([port(r, 'wan').link, port(r, 'wan').speedMbps, port(r, 'wan').role], [false, null, 'wan']);
	eq(port(r, 'secondwan').kind, 'switch');
	eq(port(r, 'wan').kind, 'direct');
});

test('a link read from /sys gives speed and duplex when the cable is in', () => {
	sys = { carrier: '1', speed: '2500', duplex: 'full' };
	const w = port(ports.status(), 'wan');
	eq([w.link, w.speedMbps, w.duplex], [true, 2500, 'full']);
	sys = { carrier: '0', speed: '-1', duplex: 'unknown' };
});

test('with one cable in the switch, the wired devices behind it are known', () => {
	const r = ports.status();
	eq(port(r, 'secondwan').devices, [{ mac: 'BC:24:11:AC:8C:BB', inferred: true }, { mac: '84:47:09:6A:40:EF', inferred: true }]);
	eq(r.unattributed, []);
	eq(port(r, 'lan2').devices, []);
	// the WAN is its own device, so the bridge names it
	eq(port(r, 'wan').devices, [{ mac: 'AA:BB:CC:DD:EE:FF', inferred: false }]);
});

test('with two cables the switch can’t say which device is where', () => {
	switchOut['6'] = 'port:6 link:up speed:1000baseT full-duplex';
	const r = ports.status();
	eq(port(r, 'secondwan').devices, []);
	eq(port(r, 'lan2').devices, []);
	eq(r.unattributed, [{ mac: 'BC:24:11:AC:8C:BB' }, { mac: '84:47:09:6A:40:EF' }]);
	switchOut['6'] = 'port:6 link:down';
});

test('readings that make no sense are left unknown rather than guessed', () => {
	eq(ports.parseSwconfig('port:3 link:up speed:10000baseT full-duplex '), { link: true, speedMbps: 10000, duplex: 'full' });
	eq(ports.parseSwconfig('port:3 link:down'), { link: false, speedMbps: null, duplex: null });
	eq(ports.parseSwconfig('Unknown attribute'), { link: null, speedMbps: null, duplex: null });
	eq(ports.parseFdb('01:00:5e:00:00:01 dev eth1 master br-lan \nzz not a line\n'), []);
	switchOut = {};
	ports.probe.swconfig = () => '';
	eq(port(ports.status(), 'secondwan').link, null);
});

test('profiles are stored in /etc/config/zeeli, owned by the agent', () => {
	eq(call('profiles', {}), { profiles: [] });
	const r = call('profile_save', { name: 'Camera port', untagged: 'iot', tagged: ['guest', 'iot'] });
	ok(!r.error, r.error);
	eq([r.profile.name, r.profile.untagged, r.profile.tagged], ['Camera port', 'iot', ['guest']]);
	ok(match(r.profile.id, /^zeeli_pp_[0-9a-f]{6}$/), r.profile.id);
	const s = cursor().get_all('zeeli')[r.profile.id];
	eq([s['.type'], s.zeeli, s.name, s.untagged, s.tagged], ['port_profile', '1', 'Camera port', 'iot', ['guest']]);
	const edit = call('profile_save', { id: r.profile.id, name: 'Cameras', untagged: 'main', tagged: [] });
	eq([edit.profile.name, edit.profile.tagged], ['Cameras', []]);
	eq(cursor().get_all('zeeli')[r.profile.id].tagged, null);
	eq(map(call('profiles', {}).profiles, (p) => p.name), ['Cameras']);
});

test('profiles are checked before anything is stored', () => {
	for (let t in [
		[{ name: '', untagged: 'main' }, 'Give the profile a name of up to 32 characters.'],
		[{ name: replace(sprintf('%33s', ''), ' ', 'x'), untagged: 'main' }, 'Give the profile a name of up to 32 characters.'],
		[{ name: 'A', untagged: '' }, 'Pick the network this profile carries untagged.'],
		[{ name: 'A' }, 'Pick the network this profile carries untagged.'],
		[{ name: 'A', untagged: 'main', tagged: ['bad"name'] }, 'Tagged networks must be network names, up to 16.'],
		[{ name: 'cameras', untagged: 'main' }, 'A profile called cameras already exists.'],
		[{ name: 'B', untagged: 'main', id: 'zeeli_pp_000000' }, 'That profile is gone. Reload the list.'],
	])
		eq(call('profile_save', t[0]).error, t[1], sprintf('%J', t[0]));
	eq(length(call('profiles', {}).profiles), 1);
});

test('deleting a profile removes only that section', () => {
	const id = call('profiles', {}).profiles[0].id;
	eq(call('profile_delete', { id: 'lan' }), { error: 'That profile is already gone.' });
	eq(call('profile_delete', { id }), { id });
	eq(call('profiles', {}), { profiles: [] });
	eq(call('profile_delete', { id }), { error: 'That profile is already gone.' });
});

done();
