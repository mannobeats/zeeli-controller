'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { cursor, paths } from 'zeeli.common';
import * as fw from 'zeeli.firewall';
import * as mdns from 'zeeli.mdns';
import * as rollback from 'zeeli.rollback';
import { reloader } from 'zeeli.snapshots';
import { readfile, writefile } from 'fs';

const reloaded = [];
reloader.run = (name) => {
	push(reloaded, name);
	return { code: 0, stdout: '' };
};
rollback.admin.flush = () => 0;
rollback.timer.start = () => 0;
const restarts = [];
mdns.avahi.restart = () => push(restarts, 1);

const rpc = plugin('firewall')['zeeli.firewall'];
const all = () => cursor().get_all('firewall');
const sections = (kind) => filter(map(keys(all()), (k) => all()[k]), (s) => s['.type'] == kind);
const pairs = () => sort(map(filter(sections('forwarding'), (f) => f.enabled != '0'), (f) => `${f.src}>${f.dest}`));
const lanOnly = () => filter(pairs(), (p) => !match(p, /wan|tailscale/));
const keep = (r) => {
	ok(!r.error, r.error);
	eq(rollback.confirm(r.token).state, 'confirmed');
	return r;
};

test('the grid starts from the forwardings the router has', () => {
	eq(pairs(), ['guest>wan', 'iot>wan', 'lan>tailscale0', 'lan>wan', 'tailscale0>lan', 'tailscale0>wan', 'wan>tailscale0']);
});

test('allowing cells adds one forwarding each, in a single change', () => {
	const before = length(reloaded);
	const r = keep(fw.access_apply({ cells: [{ src: 'lan', dest: 'iot', allow: true }, { src: 'lan', dest: 'guest', allow: true }] }));
	eq(r.changed, 2);
	eq(length(reloaded), before + 1);
	eq(lanOnly(), ['lan>guest', 'lan>iot']);
});

test('blocking removes the forwarding; one already blocked changes nothing', () => {
	keep(fw.access_apply({ cells: [{ src: 'lan', dest: 'guest', allow: false }] }));
	eq(lanOnly(), ['lan>iot']);
	const same = fw.access_apply({ cells: [{ src: 'lan', dest: 'guest', allow: false }, { src: 'lan', dest: 'iot', allow: true }] });
	eq(same.changed, 0);
	ok(!same.token, 'no timer for a change that changes nothing');
});

test('a disabled forwarding is turned back on rather than doubled', () => {
	const c = cursor();
	const f = filter(sections('forwarding'), (x) => x.src == 'lan' && x.dest == 'iot')[0];
	c.set('firewall', f['.name'], 'enabled', '0');
	c.save('firewall');
	c.commit('firewall');
	eq(lanOnly(), []);
	keep(fw.access_apply({ cells: [{ src: 'lan', dest: 'iot', allow: true }] }));
	eq(lanOnly(), ['lan>iot']);
	eq(length(filter(sections('forwarding'), (x) => x.src == 'lan' && x.dest == 'iot')), 1);
});

test('the sample grid: Main reaches the others, IoT and Guest only answer', () => {
	keep(fw.access_apply({ cells: [
		{ src: 'lan', dest: 'guest', allow: true }, { src: 'lan', dest: 'iot', allow: true },
		{ src: 'iot', dest: 'lan', allow: false }, { src: 'iot', dest: 'guest', allow: false },
		{ src: 'guest', dest: 'lan', allow: false }, { src: 'guest', dest: 'iot', allow: false },
	] }));
	eq(lanOnly(), ['lan>guest', 'lan>iot']);
});

test('refusals leave the firewall file as it was', () => {
	const before = readfile(`${paths.confdir}/firewall`);
	for (let t in [
		[{ cells: [] }, 'Pick at least one change.'],
		[{ cells: [{ src: 'lan', dest: 'iot' }] }, 'Each change needs a from network, a to network and allowed or blocked.'],
		[{ cells: [{ src: 'lan', dest: 'nope', allow: true }] }, 'Pick two networks that exist.'],
		[{ cells: [{ src: 'lan', dest: 'lan', allow: true }] }, 'A network always reaches itself.'],
		[{ cells: [{ src: 'guest', dest: 'wan', allow: false }] }, 'Internet access and router services aren’t part of this grid.'],
		[{ cells: [{ src: 'lan', dest: 'tailscale0', allow: false }] }, 'Internet access and router services aren’t part of this grid.'],
		[{ cells: [{ src: 'guest', dest: 'iot', allow: true }, { src: 'iot', dest: 'x', allow: true }] }, 'Pick two networks that exist.'],
	])
		eq(fw.access_apply(t[0]).error, t[1], sprintf('%J', t[0]));
	eq(readfile(`${paths.confdir}/firewall`), before);
});

test('a firewall where the admin network can’t reach the router is not built on', () => {
	const c = cursor();
	const lan = filter(sections('zone'), (z) => z.name == 'lan')[0];
	c.set('firewall', lan['.name'], 'input', 'REJECT');
	c.save('firewall');
	c.commit('firewall');
	const r = fw.access_apply({ cells: [{ src: 'lan', dest: 'guest', allow: false }] });
	eq(r.error, 'the Main LAN doesn’t accept traffic to the router. Fix that in its zone settings before changing what networks can reach.');
	c.set('firewall', lan['.name'], 'input', 'ACCEPT');
	c.save('firewall');
	c.commit('firewall');
});

/* ---------- mDNS ---------- */

const CONF = '[server]\nuse-ipv4=yes\n\n[reflector]\nenable-reflector=no\nreflect-ipv=no\n\n[rlimits]\nrlimit-core=0\n';

test('the avahi file is edited in place and edited back', () => {
	const on = mdns.reflecting(CONF, ['br-lan', 'br-iot']);
	eq(on, '[server]\n# zeeli\nallow-interfaces=br-lan,br-iot\nuse-ipv4=yes\n\n[reflector]\nenable-reflector=yes\nreflect-ipv=no\n\n[rlimits]\nrlimit-core=0\n');
	eq(mdns.reflecting(on, ['br-lan']), mdns.reflecting(CONF, ['br-lan']));
	eq(mdns.reflecting(on, null), CONF);
	eq(mdns.reflecting('[server]\nx=1\n', ['a']), '[server]\n# zeeli\nallow-interfaces=a\nx=1\n\n[reflector]\nenable-reflector=yes\n');
});

test('discovery is off until turned on for two networks, which opens UDP 5353 to the router from each', () => {
	writefile(paths.avahi, CONF);
	eq(rpc.mdns_status.call({ args: {} }), { available: true, enabled: false, zones: [] });
	eq(fw.mdns_set({ enabled: true, zones: ['lan'] }).error, 'Pick at least two networks to share devices between.');
	eq(fw.mdns_set({ enabled: true, zones: ['lan', 'wan'] }).error, 'wan can’t share devices: it isn’t a network of yours.');
	eq(fw.mdns_set({ enabled: 'yes' }).error, 'Turn device discovery on or off.');
	eq(readfile(paths.avahi), CONF);
	eq(length(restarts), 0);
	keep(fw.mdns_set({ enabled: true, zones: ['lan', 'iot', 'guest'] }));
	eq(readfile(paths.avahi), mdns.reflecting(CONF, ['br-lan', 'br-iot', 'br-guest']));
	eq(length(restarts), 1);
	const rule = all().zeeli_mdns_iot;
	eq([rule['.type'], rule.src, rule.proto, rule.dest_port, rule.target, rule.zeeli, rule.dest], ['rule', 'iot', 'udp', '5353', 'ACCEPT', '1', null]);
	eq(rpc.mdns_status.call({ args: {} }), { available: true, enabled: true, zones: ['lan', 'iot', 'guest'] });
	eq(length(filter(fw.rules().rules, (r) => match(r.name, /mDNS/))), 0, 'hidden from the rules list');
});

test('turning it off puts avahi and the firewall back', () => {
	keep(fw.mdns_set({ enabled: false }));
	eq(readfile(paths.avahi), CONF);
	eq(length(restarts), 2);
	eq(all().zeeli_mdns_iot, null);
	eq(rpc.mdns_status.call({ args: {} }).enabled, false);
});

done();
