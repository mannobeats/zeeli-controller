// "Route through" policies on the agent: what the console may offer and send, what lands in UCI
// and in the firewall file, and the ip rules and routing tables that go with an uplink. The router
// is never touched: commands are recorded in `sys.calls`, and the test plays the kernel's `ip rule`
// and netifd's interface status.
'use strict';

import { readfile, unlink, writefile } from 'fs';
import { eq, ok, plugin, test, done } from 'assert';
import { included, normal, ran, reset, sections } from 'sandbox';
import { cursor, paths } from 'zeeli.common';
import * as policies from 'zeeli.policies';
import { sys, tick } from 'zeeli.policyapply';

const TV = '02:5E:E1:31:90:F4', LEO = '02:5E:E1:17:2B:C1';
const everyNight = { kind: 'schedule', days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '07:00' };
const UK = 'vpn:10101', WORK = 'vpn:10102', ETH2 = 'uplink:secondwan';

/** netifd's answer for `ubus call network.interface.<name> status`, by interface name. */
const iface = (up, dev, gw) => ({ up, l3_device: dev, route: gw ? [{ target: '0.0.0.0', mask: 0, nexthop: gw }] : [] });
const LIVE = {
	wan: iface(true, 'eth0', '192.168.1.1'), secondwan: iface(true, 'eth2', '192.168.2.1'), wwan: iface(true, 'sta1', '192.168.3.1'),
	tethering: iface(false), wgclient1: iface(true, 'wgclient1'), ovpnclient2: iface(false),
};
let netifd = LIVE, rules = [];

/** The ip rules the kernel holds: `ip -4 rule add` and `del` change them, `show` prints them as iproute2 does. */
function kernel(argv) {
	if (argv[0] == 'ubus') {
		const i = netifd[replace(argv[2], 'network.interface.', '')];
		return i ? { code: 0, stdout: sprintf('%J', i) } : { code: 4, stdout: '' };
	}
	if (argv[0] != 'ip' || argv[2] != 'rule') return normal(argv);
	if (argv[3] == 'show') return { code: 0, stdout: join('', map(rules, (r) => `${r}\n`)) };
	const pref = argv[5];
	rules = filter(rules, (r) => index(r, `${pref}:`) != 0);
	if (argv[3] == 'add') {
		const parts = split(argv[7], '/');
		push(rules, `${pref}:\tfrom all fwmark 0x${sprintf('%x', int(substr(parts[0], 2), 16))}/0x${sprintf('%x', int(substr(parts[1], 2), 16))} lookup ${argv[9]}${argv[10] ? ' suppress_prefixlength 0' : ''}`);
	}
	return { code: 0, stdout: '' };
}

function setup(state) {
	reset();
	netifd = state ?? LIVE;
	rules = [];
	sys.answer = kernel;
	sys.calls = [];
}

const route = (target, more) => ({
	name: 'Route', who: [{ type: 'client', id: TV }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'route', target, fallback: 'normal' }, ...(more ?? {}),
});
function make(target, more) {
	const r = policies.create(route(target, more));
	if (r.error) die(r.error);
	return r.policy;
}
const refused = (target, more, message) => eq(policies.create(route(target, more)).error, message, sprintf('%J', [target, more]));
const find = (id) => filter(policies.list().policies, (p) => p.id == id)[0];
const clockAt = (hh, mm) => {
	sys.now = () => 1792627200 + hh * 3600 + mm * 60;
};

/** GL's tunnels all deleted. */
function removeTunnels() {
	const c = cursor();
	c.foreach('route_policy', 'rule', (s) => c.delete('route_policy', s['.name']));
	c.commit('route_policy');
}

/* ---------- what can be routed through ---------- */

test('route_targets lists GL’s tunnels by name, and the uplinks, each with whether it is up', () => {
	setup();
	eq(policies.routeTargets().targets, [
		{ id: UK, kind: 'vpn', name: 'UK VPN', label: 'UK VPN (WireGuard)', up: true },
		{ id: WORK, kind: 'vpn', name: 'Work VPN', label: 'Work VPN (OpenVPN)', up: false },
		{ id: 'uplink:wan', kind: 'uplink', name: 'Ethernet 1', label: 'Ethernet 1', up: true },
		{ id: 'uplink:wwan', kind: 'uplink', name: 'Repeater', label: 'Repeater', up: true },
		{ id: 'uplink:tethering', kind: 'uplink', name: 'Tethering', label: 'Tethering', up: false },
		{ id: 'uplink:modem_1_1_2', kind: 'uplink', name: 'Cellular', label: 'Cellular', up: false },
		{ id: ETH2, kind: 'uplink', name: 'Ethernet 2', label: 'Ethernet 2', up: true },
	]);
});

test('a tunnel GL has switched off, or an uplink kmwan doesn’t manage, is not up, or not offered', () => {
	setup();
	const c = cursor();
	c.set('route_policy', 'zeeli_test', 'rule');
	c.set('route_policy', 'zeeli_test', 'via', 'wgclient3');
	c.set('route_policy', 'zeeli_test', 'tunnel_id', '10103');
	c.set('route_policy', 'zeeli_test', 'enabled', '0');
	c.set('route_policy', 'zeeli_test', 'name', 'Off VPN');
	c.set('kmwan', 'wan', 'disabled', '1');
	c.commit('route_policy');
	c.commit('kmwan');
	const found = policies.routeTargets().targets;
	eq(filter(found, (t) => t.id == 'vpn:10103'), [{ id: 'vpn:10103', kind: 'vpn', name: 'Off VPN', label: 'Off VPN (WireGuard)', up: false }]);
	eq(filter(found, (t) => t.id == 'uplink:wan'), []);
	eq(length(filter(found, (t) => t.id == 'vpn:10100')), 0, 'GL’s own process rules are not tunnels');
	eq(length(filter(found, (t) => match(t.id, /6$/))), 0, 'and nor are IPv6 members');
});

/* ---------- what is stored and what is refused ---------- */

test('a route policy stores its target and what happens when that is down', () => {
	setup();
	const p = make(UK, { action: { kind: 'route', target: UK, fallback: 'block' } });
	const s = sections('policy')[0];
	eq([s.action, s.target, s.fallback], ['route', UK, 'block']);
	eq(find(p.id).action, { kind: 'route', target: UK, fallback: 'block' });
	const q = make(ETH2, { action: { kind: 'route', target: ETH2 } });
	eq(find(q.id).action, { kind: 'route', target: ETH2, fallback: 'block' }, 'the safe choice is the default');
	eq(find(p.id).what, { kind: 'internet' });
});

test('a route needs a real target, the internet or sites, and a fallback that makes sense', () => {
	setup();
	for (let bad in ['', 'vpn:', 'vpn:abc', 'uplink:WAN', 'wan', 'vpn:1;reboot', 'uplink:../etc', 5])
		refused(bad, null, 'Choose a VPN tunnel or an internet connection to route through.');
	refused('vpn:99999', null, 'The router has no such VPN tunnel or internet connection.');
	refused('uplink:nowhere', null, 'The router has no such VPN tunnel or internet connection.');
	refused('vpn:10100', null, 'The router has no such VPN tunnel or internet connection.');
	refused(UK, { what: { kind: 'everything' } }, 'Routing covers the internet or chosen sites, not everything or another network.');
	refused(UK, { what: { kind: 'network', network: 'iot' } }, 'Routing covers the internet or chosen sites, not everything or another network.');
	refused(UK, { action: { kind: 'route', target: UK, fallback: 'maybe' } }, 'While the target is down, the traffic is either blocked or takes the normal route.');
	eq(sections('policy'), []);
});

test('who is as for any policy: devices, groups and networks, but not an uplink', () => {
	setup();
	ok(policies.create(route(UK, { who: [{ type: 'network', id: 'iot' }] })).policy, 'a whole network');
	ok(match(policies.create(route(UK, { who: [{ type: 'network', id: 'wan' }] })).error, /is an uplink/));
	ok(match(policies.create(route(UK, { who: [{ type: 'client', id: 'nope' }] })).error, /isn’t a MAC address/));
});

test('a policy can be edited after its tunnel or uplink has gone, but not pointed at another that isn’t there', () => {
	setup();
	const p = make(UK);
	removeTunnels();
	eq(find(p.id).action.target, UK, 'the policy keeps its target');
	eq(policies.update({ id: p.id, name: 'Renamed' }).policy.name, 'Renamed');
	eq(policies.update({ id: p.id, enabled: false }).policy.enabled, false);
	eq(policies.update({ id: p.id, action: { kind: 'route', target: UK, fallback: 'block' } }).policy.action.fallback, 'block', 'the same target can be saved again');
	eq(policies.update({ id: p.id, action: { kind: 'route', target: WORK, fallback: 'block' } }).error, 'The router has no such VPN tunnel or internet connection.');
});

test('policies can route through up to 15 different targets and fallbacks', () => {
	setup();
	const c = cursor();
	c.set('kmwan', 'extra', 'member');
	c.set('kmwan', 'extra', 'interface', 'extra');
	c.commit('kmwan');
	const ids = [UK, WORK, 'uplink:wan', 'uplink:wwan', 'uplink:tethering', 'uplink:modem_1_1_2', ETH2, 'uplink:extra'];
	let n = 0;
	for (let id in ids)
		for (let fallback in ['block', 'normal'])
			if (++n <= 15) ok(policies.create(route(id, { action: { kind: 'route', target: id, fallback } })).policy, `${id} ${fallback}`);
	eq(policies.create(route('uplink:extra', { action: { kind: 'route', target: 'uplink:extra', fallback: 'normal' } })).error, 'Policies can route through up to 15 different targets (counting what happens while one is down).');
	ok(policies.create(route(UK, { action: { kind: 'route', target: UK, fallback: 'block' } })).policy, 'a combination already in use costs no new slot');
});

/* ---------- a tunnel: GL does the routing, the agent marks ---------- */

test('a tunnel policy marks with GL’s mark for that tunnel and asks netifd about no other interface', () => {
	setup();
	const p = make(UK, { action: { kind: 'route', target: UK, fallback: 'block' } });
	ok(index(included(), `chain zeeli_p_${p.id} {\n\t\tether saddr @zeeli_c_${p.id} fib daddr type != { local, broadcast, multicast } meta mark and 0x0f000000 == 0x00000000 counter meta mark set meta mark or 0x01001000\n\t}`) >= 0, included());
	ok(index(included(), 'chain zeeli_route {\n\t\ttype filter hook prerouting priority -151; policy accept;') >= 0);
	eq(uniq(ran('ubus')), ['ubus call network.interface.wgclient1 status']);
	eq(ran('ip'), [], 'a tunnel needs no ip rules of ours: GL has them');
	ok(index(included(), `chain zeeli_k_${p.id} {\n\t\tmeta mark and 0x0f000000 == 0x01000000 oifname`) >= 0, 'block: the drop');
	eq(find(p.id).active, true);
});

test('an OpenVPN tunnel gets its own GL mark', () => {
	setup({ ...LIVE, ovpnclient2: iface(true, 'ovpnclient2') });
	make(WORK);
	ok(index(included(), 'meta mark or 0x0100b000') > 0, included());
});

test('with fallback "normal" a tunnel that goes down stops being used, and is used again when it comes back', () => {
	setup();
	const p = make(UK);
	ok(index(included(), 'meta mark set') > 0);
	netifd = { ...LIVE, wgclient1: iface(false) };
	sys.calls = [];
	eq(tick().applied, 'live', 'a live swap, no reload');
	eq(ran('reload'), []);
	ok(index(included(), 'meta mark set') < 0, 'nothing marked: normal routing');
	eq(find(p.id).active, true, 'the policy still applies');
	netifd = LIVE;
	eq(tick().applied, 'live');
	ok(index(included(), 'meta mark set') > 0);
});

test('with fallback "block" the marks and the drop stay while the tunnel is down', () => {
	setup({ ...LIVE, wgclient1: iface(false) });
	make(UK, { action: { kind: 'route', target: UK, fallback: 'block' } });
	ok(index(included(), 'meta mark set') > 0 && index(included(), 'counter drop') > 0, included());
	eq(ran('ip'), []);
});

test('a tunnel GL has removed: block keeps the devices off the internet, normal lets them be, and both say so', () => {
	setup();
	const block = make(UK, { name: 'Block', action: { kind: 'route', target: UK, fallback: 'block' } });
	const normal = make(UK, { name: 'Normal' });
	removeTunnels();
	tick();
	ok(index(included(), `chain zeeli_k_${block.id} {\n\t\tmeta mark and 0x0f000000 == 0x01000000 oifname { "eth0", "sta1" } counter drop`) > 0, included());
	ok(index(included(), `chain zeeli_p_${normal.id} {\n\t}`) > 0, 'normal marks nothing');
	eq(length(filter(policies.list().warnings, (w) => match(w, /is gone/))), 2);
});

/* ---------- an uplink: ip rules and a routing table ---------- */

const ADD = [
	'ip -4 rule show',
	'ip -4 rule add pref 5801 fwmark 0x01000000/0x0f000000 lookup main suppress_prefixlength 0',
	'ip -4 rule add pref 5821 fwmark 0x01000000/0x0f000000 lookup 7701',
	'ip -4 route replace default via 192.168.2.1 dev eth2 table 7701',
];

test('an uplink policy adds its two ip rules and a table, and keeps them true on every pass', () => {
	setup();
	const p = make(ETH2);
	eq(ran('ip'), ADD);
	ok(index(included(), 'meta mark set meta mark or 0x01000000') > 0, included());
	eq(rules, ['5801:\tfrom all fwmark 0x1000000/0xf000000 lookup main suppress_prefixlength 0', '5821:\tfrom all fwmark 0x1000000/0xf000000 lookup 7701']);
	sys.calls = [];
	tick();
	eq(ran('ip'), ['ip -4 rule show', 'ip -4 route replace default via 192.168.2.1 dev eth2 table 7701'], 'nothing to add the second time');
	eq(find(p.id).active, true);
});

test('rules that GL’s reload (or anyone) took away come back on the next pass, and extra ones of ours go', () => {
	setup();
	make(ETH2);
	rules = ['5821:\tfrom all fwmark 0x1000000/0xf000000 lookup 7701', '5803:\tfrom all fwmark 0x3000000/0xf000000 lookup main suppress_prefixlength 0', '6000:\tfrom all fwmark 0x1000/0xf000 lookup 1001'];
	sys.calls = [];
	tick();
	eq(ran('ip'), [
		'ip -4 rule show', 'ip -4 rule del pref 5803',
		'ip -4 rule add pref 5801 fwmark 0x01000000/0x0f000000 lookup main suppress_prefixlength 0',
		'ip -4 route replace default via 192.168.2.1 dev eth2 table 7701',
	]);
	ok(length(filter(rules, (r) => match(r, /^6000:/))) == 1, 'GL’s own rule is never touched');
});

test('an uplink with no gateway is routed by device alone, and a gateway that changes is followed', () => {
	setup({ ...LIVE, secondwan: iface(true, 'eth2') });
	make(ETH2);
	eq(ran('ip')[3], 'ip -4 route replace default dev eth2 table 7701');
	netifd = { ...LIVE, secondwan: iface(true, 'eth2', '10.9.9.1') };
	sys.calls = [];
	tick();
	eq(ran('ip')[1], 'ip -4 route replace default via 10.9.9.1 dev eth2 table 7701');
});

test('removing or switching off the policy takes its rules and table away again', () => {
	setup();
	const p = make(ETH2);
	sys.calls = [];
	policies.update({ id: p.id, enabled: false });
	eq(ran('ip'), ['ip -4 rule show', 'ip -4 rule del pref 5801', 'ip -4 rule del pref 5821', 'ip -4 route flush table 7701']);
	eq(rules, []);
	policies.update({ id: p.id, enabled: true });
	eq(length(rules), 2);
	sys.calls = [];
	policies.remove({ id: p.id });
	eq(ran('ip'), ['ip -4 rule show', 'ip -4 rule del pref 5801', 'ip -4 rule del pref 5821', 'ip -4 route flush table 7701']);
	eq(rules, []);
	sys.calls = [];
	tick();
	eq(ran('ip'), [], 'and a router with no route policies runs no ip commands at all');
});

test('a schedule brings the table and the rules in at its start and takes them out at its end', () => {
	setup();
	make(ETH2, { when: everyNight });
	eq(ran('ip'), [], 'noon: nothing yet');
	clockAt(22, 0);
	sys.calls = [];
	eq(tick().applied, 'live');
	eq(ran('ip'), ADD);
	clockAt(24 + 7, 0);
	sys.calls = [];
	tick();
	eq(ran('ip'), ['ip -4 rule show', 'ip -4 rule del pref 5801', 'ip -4 rule del pref 5821', 'ip -4 route flush table 7701']);
});

test('fallback "normal": an uplink that is down gets no table, and the devices use the normal route until it is back', () => {
	setup({ ...LIVE, secondwan: iface(false) });
	make(ETH2);
	ok(index(included(), 'meta mark set') < 0, 'not marked');
	eq(ran('ip'), []);
	netifd = LIVE;
	eq(tick().applied, 'live');
	eq(ran('ip'), ADD);
});

test('fallback "block": an uplink that is down keeps the devices from leaving any other way', () => {
	setup({ ...LIVE, secondwan: iface(false) });
	const p = make(ETH2, { action: { kind: 'route', target: ETH2, fallback: 'block' } });
	ok(index(included(), `chain zeeli_k_${p.id} {\n\t\tmeta mark and 0x0f000000 == 0x01000000 oifname { "eth0", "sta1" } counter drop`) > 0, included());
	eq(ran('ip'), []);
});

test('an uplink going down takes its table and rules away', () => {
	setup();
	make(ETH2, { action: { kind: 'route', target: ETH2, fallback: 'block' } });
	netifd = { ...LIVE, secondwan: iface(false) };
	sys.calls = [];
	tick();
	eq(ran('ip'), ['ip -4 rule show', 'ip -4 rule del pref 5801', 'ip -4 rule del pref 5821', 'ip -4 route flush table 7701']);
});

test('IPv6 on: the router says an uplink route covers only IPv4', () => {
	setup();
	writefile(`${paths.confdir}/glipv6`, '');
	const c = cursor();
	c.set('glipv6', 'globals', 'globals');
	c.set('glipv6', 'globals', 'enabled', '1');
	c.commit('glipv6');
	const r = policies.create(route(ETH2));
	ok(length(filter(r.warnings, (w) => match(w, /IPv6/))) == 1, sprintf('%J', r.warnings));
	unlink(`${paths.confdir}/glipv6`);
});

/* ---------- order, cleanup and open connections ---------- */

test('the first route policy to name a device decides, and later ones leave it alone', () => {
	setup();
	const a = make(UK, { name: 'First' });
	const b = make(ETH2, { name: 'Second' });
	const out = included();
	ok(index(out, 'jump zeeli_p_' + a.id + '\n\t\tjump zeeli_p_' + b.id) > 0, 'marked in list order');
	ok(index(out, 'meta mark and 0x0f000000 == 0x00000000') > 0, 'each only marks a packet nobody marked yet');
	policies.reorder({ ids: [b.id, a.id] });
	ok(index(included(), 'jump zeeli_p_' + b.id + '\n\t\tjump zeeli_p_' + a.id) > 0, 'and reordering changes who wins');
});

test('a policy that goes leaves none of its chains behind', () => {
	setup();
	const p = make(ETH2, { action: { kind: 'route', target: ETH2, fallback: 'block' } });
	let sent = null;
	sys.answer = (argv) => {
		if (argv[0] == 'nft' && argv[1] == '-t')
			return { code: 0, stdout: `table inet fw4 {\n\tchain zeeli_p_${p.id} {\n\t}\n\tchain zeeli_k_${p.id} {\n\t}\n\tchain zeeli_route {\n\t}\n\tchain zeeli_forward {\n\t}\n\tchain input {\n\t}\n}\n` };
		if (argv[0] == 'nft' && argv[1] == '-f' && match(argv[2], /orphans/)) sent = readfile(argv[2]);
		return kernel(argv);
	};
	eq(policies.remove({ id: p.id }).applied, 'reload');
	eq(sent, `delete chain inet fw4 zeeli_p_${p.id}\ndelete chain inet fw4 zeeli_k_${p.id}\ndelete chain inet fw4 zeeli_route\n`);
});

test('a device whose route changes has its open connections ended, once', () => {
	setup();
	sys.neighbours = () => ({ '02:5e:e1:31:90:f4': ['192.168.8.30'] });
	const p = make(ETH2);
	eq(ran('conntrack'), ['conntrack -D -s 192.168.8.30', 'conntrack -D -r 192.168.8.30']);
	sys.calls = [];
	tick();
	policies.update({ id: p.id, name: 'Same route' });
	eq(ran('conntrack'), [], 'not while the route stays the same');
	policies.update({ id: p.id, action: { kind: 'route', target: UK, fallback: 'normal' } });
	eq(length(ran('conntrack')), 2, 'when it changes');
	sys.calls = [];
	policies.remove({ id: p.id });
	eq(length(ran('conntrack')), 2, 'and when the policy goes');
	sys.calls = [];
	policies.create(route(ETH2, { who: [{ type: 'client', id: LEO }] }));
	eq(ran('conntrack'), [], 'a device with no addresses known has nothing to end');
});

test('a route policy does not stop block and allow policies from applying to the same devices', () => {
	setup();
	make(UK);
	policies.create({ name: 'Bedtime', who: [{ type: 'client', id: TV }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' } });
	ok(index(included(), 'ct direction original counter drop') > 0, 'the block is there');
	ok(index(included(), 'meta mark set') > 0, 'and so is the route');
});

/* ---------- the rpcd object ---------- */

test('rpcd offers route_targets, and the action carries its target and fallback', () => {
	setup();
	const pol = plugin('policies')['zeeli.policies'];
	eq(sort(keys(pol)), ['apply', 'create', 'delete', 'list', 'pause', 'reorder', 'route_targets', 'status', 'update']);
	eq(length(pol.route_targets.call({ args: {} }).targets), 7);
	const made = pol.create.call({ args: route(UK) }).policy;
	eq(made.action, { kind: 'route', target: UK, fallback: 'normal' });
});

done();
