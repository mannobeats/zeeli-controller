// zeeli.policies: what lands in UCI and in the firewall file, what is refused, and how time
// moves them. The router is never touched: commands are recorded in `sys.calls`.
'use strict';

import { readfile, writefile } from 'fs';
import { eq, ok, test, done } from 'assert';
import { NOON, included, mac, ran, reset, sections, uci } from 'sandbox';
import * as groups from 'zeeli.groups';
import * as policies from 'zeeli.policies';
import { parseNeighbours, parseZoneDevices, sys, tick } from 'zeeli.policyapply';
import { plugin } from 'assert';
import { paths } from 'zeeli.common';

const MAYA = '02:5E:E1:10:14:C8', LEO = '02:5E:E1:17:2B:C1', TV = '02:5E:E1:31:90:F4';
const everyNight = { kind: 'schedule', days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '07:00' };

function make(fields) {
	const r = policies.create({
		name: 'Policy', who: [{ type: 'client', id: TV }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' }, ...fields
	});
	if (r.error) die(r.error);
	return r.policy;
}

const find = (id) => filter(policies.list().policies, (p) => p.id == id)[0];

function kids() {
	const r = groups.create({ name: 'Kids', kind: 'person', members: [MAYA, LEO] });
	return r.group;
}

/** Turn the clock to a time of day (Thursday, UTC) and let the 30-second loop notice. */
const clockAt = (hh, mm) => {
	sys.now = () => 1792627200 + hh * 3600 + mm * 60;
};

/* ---------- what is written ---------- */

test('create writes the policy as one UCI section', () => {
	reset();
	const g = kids();
	const p = make({
		name: 'Bedtime', who: [{ type: 'group', id: g.id }, { type: 'client', id: TV }], what: { kind: 'internet' }, when: everyNight, until: NOON + 86400, tag: 'family:1'
	});
	const s = sections('policy')[0];
	eq(s['.name'], `zeeli_p_${p.id}`);
	eq(s.zeeli, '1');
	eq([s.name, s.enabled, s.order, s.what, s.when, s.from, s.to, s.action, s.tag, s.until], ['Bedtime', '1', '10', 'internet', 'schedule', '22:00', '07:00', 'block', 'family:1', `${NOON + 86400}`]);
	eq(s.who, [`group:${g.id}`, `client:${TV}`]);
	eq(s.day, ['1', '2', '3', '4', '5', '6', '7']);
});

test('what each kind stores', () => {
	reset();
	const site = make({ what: { kind: 'sites', sites: ['TikTok.com ', 'tiktokv.com', 'tiktok.com'] } });
	eq(site.what, { kind: 'sites', sites: ['tiktok.com', 'tiktokv.com'] });
	const net = make({ what: { kind: 'network', network: 'iot' } });
	const ss = sections('policy');
	eq(ss[0].site, ['tiktok.com', 'tiktokv.com']);
	eq(ss[1].what_network, 'iot');
	eq(ss[1].site, null);
	eq(net.what, { kind: 'network', network: 'iot' });
});

test('a speed limit stores its numbers and nothing else of the other actions', () => {
	reset();
	const p = make({ what: { kind: 'everything' }, action: { kind: 'limit', down: 2.5, up: 0 } });
	eq(p.action, { kind: 'limit', down: 2.5, up: 0 });
	const s = sections('policy')[0];
	eq([s.action, s.down, s.up], ['limit', '2.5', '0']);
});

test('new policies go to the bottom of the list', () => {
	reset();
	const a = make({ name: 'A' }), b = make({ name: 'B' }), c = make({ name: 'C' });
	eq([a.order, b.order, c.order], [10, 20, 30]);
	eq(map(policies.list().policies, (p) => p.name), ['A', 'B', 'C']);
});

test('update changes only what it is given, and keeps the order', () => {
	reset();
	const p = make({ name: 'Old' });
	make({ name: 'Other' });
	eq(policies.update({ id: p.id, name: 'New' }).policy.name, 'New');
	eq(policies.update({ id: p.id, when: everyNight }).policy.when, { kind: 'schedule', days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '07:00' });
	const now = find(p.id);
	eq([now.name, now.order, now.what, now.action, now.who], ['New', 10, { kind: 'internet' }, { kind: 'block' }, [{ type: 'client', id: TV }]]);
	eq(uci(`zeeli_p_${p.id}`, 'from'), '22:00');
	eq(policies.update({ id: p.id, when: { kind: 'always' } }).policy.when, { kind: 'always' });
	eq(uci(`zeeli_p_${p.id}`, 'from'), null, 'switching back to always drops the schedule');
});

test('an end time can be set and taken off', () => {
	reset();
	const p = make({});
	eq(policies.update({ id: p.id, until: NOON + 600 }).policy.until, NOON + 600);
	eq(policies.update({ id: p.id, name: 'Renamed' }).policy.until, NOON + 600, 'untouched by other edits');
	eq(policies.update({ id: p.id, until: 0 }).policy.until, null);
	eq(uci(`zeeli_p_${p.id}`, 'until'), null);
});

test('delete removes the policy and its rules', () => {
	reset();
	const p = make({});
	eq(policies.remove({ id: p.id }).applied, 'reload');
	eq(sections('policy'), []);
	ok(index(included(), 'zeeli_p_') < 0, 'no policy chain is left');
	eq(policies.remove({ id: p.id }).error, 'That policy doesn’t exist.');
});

/* ---------- what is refused ---------- */

const refused = (fields, message) => {
	const r = policies.create({
		name: 'Policy', who: [{ type: 'client', id: TV }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' }, ...fields
	});
	eq(r.error, message, sprintf('%J', fields));
};

test('a policy needs a name and someone to apply to', () => {
	reset();
	refused({ name: '' }, 'Give the policy a name.');
	refused({ name: 7 }, 'Give the policy a name.');
	refused({ who: [] }, 'Choose who the policy is for.');
	refused({ who: 'x' }, 'Choose who the policy is for.');
	refused({ who: [{ type: 'client', id: 'zz' }] }, '“zz” isn’t a MAC address.');
	refused({ who: [{ type: 'client' }] }, 'Each entry in “who” needs a type and an id.');
	refused({ who: [{ type: 'group', id: 'abcdef' }] }, 'One of the groups in this policy doesn’t exist.');
	refused({ who: [{ type: 'network', id: 'nowhere' }] }, 'The firewall has no network called nowhere.');
	refused({ who: [{ type: 'cat', id: 'x' }] }, '“cat” isn’t something a policy can be for.');
	refused({ who: [{ type: 'network', id: 'lan"; flush ruleset; "' }] }, 'The firewall has no network called lan"; flush ruleset; ".');
	eq(sections('policy'), []);
});

test('what, when and action are checked', () => {
	reset();
	refused({ what: { kind: 'moon' } }, 'Choose what the policy covers.');
	refused({ what: { kind: 'network', network: 'nowhere' } }, 'The firewall has no network called nowhere.');
	refused({ what: { kind: 'sites', sites: [] } }, 'Add at least one site.');
	refused({ when: { kind: 'sometimes' } }, 'Choose when the policy applies.');
	refused({ when: { kind: 'schedule', days: [], from: '22:00', to: '07:00' } }, 'Choose at least one day for the schedule.');
	refused({ when: { kind: 'schedule', days: [8], from: '22:00', to: '07:00' } }, 'Days run from 1 (Monday) to 7 (Sunday).');
	refused({ when: { kind: 'schedule', days: [0], from: '22:00', to: '07:00' } }, 'Days run from 1 (Monday) to 7 (Sunday).');
	refused({ when: { kind: 'schedule', days: [1], from: '25:00', to: '07:00' } }, 'Times look like 22:00.');
	refused({ when: { kind: 'schedule', days: [1], from: '22:00', to: 'late' } }, 'Times look like 22:00.');
	refused({ action: { kind: 'explode' } }, 'Choose what the policy does.');
});

test('sites must be bare domains', () => {
	reset();
	for (let bad in ['https://tiktok.com', 'tiktok.com/path', '*.tiktok.com', 'tiktok', 'tik tok.com', 'tiktok.com;reboot', '-bad.com', 'a..com', '1.2.3.4', 'tiktok.c', '', 5, 'x.com\nflush'])
		refused({ what: { kind: 'sites', sites: [bad] } }, `“${bad}” isn’t a site. Use just the domain, like tiktok.com. Subdomains are included.`);
	ok(policies.create({ name: 'ok', who: [{ type: 'client', id: TV }], what: { kind: 'sites', sites: ['xn--80ak6aa92e.com', 'a.b.example.co.uk'] }, when: { kind: 'always' }, action: { kind: 'block' } }).policy);
});

test('speed limits have sensible numbers and a sensible target', () => {
	reset();
	const bad = (action, message, more) => {
		const r = policies.create({ name: 'L', who: [{ type: 'client', id: TV }], what: { kind: 'everything' }, when: { kind: 'always' }, action, ...(more ?? {}) });
		eq(r.error, message, sprintf('%J', action));
	};
	bad({ kind: 'limit', down: 0, up: 0 }, 'Enter a download or an upload limit.');
	bad({ kind: 'limit' }, 'Enter a download or an upload limit.');
	bad({ kind: 'limit', down: -1, up: 1 }, 'A speed limit is between 0 and 10000 Mbps.');
	bad({ kind: 'limit', down: 10001, up: 1 }, 'A speed limit is between 0 and 10000 Mbps.');
	bad({ kind: 'limit', down: 'fast', up: 1 }, 'A speed limit is between 0 and 10000 Mbps.');
	bad({ kind: 'limit', down: 5, up: 1 }, 'A speed limit covers all of a device’s traffic, not one site or network.', { what: { kind: 'sites', sites: ['a.com'] } });
	bad({ kind: 'limit', down: 5, up: 1 }, 'A speed limit is set per device, so it can’t be for a whole network.', { who: [{ type: 'network', id: 'guest' }] });
});

test('an end time in the past is refused', () => {
	reset();
	refused({ until: NOON - 1 }, 'That time has already passed.');
	refused({ until: -5 }, 'That end time isn’t valid.');
	refused({ until: 'soon' }, 'That end time isn’t valid.');
});

test('the label is plain text', () => {
	reset();
	refused({ tag: 'family:1; reboot' }, 'That label isn’t valid.');
});

test('there are up to 128 policies, and up to 32 people, groups and networks in one', () => {
	reset();
	for (let i = 0; i < 128; i++) make({ name: `P${i}` });
	refused({}, 'You can have up to 128 policies.');
	reset();
	const many = [];
	for (let i = 0; i < 33; i++) push(many, { type: 'client', id: mac(i) });
	refused({ who: many }, 'A policy can name up to 32 devices, groups or networks.');
	const sites = [];
	for (let i = 0; i < 51; i++) push(sites, `site${i}.com`);
	refused({ what: { kind: 'sites', sites } }, 'A policy can name up to 50 sites.');
});

/* ---------- reaching the firewall ---------- */

test('a new policy is checked, written to the include and loaded', () => {
	reset();
	const p = make({ who: [{ type: 'client', id: TV }] });
	ok(index(included(), `chain zeeli_p_${p.id} {\n\t\tether saddr @zeeli_c_${p.id} oifname { "eth0", "sta1" } counter drop\n\t}`) >= 0, included());
	const check = ran('nft')[0];
	ok(match(check, /^nft -c -f .*policies\.check\.nft$/), check);
	eq(ran('reload'), ['reload firewall']);
	const inc = sections('include', 'firewall');
	const mine = filter(inc, (s) => s['.name'] == 'zeeli_policies')[0];
	eq([mine.zeeli, mine.enabled, mine.type, mine.position], ['1', '1', 'nftables', 'table-prepend']);
	eq(mine.path, paths.state + '/include/policies.nft');
});

test('the check sees the whole include in a scratch table', () => {
	reset();
	let seen = null;
	sys.answer = (argv) => {
		if (argv[0] == 'nft' && argv[1] == '-c') seen = readfile(argv[3]);
		return { code: 0, stdout: '' };
	};
	make({});
	ok(index(seen, 'table inet zeeli_check {\n') == 0, seen);
	ok(index(seen, 'chain zeeli_forward {') > 0, 'the whole include is in it');
	ok(index(seen, '$') < 0, 'with no fw4 defines to depend on');
});

test('when the firewall would refuse the file, nothing changes and the old file stays', () => {
	reset();
	const a = make({ name: 'First' });
	const before = included();
	sys.calls = [];
	sys.answer = (argv) => (argv[0] == 'nft' && argv[1] == '-c' ? { code: 1, stdout: 'Error: syntax error, unexpected foo\nmore' } : { code: 0, stdout: '' });
	const r = policies.create({ name: 'Second', who: [{ type: 'client', id: LEO }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' } });
	eq(r.error, 'The firewall wouldn’t take these policies (Error: syntax error, unexpected foo), so nothing was changed.');
	eq(included(), before, 'the file is untouched');
	eq(length(sections('policy')), 1, 'and so is the config');
	eq(ran('reload'), [], 'the firewall wasn’t reloaded');
	eq(map(policies.list().policies, (p) => p.id), [a.id]);
});

test('switching a policy off or on only swaps rules on the running firewall', () => {
	reset();
	const p = make({});
	sys.calls = [];
	eq(policies.update({ id: p.id, enabled: false }).applied, 'live');
	eq(ran('reload'), [], 'no reload');
	const live = ran('nft');
	eq(length(live), 3, 'is it loaded, check the new file, then the swap');
	ok(match(live[2], /^nft -f .*policies\.live\.nft$/), live[2]);
	eq(find(p.id).enabled, false);
	ok(index(included(), 'counter drop') < 0, 'rules are gone from the file too');
	eq(policies.update({ id: p.id, enabled: true }).applied, 'live');
	ok(index(included(), 'counter drop') > 0);
});

test('the live swap carries the same rules as the file', () => {
	reset();
	const p = make({});
	let sent = null;
	sys.answer = (argv) => {
		if (argv[0] == 'nft' && argv[1] == '-f') sent = readfile(argv[2]);
		return { code: 0, stdout: '' };
	};
	policies.update({ id: p.id, enabled: false });
	policies.update({ id: p.id, enabled: true });
	eq(sent, `flush chain inet fw4 zeeli_p_${p.id}\nadd rule inet fw4 zeeli_p_${p.id} ether saddr @zeeli_c_${p.id} oifname { "eth0", "sta1" } counter drop\n`);
});

test('a network whose devices change is a live change, noticed by the loop', () => {
	reset();
	const p = make({});
	sys.zoneDevices = () => ({ lan: ['br-lan'], guest: ['br-guest'], iot: ['br-iot'], wan: ['eth1'] });
	sys.calls = [];
	eq(tick().applied, 'live');
	ok(index(included(), 'oifname { "eth1" }') > 0, included());
	ok(index(included(), 'sta1') < 0);
	eq(ran('reload'), []);
});

test('a policy for a network the firewall has no devices for does nothing and warns', () => {
	reset();
	sys.zoneDevices = () => ({ lan: ['br-lan'] });
	const r = policies.create({ name: 'X', who: [{ type: 'client', id: TV }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' } });
	eq(r.applied, 'reload');
	ok(index(included(), 'counter drop') < 0, 'no rule without a device to match');
});

test('zones that are switched off are not networks a policy can name', () => {
	reset();
	writefile(`${paths.confdir}/firewall`, `${readfile(`${paths.confdir}/firewall`)}\nconfig zone\n\toption name 'off1'\n\toption enabled '0'\n`);
	eq(policies.create({ name: 'X', who: [{ type: 'network', id: 'off1' }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' } }).error, 'The firewall has no network called off1.');
});

test('if the firewall comes back without our chain, the previous file is put back', () => {
	reset();
	const a = make({ name: 'First' });
	const before = included();
	sys.calls = [];
	let reloads = 0;
	sys.reload = function(name) {
		reloads++;
		push(this.calls, ['reload', name]);
	};
	sys.answer = (argv) => (argv[0] == 'nft' && argv[1] == 'list' && reloads == 1 ? { code: 1, stdout: 'No such file or directory' } : { code: 0, stdout: '' });
	const r = policies.create({ name: 'Second', who: [{ type: 'client', id: LEO }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' } });
	eq(r.error, 'The firewall didn’t load the policies, so they were rolled back. Check the system log for what it said.');
	eq(included(), before, 'the old file is back');
	eq(reloads, 2, 'and the firewall was reloaded with it');
	eq(map(policies.list().policies, (p) => p.id), [a.id], 'the new policy was not kept');
});

test('a live swap the firewall refuses falls back to a reload', () => {
	reset();
	const p = make({});
	sys.calls = [];
	sys.answer = (argv) => (argv[0] == 'nft' && argv[1] == '-f' ? { code: 1, stdout: 'Error' } : { code: 0, stdout: '' });
	eq(policies.update({ id: p.id, enabled: false }).applied, 'reload');
	eq(ran('reload'), ['reload firewall']);
});

test('nothing runs when a change leaves the firewall file as it was', () => {
	reset();
	const p = make({ what: { kind: 'everything' }, action: { kind: 'limit', down: 5, up: 1 } });
	const before = included();
	eq(policies.update({ id: p.id, name: 'Slow TV' }).applied, 'none');
	eq(included(), before);
});

test('the firewall is reloaded if our chain isn’t in it, e.g. after it restarted without the include', () => {
	reset();
	make({});
	sys.calls = [];
	let reloaded = false;
	sys.reload = function(name) {
		reloaded = true;
		push(this.calls, ['reload', name]);
	};
	sys.answer = (argv) => (argv[0] == 'nft' && argv[1] == 'list' && !reloaded ? { code: 1, stdout: 'No such file or directory' } : { code: 0, stdout: '' });
	eq(tick().applied, 'reload');
	eq(ran('reload'), ['reload firewall']);
});

test('a file the firewall can’t load is not tried again every 30 seconds', () => {
	reset();
	make({});
	sys.calls = [];
	sys.answer = (argv) => (argv[0] == 'nft' && argv[1] == 'list' ? { code: 1, stdout: 'No such file or directory' } : { code: 0, stdout: '' });
	ok(match(tick().error, /rolled back/));
	eq(length(ran('reload')), 2, 'one reload to try, one to go back');
	sys.calls = [];
	ok(match(tick().error, /waiting before it tries again/));
	eq(ran('reload'), [], 'nothing more for ten minutes');
	sys.now = () => NOON + 601;
	ok(match(tick().error, /rolled back/));
	eq(length(ran('reload')), 2, 'then once more');
});

test('with no policies at all, the agent leaves the firewall alone', () => {
	reset();
	eq(tick().applied, 'none');
	eq(ran(), []);
	eq(included(), null);
});

/* ---------- order, pauses and time ---------- */

test('reorder puts policies in the order sent, and refuses a list that doesn’t make sense', () => {
	reset();
	const a = make({ name: 'A' }), b = make({ name: 'B' }), c = make({ name: 'C' });
	eq(policies.reorder({ ids: [c.id, a.id, b.id] }).applied, 'reload');
	eq(map(policies.list().policies, (p) => p.name), ['C', 'A', 'B']);
	eq(map(policies.list().policies, (p) => p.order), [10, 20, 30]);
	const text = included();
	ok(index(text, `jump zeeli_p_${c.id}\n\t\tjump zeeli_p_${a.id}\n\t\tjump zeeli_p_${b.id}`) > 0, 'jumps follow the order');
	policies.reorder({ ids: [b.id] });
	eq(map(policies.list().policies, (p) => p.name), ['B', 'C', 'A'], 'unnamed policies follow');
	eq(policies.reorder({ ids: [a.id, a.id] }).error, 'That order names a policy twice or one that doesn’t exist.');
	eq(policies.reorder({ ids: ['ffffff'] }).error, 'That order names a policy twice or one that doesn’t exist.');
	eq(policies.reorder({ ids: 'x' }).error, 'Send the policies in the order you want.');
});

test('an allow above a block is an exception to it', () => {
	reset();
	const g = kids();
	make({ name: 'Bedtime', who: [{ type: 'group', id: g.id }], when: everyNight });
	const ok_ = make({ name: 'Leo may stay up', who: [{ type: 'client', id: LEO }], action: { kind: 'allow' } });
	policies.reorder({ ids: [ok_.id] });
	const jumps = filter(split(included(), '\n'), (l) => match(l, /^\t\tjump /));
	eq(length(jumps), 2);
	eq(jumps[0], `\t\tjump zeeli_p_${ok_.id}`);
});

test('pause blocks for a while and says when it ends', () => {
	reset();
	const r = policies.pause({ who: [{ type: 'client', id: TV }], minutes: 60, name: 'Pause TV' });
	eq(r.policy.until, NOON + 3600);
	eq([r.policy.name, r.policy.what, r.policy.when, r.policy.action, r.policy.active], ['Pause TV', { kind: 'internet' }, { kind: 'always' }, { kind: 'block' }, true]);
	eq(find(r.policy.id).active, true);
});

test('pause lengths are limited', () => {
	reset();
	for (let m in [0, -5, 10081, 'x', 1.5, null])
		eq(policies.pause({ who: [{ type: 'client', id: TV }], minutes: m }).error, 'A pause lasts from 1 minute to 7 days.');
	eq(policies.pause({ who: [], minutes: 5 }).error, 'Choose who the policy is for.');
});

test('pausing again with the same tag restarts the timer instead of stacking', () => {
	reset();
	policies.pause({ who: [{ type: 'client', id: TV }], minutes: 15, tag: 'family:2' });
	clockAt(12, 5);
	const second = policies.pause({ who: [{ type: 'client', id: TV }], minutes: 60, tag: 'family:2' });
	eq(length(sections('policy')), 1);
	eq(second.policy.until, 1792627200 + 12 * 3600 + 5 * 60 + 3600);
});

test('a pause stops applying at its end time, and then goes away, with nobody calling', () => {
	reset();
	const p = policies.pause({ who: [{ type: 'client', id: TV }], minutes: 60, name: 'Pause TV' }).policy;
	ok(index(included(), 'counter drop') > 0);
	clockAt(12, 59);
	eq(tick().applied, 'none', 'still running at 12:59');
	sys.calls = [];
	clockAt(13, 0);
	const r = tick();
	eq(sections('policy'), [], 'removed from the config');
	ok(index(included(), 'counter drop') < 0, 'and from the firewall file');
	eq(r.applied, 'reload', 'the tidy-up reloads');
	const swap = filter(ran('nft'), (c) => match(c, /^nft -f /));
	eq(length(swap), 1, 'but first the rules were swapped out on the running firewall');
	eq(find(p.id), null);
});

test('a listed policy that has expired is already gone', () => {
	reset();
	const p = policies.pause({ who: [{ type: 'client', id: TV }], minutes: 5 }).policy;
	clockAt(12, 6);
	eq(find(p.id), null);
});

test('a schedule starts and ends by itself as the clock moves', () => {
	reset();
	const g = kids();
	const p = make({ name: 'Bedtime', who: [{ type: 'group', id: g.id }], when: everyNight });
	eq(find(p.id).active, false, 'noon');
	clockAt(21, 59);
	eq(tick().applied, 'none');
	clockAt(22, 0);
	sys.calls = [];
	eq(tick().applied, 'live');
	eq(find(p.id).active, true);
	eq(ran('reload'), []);
	ok(index(included(), 'counter drop') > 0);
	clockAt(24 + 6, 59);
	eq(tick().applied, 'none');
	clockAt(24 + 7, 0);
	eq(tick().applied, 'live');
	eq(find(p.id).active, false);
});

test('the schedule follows the router’s time zone, not UTC', () => {
	reset();
	const p = make({ name: 'Bedtime', who: [{ type: 'client', id: TV }], when: everyNight });
	// pretend the router is five hours behind UTC: 03:00 UTC is 22:00 on the router
	sys.breakdown = (ts) => gmtime(ts - 5 * 3600);
	clockAt(3, 0);
	eq(find(p.id).active, true);
	clockAt(12, 0);
	eq(find(p.id).active, false);
});

/* ---------- blocked devices lose their open connections ---------- */

test('a device that becomes blocked has its connections ended, once', () => {
	reset();
	sys.neighbours = () => ({ '02:5e:e1:31:90:f4': ['192.168.8.30', 'fd00::30'] });
	const p = make({ who: [{ type: 'client', id: TV }] });
	eq(ran('conntrack'), [
		'conntrack -D -s 192.168.8.30', 'conntrack -D -r 192.168.8.30',
		'conntrack -D -f ipv6 -s fd00::30', 'conntrack -D -f ipv6 -r fd00::30',
	]);
	sys.calls = [];
	tick();
	policies.update({ id: p.id, name: 'Same device' });
	eq(ran('conntrack'), [], 'not again for a device that was already blocked');
	policies.update({ id: p.id, enabled: false });
	policies.update({ id: p.id, enabled: true });
	eq(length(ran('conntrack')), 4, 'but again when the block is lifted and comes back');
});

test('allow and limit policies end nobody’s connections', () => {
	reset();
	sys.neighbours = () => ({ '02:5e:e1:31:90:f4': ['192.168.8.30'] });
	make({ action: { kind: 'allow' } });
	make({ what: { kind: 'everything' }, action: { kind: 'limit', down: 1, up: 1 } });
	eq(ran('conntrack'), []);
});

/* ---------- sites, through dnsmasq ---------- */

test('sites become dnsmasq ipset entries and dnsmasq reloads once', () => {
	reset();
	const p = make({ what: { kind: 'sites', sites: ['tiktok.com', 'tiktokv.com'] } });
	const s = sections('ipset', 'dhcp');
	eq(map(s, (x) => x['.name']), [`zeeli_site4_${p.id}`, `zeeli_site6_${p.id}`]);
	eq([s[0].zeeli, s[0].family, s[0].name, s[0].domain], ['1', '4', [`zeeli_s4_${p.id}`], ['tiktok.com', 'tiktokv.com']]);
	eq([s[1].family, s[1].name], ['6', [`zeeli_s6_${p.id}`]]);
	eq(ran('reload'), ['reload firewall', 'reload dnsmasq']);
	sys.calls = [];
	policies.update({ id: p.id, name: 'Renamed' });
	eq(ran('reload'), [], 'no reload when the domains didn’t change');
});

test('changing and deleting sites updates dnsmasq, and leaves its own entries alone', () => {
	reset();
	const before = length(sections('ipset', 'dhcp'));
	const p = make({ what: { kind: 'sites', sites: ['tiktok.com'] } });
	policies.update({ id: p.id, what: { kind: 'sites', sites: ['instagram.com'] } });
	eq(sections('ipset', 'dhcp')[0].domain, ['instagram.com']);
	policies.remove({ id: p.id });
	eq(length(sections('ipset', 'dhcp')), before);
	ok(index(join(',', ran('reload')), 'dnsmasq') >= 0);
});

test('the agent looks the domains up itself so the sets fill even when AdGuard answers the devices', () => {
	reset();
	make({ what: { kind: 'sites', sites: ['tiktok.com', 'tiktokv.com'] } });
	sys.calls = [];
	tick();
	eq(ran('nslookup'), ['nslookup tiktok.com 127.0.0.1', 'nslookup tiktokv.com 127.0.0.1']);
});

test('domains of a policy that isn’t on are not looked up', () => {
	reset();
	make({ what: { kind: 'sites', sites: ['tiktok.com'] }, when: everyNight });
	sys.calls = [];
	tick();
	eq(ran('nslookup'), []);
});

/* ---------- speed limits, through gl_eqos ---------- */

test('a limit is handed to the firmware’s gl_eqos in KiB per second', () => {
	reset();
	sys.answer = (argv) => (argv[0] == 'tc' ? { code: 0, stdout: 'class htb 1:1 root' } : { code: 0, stdout: '' });
	make({ what: { kind: 'everything' }, action: { kind: 'limit', down: 5, up: 1 } });
	eq(ran('/usr/bin/gl_eqos'), ['/usr/bin/gl_eqos add 02:5E:E1:31:90:F4 610 122']);
	eq(uci('zeeli_applied', 'limit'), ['02:5e:e1:31:90:f4=610=122']);
});

test('the first limit starts the firmware’s queue', () => {
	reset();
	sys.answer = (argv) => ({ code: 0, stdout: '' });
	make({ what: { kind: 'everything' }, action: { kind: 'limit', down: 5, up: 0 } });
	eq(ran('/usr/bin/gl_eqos'), ['/usr/bin/gl_eqos start 312500 312500', '/usr/bin/gl_eqos add 02:5E:E1:31:90:F4 610 0']);
});

test('changing a limit replaces it, removing the policy removes only the limit the agent set', () => {
	reset();
	sys.answer = (argv) => (argv[0] == 'tc' ? { code: 0, stdout: 'class' } : { code: 0, stdout: '' });
	const p = make({ what: { kind: 'everything' }, action: { kind: 'limit', down: 5, up: 1 } });
	sys.calls = [];
	policies.update({ id: p.id, action: { kind: 'limit', down: 10, up: 2 } });
	eq(ran('/usr/bin/gl_eqos'), ['/usr/bin/gl_eqos del 02:5E:E1:31:90:F4', '/usr/bin/gl_eqos add 02:5E:E1:31:90:F4 1221 244']);
	sys.calls = [];
	policies.remove({ id: p.id });
	eq(ran('/usr/bin/gl_eqos'), ['/usr/bin/gl_eqos del 02:5E:E1:31:90:F4']);
	eq(uci('zeeli_applied', 'limit'), null);
});

test('a limit on a schedule is set when it starts and removed when it ends', () => {
	reset();
	sys.answer = (argv) => (argv[0] == 'tc' ? { code: 0, stdout: 'class' } : { code: 0, stdout: '' });
	make({ what: { kind: 'everything' }, when: everyNight, action: { kind: 'limit', down: 1, up: 1 } });
	eq(ran('/usr/bin/gl_eqos'), []);
	clockAt(22, 0);
	tick();
	eq(length(ran('/usr/bin/gl_eqos')), 1);
	clockAt(31, 0);
	tick();
	eq(ran('/usr/bin/gl_eqos')[1], '/usr/bin/gl_eqos del 02:5E:E1:31:90:F4');
});

test('a limit someone set by hand in the firmware is left alone', () => {
	reset();
	sys.answer = (argv) => ({ code: 0, stdout: 'class' });
	const mine = '02:5E:E1:31:90:F4';
	// the firmware names a device's queue after its MAC without colons
	writefile(`${paths.confdir}/qos`, "config queue '025EE13190F4'\n\toption mac '02:5E:E1:31:90:F4'\n\toption upload '100'\n\toption download '100'\n");
	const r = policies.create({ name: 'Slow', who: [{ type: 'client', id: mine }], what: { kind: 'everything' }, when: { kind: 'always' }, action: { kind: 'limit', down: 1, up: 1 } });
	eq(r.warnings, ['02:5E:E1:31:90:F4 already has a speed limit set on its own, so the policy leaves it alone.']);
	eq(ran('/usr/bin/gl_eqos'), []);
});

/* ---------- reading what the router knows ---------- */

test('neighbours: addresses by MAC from arp and ip -6 neigh, skipping entries nobody answered', () => {
	const arp = join('\n', [
		'IP address       HW type     Flags       HW address            Mask     Device',
		'192.168.1.75     0x1         0x0         00:00:00:00:00:00     *        sta1',
		'10.0.10.222      0x1         0x2         0E:DE:5B:D4:22:BB     *        br-lan',
		'10.0.10.223      0x1         0x6         0e:de:5b:d4:22:bb     *        br-lan'
	]);
	const six = 'fd00::30 dev br-lan lladdr 0e:de:5b:d4:22:bb router STALE\nfe80::1 dev br-lan  FAILED\n';
	eq(parseNeighbours(arp, six), { '0e:de:5b:d4:22:bb': ['10.0.10.222', '10.0.10.223', 'fd00::30'] });
	eq(parseNeighbours('', ''), {});
});

test('zone devices come from fw4’s state file', () => {
	eq(parseZoneDevices('{ "zones": [ { "name": "lan", "match_devices": [ "br-lan" ] }, { "name": "wan", "match_devices": [ "eth0", "sta1" ] }, { "name": "x" } ] }'), { lan: ['br-lan'], wan: ['eth0', 'sta1'], x: [] });
	eq(parseZoneDevices(''), {});
	eq(parseZoneDevices('not json'), {});
});

test('rpcd reaches the same calls, with every argument declared', () => {
	reset();
	const pol = plugin('policies')['zeeli.policies'], grp = plugin('groups')['zeeli.groups'];
	for (let key in ['name', 'enabled', 'who', 'what', 'when', 'until', 'action', 'tag']) {
		ok(exists(pol.create.args, key), `create declares ${key}`);
		ok(exists(pol.update.args, key), `update declares ${key}`);
	}
	eq(sort(keys(pol.pause.args)), ['minutes', 'name', 'tag', 'what', 'who']);
	eq(sort(keys(grp.update.args)), ['id', 'kind', 'members', 'name']);
	const g = grp.create.call({ args: { name: 'Kids', kind: 'person', members: [MAYA] } }).group;
	const p = pol.create.call({ args: { name: 'Bedtime', who: [{ type: 'group', id: g.id }], what: { kind: 'internet' }, when: everyNight, action: { kind: 'block' } } }).policy;
	eq(pol.list.call({ args: {} }).policies[0].id, p.id);
	eq(pol.delete.call({ args: { id: p.id } }), { applied: 'reload', warnings: [] });
	eq(grp.delete.call({ args: { id: g.id } }).affected, 0);
});

/* ---------- reading ---------- */

test('list shows which policies apply now and what the clock says', () => {
	reset();
	const g = kids();
	const night = make({ name: 'Bedtime', who: [{ type: 'group', id: g.id }], when: everyNight });
	const always = make({ name: 'Always' });
	const l = policies.list();
	eq(l.now, NOON);
	eq(map(l.policies, (p) => [p.name, p.active]), [['Bedtime', false], ['Always', true]]);
	eq(find(night.id).when, { kind: 'schedule', days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '07:00' });
	eq(find(always.id).when, { kind: 'always' }, 'a policy shows only the fields that matter for its kind');
	eq(find(always.id).action, { kind: 'block' });
});

test('status tells what the router is doing', () => {
	reset();
	make({});
	const s = policies.status();
	eq([s.included, s.file, s.inSync, s.loaded], [true, true, true, true]);
	eq(length(s.active), 1);
	ok(s.now == NOON);
});

test('apply reconciles on request', () => {
	reset();
	make({});
	sys.calls = [];
	eq(policies.apply().applied, 'none');
});

test('every write goes through a lock that is gone afterwards', () => {
	reset();
	make({});
	eq(readfile(`${paths.state}/policies.lock`), null);
	ok(policies.list().policies);
});

done();
