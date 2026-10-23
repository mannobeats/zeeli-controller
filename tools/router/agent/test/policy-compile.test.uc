// The policy compiler: schedules, expiry, who/what/when/action, and golden nft output. The
// golden files in test/golden are complete `nft -c -f` inputs; check them on a router with
//   nft -c -f /tmp/zeeli-golden/<name>.nft
'use strict';

import { readfile } from 'fs';
import { eq, ok, test, done } from 'assert';
import { CASES, ZONES, at, base, client, everyNight, group, kids, network, policy, MAYA, LEO, TABLET, TV } from 'cases';
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
		'ether saddr @zeeli_c_000001 oifname { "eth0", "sta1" } counter drop',
		'ether saddr @zeeli_c_000001 oifname { "wgclient" } counter drop',
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

test('live commands swap in each chain', () => {
	const c = nft.compile({ ...base, policies: [bedtime()], now: at(23, 0) });
	eq(nft.liveCommands(c),
		'flush chain inet fw4 zeeli_p_000001\n' +
		'add rule inet fw4 zeeli_p_000001 ether saddr @zeeli_g_a1b2c3 oifname { "eth0", "sta1" } counter drop\n');
	const off = nft.compile({ ...base, policies: [bedtime()], now: at(12, 0) });
	eq(nft.liveCommands(off), 'flush chain inet fw4 zeeli_p_000001\n');
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

done();
