// The policy compiler: schedules, expiry, who/what/when/action, and golden nft output. The
// golden files in test/golden are complete `nft -c -f` inputs; check them on a router with
//   nft -c -f /tmp/zeeli-golden/<name>.nft
'use strict';

import { readfile } from 'fs';
import { eq, ok, test, done } from 'assert';
import { CASES, ZONES, at, base, client, everyNight, group, kids, network, policy, via, MAYA, LEO, TABLET, TV } from 'cases';
import * as nft from 'zeeli.nftpolicy';

const bedtime = () => policy('000001', 10, { who: [group('a1b2c3')], when: everyNight });
const golden = (name) => readfile(`${getenv('ZEELI_AGENT')}/test/golden/${name}.nft`);
const text = (input) => nft.render(nft.compile(input));

for (let name in sort(keys(CASES)))
	test(`golden output: ${name}`, () => {
		eq(nft.checkable(text(CASES[name])), golden(name), name);
	});

test('a schedule that runs past midnight belongs to the day it starts on', () => {
	const friday = { kind: 'schedule', days: [5], from: '22:00', to: '07:00' };
	const at = (wday, hh, mm) => ({ ts: 0, wday, minutes: hh * 60 + mm });
	ok(nft.inWindow(friday, at(5, 22, 0)), 'Friday 22:00');
	ok(nft.inWindow(friday, at(5, 23, 59)), 'Friday 23:59');
	ok(nft.inWindow(friday, at(6, 0, 0)), 'Saturday 00:00');
	ok(nft.inWindow(friday, at(6, 6, 59)), 'Saturday 06:59');
	ok(!nft.inWindow(friday, at(6, 7, 0)), 'Saturday 07:00 is over');
	ok(!nft.inWindow(friday, at(5, 21, 59)), 'Friday before 22:00');
	ok(!nft.inWindow(friday, at(5, 6, 0)), 'Friday morning belongs to Thursday’s window');
	ok(!nft.inWindow(friday, at(6, 22, 30)), 'Saturday night wasn’t asked for');
});

test('a schedule on one day, and on Sunday into Monday', () => {
	const mon = (from, to) => ({ kind: 'schedule', days: [1], from, to });
	const clock = (wday, hh, mm) => ({ ts: 0, wday, minutes: hh * 60 + mm });
	ok(nft.inWindow(mon('09:00', '17:00'), clock(1, 9, 0)));
	ok(!nft.inWindow(mon('09:00', '17:00'), clock(1, 17, 0)), 'the end is exclusive');
	ok(!nft.inWindow(mon('09:00', '17:00'), clock(2, 10, 0)), 'Tuesday');
	const sunday = { kind: 'schedule', days: [7], from: '23:00', to: '06:00' };
	ok(nft.inWindow(sunday, clock(1, 5, 0)), 'Monday 05:00 follows Sunday night');
	ok(!nft.inWindow(sunday, clock(7, 5, 0)), 'Sunday 05:00 doesn’t');
});

test('equal times mean the whole day', () => {
	const sat = { kind: 'schedule', days: [6], from: '00:00', to: '00:00' };
	ok(nft.inWindow(sat, { ts: 0, wday: 6, minutes: 0 }));
	ok(nft.inWindow(sat, { ts: 0, wday: 6, minutes: 1439 }));
	ok(!nft.inWindow(sat, { ts: 0, wday: 7, minutes: 30 }));
});

test('a policy ends at its expiry, and only runs while switched on', () => {
	const p = policy('000010', 10, { until: 1000 });
	ok(nft.isActive(p, { ts: 999, wday: 1, minutes: 0 }));
	ok(!nft.isActive(p, { ts: 1000, wday: 1, minutes: 0 }), 'at the expiry it is over');
	ok(!nft.isActive({ ...p, enabled: false }, { ts: 0, wday: 1, minutes: 0 }), 'switched off');
});

test('clock turns a timestamp into the weekday and minute of the router’s time', () => {
	eq(nft.clock(1792627200, gmtime), { ts: 1792627200, wday: 4, minutes: 0 });
	eq(nft.clock(1792627200 + 3 * 86400 + 7 * 3600 + 5 * 60, gmtime), { ts: 1792627200 + 3 * 86400 + 7 * 3600 + 5 * 60, wday: 7, minutes: 425 });
});

test('toMinutes accepts only HH:MM', () => {
	eq(nft.toMinutes('07:30'), 450);
	eq(nft.toMinutes('24:00'), null);
	eq(nft.toMinutes('7:30'), null);
	eq(nft.toMinutes('07:60'), null);
	eq(nft.toMinutes(730), null);
});

test('policies apply in order, and the order field decides rather than the list', () => {
	const a = policy('000002', 20, { who: [client(TV)] }), b = policy('000001', 10, { who: [client(LEO)], action: { kind: 'allow' } });
	const c = nft.compile({ ...base, policies: [a, b], now: at(12, 0) });
	eq(map(c.chains, (ch) => ch.name), ['zeeli_p_000001', 'zeeli_p_000002']);
	ok(index(c.chains[0].rules[0], 'accept') > 0, 'the allow comes first');
});

test('a switched-off policy keeps an empty chain so switching it on is a live change', () => {
	const c = nft.compile({ ...base, policies: [policy('000001', 10, { who: [client(TV)], enabled: false })], now: at(12, 0) });
	eq(c.chains, [{ name: 'zeeli_p_000001', rules: [] }]);
	eq(c.active, []);
	eq(c.blocked, []);
});

test('compile reports who is blocked, upper or lower case alike, once', () => {
	const c = nft.compile({
		...base,
		policies: [policy('000001', 10, { who: [group('a1b2c3'), client(MAYA)], when: everyNight })],
		now: at(23, 0),
	});
	eq(c.blocked, [MAYA, LEO, TABLET]);
	eq(c.active, ['000001']);
});

test('an allow policy blocks nobody', () => {
	const c = nft.compile({ ...base, policies: [policy('000001', 10, { who: [client(LEO)], action: { kind: 'allow' } })], now: at(12, 0) });
	eq(c.blocked, []);
});

test('the internet is every masquerading zone the router names; none means no rules', () => {
	const two = nft.compile({ ...base, zones: { ...ZONES, wgclient: ['wgclient'] }, internet: ['wan', 'wgclient'], policies: [policy('000001', 10, { who: [client(TV)] })], now: at(12, 0) });
	eq(two.chains[0].rules, [
		'ether saddr @zeeli_c_000001 oifname { "eth0", "sta1" } ct direction original counter drop',
		'ether saddr @zeeli_c_000001 oifname { "wgclient" } ct direction original counter drop',
	]);
	const none = nft.compile({ ...base, internet: [], policies: [policy('000001', 10, { who: [client(TV)] })], now: at(12, 0) });
	eq(none.chains[0].rules, []);
});

test('a zone with no devices matches nothing, and says so', () => {
	const c = nft.compile({
		...base,
		zones: { ...ZONES, ghost: [] },
		policies: [policy('000001', 10, { who: [network('ghost')], what: { kind: 'network', network: 'lan' } })],
		now: at(12, 0),
	});
	eq(c.chains[0].rules, []);
	eq(length(c.warnings), 1);
});

test('an unknown network is skipped with a warning, not an error', () => {
	const c = nft.compile({
		...base,
		policies: [policy('000001', 10, { who: [network('gone')], what: { kind: 'network', network: 'lan' } })],
		now: at(12, 0),
	});
	eq(c.chains[0].rules, []);
	ok(length(c.warnings) == 1 && index(c.warnings[0], 'gone') >= 0, 'warns about the network');
});

test('a group that no longer exists matches nobody', () => {
	const c = nft.compile({ ...base, policies: [policy('000001', 10, { who: [group('ffffff')] })], now: at(12, 0) });
	eq(c.chains[0].rules, []);
	eq(c.blocked, []);
});

test('speed limits come from active limit policies, and the first policy to name a device wins', () => {
	const slow = policy('000001', 10, { who: [client(TV)], what: { kind: 'everything' }, action: { kind: 'limit', down: 5, up: 1 } });
	const slower = policy('000002', 20, { who: [group('a1b2c3'), client(TV)], what: { kind: 'everything' }, action: { kind: 'limit', down: 1, up: 0.5 } });
	const c = nft.compile({ ...base, policies: [slower, slow], now: at(12, 0) });
	eq(c.limits, [
		{ mac: TV, down: 5, up: 1, policy: '000001' },
		{ mac: MAYA, down: 1, up: 0.5, policy: '000002' },
		{ mac: LEO, down: 1, up: 0.5, policy: '000002' },
		{ mac: TABLET, down: 1, up: 0.5, policy: '000002' },
	]);
	eq(c.chains, [], 'a limit has no firewall chain');
	eq(c.sets, [], 'and no sets');
});

test('a limit on a schedule only applies inside it', () => {
	const night = policy('000001', 10, { who: [client(TV)], when: everyNight, action: { kind: 'limit', down: 2, up: 2 } });
	eq(length(nft.compile({ ...base, policies: [night], now: at(23, 0) }).limits), 1);
	eq(length(nft.compile({ ...base, policies: [night], now: at(12, 0) }).limits), 0);
});

test('a limit for a whole network is refused with a warning', () => {
	const c = nft.compile({ ...base, policies: [policy('000001', 10, { who: [network('guest')], what: { kind: 'everything' }, action: { kind: 'limit', down: 1, up: 1 } })], now: at(12, 0) });
	eq(c.limits, []);
	eq(length(c.warnings), 1);
});

test('sites go to dnsmasq, and only the ones whose policy is on', () => {
	const c = nft.compile({ ...base, policies: [policy('000001', 10, { who: [client(TV)], what: { kind: 'sites', sites: ['tiktok.com'] } })], now: at(12, 0) });
	eq(c.sites, { '000001': ['tiktok.com'] });
	eq(map(c.sets, (s) => s.name), ['zeeli_c_000001', 'zeeli_s4_000001', 'zeeli_s6_000001']);
});

test('structureOf ignores what is inside policy chains and nothing else', () => {
	const night = text({ ...base, policies: [bedtime()], now: at(23, 0) }), day = text({ ...base, policies: [bedtime()], now: at(12, 0) });
	ok(night != day, 'the files differ');
	eq(nft.structureOf(night), nft.structureOf(day));
	const more = text({ ...base, policies: [bedtime(), policy('000002', 20, { who: [client(TV)] })], now: at(12, 0) });
	ok(nft.structureOf(more) != nft.structureOf(day), 'another policy is a structural change');
	const bigger = text({ ...base, groups: [{ ...kids, members: [MAYA] }], policies: [bedtime()], now: at(12, 0) });
	ok(nft.structureOf(bigger) != nft.structureOf(day), 'and so is a group’s membership');
});

test('live commands swap in each chain and the revision', () => {
	const c = nft.compile({ ...base, policies: [bedtime()], now: at(23, 0) });
	const live = nft.liveCommands(c);
	ok(index(live, 'flush chain inet fw4 zeeli_p_000001\nadd rule inet fw4 zeeli_p_000001 ether saddr @zeeli_g_a1b2c3 oifname { "eth0", "sta1" } ct direction original counter drop\n') == 0, live);
	ok(match(live, /flush chain inet fw4 zeeli_rev\nadd rule inet fw4 zeeli_rev counter comment "zeeli-rev:[0-9a-f]{8}"\n$/));
	const off = nft.compile({ ...base, policies: [bedtime()], now: at(12, 0) });
	ok(index(nft.liveCommands(off), 'flush chain inet fw4 zeeli_p_000001\nflush chain inet fw4 zeeli_rev\n') == 0);
});

test('the file carries a revision that changes with any change to it, and is the same for the same file', () => {
	const night = text({ ...base, policies: [bedtime()], now: at(23, 0) });
	const day = text({ ...base, policies: [bedtime()], now: at(12, 0) });
	ok(nft.revisionIn(night) != null && nft.revisionIn(day) != null);
	ok(nft.revisionIn(night) != nft.revisionIn(day), 'a schedule flipping changes it');
	eq(nft.revisionIn(night), nft.revisionIn(text({ ...base, policies: [bedtime()], now: at(23, 0) })));
	eq(nft.revisionIn('no chain here'), null);
	eq(nft.structureOf(night), nft.structureOf(day), 'and the revision rule is not part of the structure');
});

test('only the original direction of a connection is matched, so replies still get through', () => {
	for (let name in keys(CASES)) {
		const rules = [];
		for (let line in split(text(CASES[name]), '\n'))
			if (match(line, /counter (drop|accept)$/) && index(line, 'meta mark and') < 0) push(rules, line);
		for (let r in rules) ok(index(r, ' ct direction original counter ') > 0, `${name}: ${r}`);
	}
});

test('an uplink is not a network a policy can be for', () => {
	const c = nft.compile({ ...base, policies: [policy('000001', 10, { who: [network('wan')], what: { kind: 'everything' } })], now: at(12, 0) });
	eq(c.chains[0].rules, []);
	ok(index(c.warnings[0], 'is an uplink') > 0, c.warnings[0]);
});

test('ownedNames lists the chains and sets the file declares', () => {
	const c = nft.compile(CASES['sites']);
	eq(nft.ownedNames(c), {
		chains: ['zeeli_forward', 'zeeli_rev', 'zeeli_dns', 'zeeli_p_000002', 'zeeli_d_000002'],
		sets: ['zeeli_g_a1b2c3', 'zeeli_c_000002', 'zeeli_s4_000002', 'zeeli_s6_000002'],
	});
});

test('no policy text ever contains a name a person typed', () => {
	const sneaky = policy('000001', 10, { name: 'x" } ; flush ruleset ; #', who: [client(TV)] });
	const out = text({ ...base, policies: [sneaky], now: at(12, 0) });
	ok(index(out, 'flush ruleset') < 0 && index(out, sneaky.name) < 0, 'names stay out of the file');
});

test('the include is only sets and chains, with two base chains: forward at -1 and, for sites, DNS NAT at -101', () => {
	const out = text(CASES['sites']);
	for (let line in split(out, '\n')) {
		if (match(line, /^(\t(set|chain) zeeli_[a-z0-9_]+ \{|\t\t.*|\t\}|#.*|)$/) == null) die(`unexpected line: ${line}`);
	}
	ok(index(out, 'chain zeeli_forward {\n\t\ttype filter hook forward priority -1; policy accept;') >= 0, 'forward hook');
	ok(index(out, 'chain zeeli_dns {\n\t\ttype nat hook prerouting priority -101; policy accept;') >= 0, 'DNS hook');
	eq(length(filter(split(out, '\n'), (l) => index(l, 'hook ') >= 0)), 2, 'and no other hook');
	eq(length(filter(split(text(CASES['group-schedule-night']), '\n'), (l) => index(l, 'hook ') >= 0)), 1, 'no DNS hook without a sites policy');
});

test('a sites policy sends its devices’ DNS to dnsmasq while it applies', () => {
	const on = nft.compile(CASES['sites']), off = nft.compile({ ...CASES['sites'], now: at(12, 0), policies: [{ ...CASES['sites'].policies[0], enabled: false }] });
	eq(on.dns[0].rules, [
		'ether saddr @zeeli_g_a1b2c3 udp dport 53 redirect to :53',
		'ether saddr @zeeli_g_a1b2c3 tcp dport 53 redirect to :53',
		'ether saddr @zeeli_c_000002 udp dport 53 redirect to :53',
		'ether saddr @zeeli_c_000002 tcp dport 53 redirect to :53',
	]);
	eq(off.dns, [{ name: 'zeeli_d_000002', rules: [] }]);
	ok(index(nft.liveCommands(on), 'flush chain inet fw4 zeeli_d_000002\nadd rule inet fw4 zeeli_d_000002 ether saddr') >= 0, 'swapped live too');
	eq(nft.structureOf(nft.render(on)), nft.structureOf(nft.render(off)), 'switching it on is not a structural change');
});

test('a sites policy for a network redirects that network’s DNS', () => {
	const c = nft.compile({ ...base, policies: [policy('000007', 10, { who: [network('guest')], what: { kind: 'sites', sites: ['tiktok.com'] } })], now: at(12, 0) });
	eq(c.dns[0].rules, ['iifname { "br-guest" } udp dport 53 redirect to :53', 'iifname { "br-guest" } tcp dport 53 redirect to :53']);
});

/* ---------- route through ---------- */

const route = (name, more) => nft.compile({ ...CASES[name], ...(more ?? {}) });

test('a route policy marks its devices’ packets: GL’s mark for a tunnel, plus its own slot', () => {
	const c = route('route-vpn-block');
	eq(c.routes, [{ name: 'zeeli_p_000007', rules: ['ether saddr @zeeli_c_000007 fib daddr type != { local, broadcast, multicast } meta mark and 0x0f000000 == 0x00000000 counter meta mark set meta mark or 0x01001000'] }]);
	eq(c.chains, [], 'and nothing in the forward chains');
	eq(c.blocked, [], 'a route blocks nobody');
	eq(c.routed, { [TV]: 'vpn:10101/block' });
	eq(c.uplinks, [], 'a tunnel needs no table of ours: GL has one');
});

test('an uplink gets a table and ip rules for its slot, only while its policy applies', () => {
	const night = route('route-uplink-night'), day = route('route-uplink-day');
	eq(night.uplinks, [{ slot: 1, mark: 0x01000000, table: 7701, dev: 'eth2', gw: '192.168.2.1', target: 'uplink:secondwan' }]);
	eq(day.uplinks, []);
	eq(night.routed, { [MAYA]: 'uplink:secondwan/normal', [LEO]: 'uplink:secondwan/normal', [TABLET]: 'uplink:secondwan/normal' });
	eq(day.routed, {});
	eq(night.routes[0].rules[0], 'ether saddr @zeeli_g_a1b2c3 fib daddr type != { local, broadcast, multicast } meta mark and 0x0f000000 == 0x00000000 counter meta mark set meta mark or 0x01000000');
	eq(day.routes, [{ name: 'zeeli_p_000008', rules: [] }], 'its chain stays, empty');
	eq(nft.structureOf(nft.render(night)), nft.structureOf(nft.render(day)), 'a schedule flipping is a live change');
});

test('a mark means the same thing whether or not its policy applies', () => {
	const slotOf = (c, id) => match(filter(c.routes, (ch) => ch.name == `zeeli_p_${id}`)[0].rules[0] ?? '', /or 0x0([0-9a-f])/)?.[1];
	const night = route('route-sites-and-order'), day = route('route-sites-and-order', { now: at(12, 0) });
	eq([slotOf(night, '000007'), slotOf(night, '000009')], ['2', '3']);
	eq([slotOf(day, '000007'), slotOf(day, '000009')], ['2', '3'], 'the night-time policy (slot 1) being off changes nothing');
});

test('the first route policy to cover a device wins, and a drop that keeps traffic in goes ahead of every policy', () => {
	const out = text(CASES['route-sites-and-order']);
	ok(index(out, 'chain zeeli_forward {\n\t\ttype filter hook forward priority -1; policy accept;\n\t\tjump zeeli_k_000007\n\t\tjump zeeli_k_000008\n\t\tjump zeeli_k_000009\n\t\tjump zeeli_p_000001\n') >= 0, 'drops first');
	ok(index(out, 'chain zeeli_route {\n\t\ttype filter hook prerouting priority -151; policy accept;\n\t\tjump zeeli_p_000007\n') >= 0, 'marks in order');
	const c = nft.compile(CASES['route-sites-and-order']);
	eq(c.routed[TV], 'vpn:10101/block', 'the TV’s first route policy decides the report');
	eq(c.blocked, [MAYA, LEO, TABLET], 'a block elsewhere in the list still applies to routed devices');
});

test('fallback: block marks even while the target is down and drops what would leave another way; normal marks nothing', () => {
	const c = nft.compile(CASES['route-target-down']);
	eq(length(c.routes[0].rules), 1, 'block keeps marking, so GL’s table or the drop catches it');
	eq(c.routes[1].rules, [], 'normal falls back to the normal route');
	eq(c.routes[2].rules, []);
	eq(c.kills[0].rules, ['meta mark and 0x0f000000 == 0x02000000 oifname { "eth0", "eth2", "sta1" } counter drop']);
	eq(c.uplinks, [], 'an uplink that is down gets no table');
	eq(c.routed, { [TV]: 'vpn:10101/block' });
});

test('the drop leaves out the target’s own device and nothing that isn’t internet-facing', () => {
	const c = route('route-vpn-block', { zones: { ...CASES['route-vpn-block'].zones, lan: ['br-lan'] } });
	eq(c.kills[0].rules, ['meta mark and 0x0f000000 == 0x01000000 oifname { "eth0", "eth2", "sta1" } counter drop']);
	const eth2 = route('route-uplink-night', { policies: [{ ...CASES['route-uplink-night'].policies[0], action: via('uplink:secondwan', 'block') }] });
	eq(eth2.kills[0].rules, ['meta mark and 0x0f000000 == 0x01000000 oifname { "eth0", "sta1", "wgclient1" } counter drop']);
});

test('a target the router no longer has: block cuts the devices off, normal does nothing, and both say so', () => {
	const block = route('route-vpn-block', { targets: {} }), normal = route('route-vpn-block', { targets: {}, policies: [{ ...CASES['route-vpn-block'].policies[0], action: via('vpn:10101', 'normal') }] });
	eq(block.routes[0].rules, ['ether saddr @zeeli_c_000007 fib daddr type != { local, broadcast, multicast } meta mark and 0x0f000000 == 0x00000000 counter meta mark set meta mark or 0x01000000']);
	eq(length(block.kills[0].rules), 1);
	eq(normal.routes[0].rules, []);
	eq(normal.kills[0].rules, []);
	ok(index(block.warnings[0], 'no internet') > 0 && index(normal.warnings[0], 'does nothing') > 0, `${block.warnings[0]} / ${normal.warnings[0]}`);
});

test('IPv6 on: a warning for uplink routes, which only cover IPv4', () => {
	const c = route('route-uplink-night', { ipv6: true });
	ok(index(c.warnings[0], 'IPv6') > 0, c.warnings[0]);
	eq(route('route-vpn-block', { ipv6: true }).warnings, [], 'a tunnel handles IPv6 itself');
});

test('a route policy for sites marks only traffic to the sites, and uses the DNS redirect', () => {
	const c = route('route-sites-and-order');
	eq(c.routes[2].rules[0], 'ether saddr @zeeli_c_000009 ip daddr @zeeli_s4_000009 fib daddr type != { local, broadcast, multicast } meta mark and 0x0f000000 == 0x00000000 counter meta mark set meta mark or 0x03001000');
	eq(c.sites, { '000009': ['netflix.com'] });
	eq(c.dns[0].name, 'zeeli_d_000009');
});

test('ownedNames and the live commands cover the route chains', () => {
	const c = nft.compile(CASES['route-uplink-night']);
	eq(nft.ownedNames(c).chains, ['zeeli_forward', 'zeeli_rev', 'zeeli_route', 'zeeli_p_000008', 'zeeli_k_000008']);
	const live = nft.liveCommands(c);
	ok(index(live, 'flush chain inet fw4 zeeli_p_000008\nadd rule inet fw4 zeeli_p_000008 ether saddr @zeeli_g_a1b2c3 fib daddr type') >= 0, live);
	ok(index(live, 'flush chain inet fw4 zeeli_k_000008\nflush chain inet fw4 zeeli_rev') >= 0, live);
});

test('the route hook is at -151, one ahead of GL’s mangle chains at -150', () => {
	const out = text(CASES['route-uplink-night']);
	ok(index(out, 'chain zeeli_route {\n\t\ttype filter hook prerouting priority -151; policy accept;') >= 0);
	eq(length(filter(split(out, '\n'), (l) => index(l, 'hook ') >= 0)), 2, 'and only forward besides it');
});

done();
