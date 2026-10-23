'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { cursor, paths, services } from 'zeeli.common';
import * as fw from 'zeeli.firewall';
import * as rollback from 'zeeli.rollback';
import * as snapshots from 'zeeli.snapshots';
import { lsdir, readfile, stat, writefile } from 'fs';

// The lib modules imported here are the ones these direct calls use; rpcd plugins loaded through
// plugin() get their own copies, which is fine for checking arguments but not for these hooks.
const reloaded = [];
services.reload = (name) => push(reloaded, name);
const timers = [];
rollback.timer.start = (token, seconds) => push(timers, [token, seconds]);

const rpc = plugin('firewall')['zeeli.firewall'];
const call = (method, args) => rpc[method].call({ args });

const all = () => cursor().get_all('firewall');
const named = (kind, name) => filter(map(keys(all()), (k) => all()[k]), (s) => s['.type'] == kind && s.name == name)[0];
const order = () => map(filter(map(keys(all()), (k) => all()[k]), (s) => s['.type'] == 'rule'), (r) => r.name ?? r['.name']);
const rule = (name) => filter(fw.rules().rules, (r) => r.name == name)[0];
const file = () => readfile(`${paths.confdir}/firewall`);

/** A write finished and is waiting: confirm it so the next test can write. */
function keep(r) {
	ok(!r.error, r.error);
	eq(rollback.confirm(r.token).state, 'confirmed');
	return r;
}

test('zones list their policies, networks and who owns them', () => {
	const z = fw.zones().zones;
	eq(map(z, (x) => x.name), ['lan', 'wan', 'guest', 'tailscale0', 'iot']);
	eq(filter(z, (x) => x.name == 'wan')[0], {
		name: 'wan', input: 'DROP', output: 'ACCEPT', forward: 'REJECT', masquerade: true, mssClamp: true,
		networks: ['wan', 'wan6', 'wwan', 'secondwan'], owner: 'custom', editable: true,
	});
	eq(filter(z, (x) => x.name == 'tailscale0')[0].editable, false);
});

test('a zone change snapshots, writes, reloads the firewall and hands back a token', () => {
	const before = file();
	const r = fw.zone_update({ name: 'guest', input: 'ACCEPT', forward: 'DROP', masquerade: true, mssClamp: true });
	ok(!r.error, r.error);
	const z = named('zone', 'guest');
	eq([z.input, z.forward, z.masq, z.mtu_fix, z.output], ['ACCEPT', 'DROP', '1', '1', 'ACCEPT']);
	eq(reloaded, ['firewall']);
	eq(r.seconds, 30);
	eq(timers[0], [r.token, 30]);
	ok(stat(`${paths.state}/rollback/${r.token}.pending`), 'a change is waiting');
	const snap = snapshots.list()[0];
	eq(snap.reason, 'Before changing a firewall zone');
	eq(readfile(`${paths.state}/snapshots/${snap.id}/config/firewall`), before);
	eq(snap.configs, ['firewall']);
	keep(r);
	keep(fw.zone_update({ name: 'guest', masquerade: false, mssClamp: false, input: 'REJECT', forward: 'REJECT' }));
	eq(named('zone', 'guest').masq, null);
});

function pendingToken() {
	for (let n in lsdir(`${paths.state}/rollback`) ?? []) {
		const m = match(n, /^([0-9a-f]{16})\.pending$/);
		if (m) return m[1];
	}
}

test('attached networks move between zones only when free', () => {
	const r = fw.zone_update({ name: 'guest', networks: ['guest', 'iot'] });
	ok(r.error != null, 'iot is in the iot zone');
	eq(r.error, 'iot is already in the iot zone. Take it out of there first.');
	keep(fw.zone_update({ name: 'iot', networks: [] }));
	eq(named('zone', 'iot').network, null);
	keep(fw.zone_update({ name: 'guest', networks: ['guest', 'iot'] }));
	eq(named('zone', 'guest').network, ['guest', 'iot']);
	eq(fw.zone_update({ name: 'guest', networks: ['nope'] }).error, 'There’s no network called nope.');
	eq(fw.zone_update({ name: 'guest', networks: ['bad name!'] }).error, 'There’s no network called bad name!.');
});

test('refused zone changes leave the firewall file and the rollback folder alone', () => {
	const before = file();
	const waiting = pendingToken();
	for (let t in [
		[{ name: 'tailscale0', input: 'DROP' }, 'Zones made by router services are changed from that service.'],
		[{ name: 'nothere', input: 'DROP' }, 'There’s no zone called nothere.'],
		[{ name: 'lan', input: 'MAYBE' }, 'A zone’s traffic must be allowed, rejected or dropped.'],
	])
		eq(fw.zone_update(t[0]).error, t[1]);
	eq(file(), before);
	eq(waiting, pendingToken());
	eq(call('zone_update', { name: null }), { error: 'Pick a zone.' });
});

test('a second write waits for the first to be confirmed', () => {
	const first = fw.zone_update({ name: 'lan', mssClamp: true });
	ok(!first.error, first.error);
	eq(fw.zone_update({ name: 'lan', mssClamp: false }), { error: 'A change is still waiting to be confirmed. Confirm or undo it first.' });
	keep(first);
	keep(fw.zone_update({ name: 'lan', mssClamp: false }));
});

test('forwardings: add, refuse duplicates and removal of the firmware’s', () => {
	eq(fw.forwardings().forwardings[0], { id: fw.forwardings().forwardings[0].id, src: 'lan', dest: 'wan', enabled: true, owner: 'custom', editable: true });
	eq(fw.forwarding_add({ src: 'lan', dest: 'wan' }).error, 'Those zones are already connected.');
	eq(fw.forwarding_add({ src: 'lan', dest: 'lan' }).error, 'A forwarding connects two different zones.');
	eq(fw.forwarding_add({ src: 'lan', dest: 'nope' }).error, 'Pick two zones that exist.');
	const added = keep(fw.forwarding_add({ src: 'iot', dest: 'guest' }));
	eq([all()[added.id].src, all()[added.id].dest], ['iot', 'guest']);
	eq(fw.forwarding_remove({ id: 'lan_tailscale' }).error, 'Forwardings made by router services are changed from that service.');
	eq(fw.forwarding_remove({ id: 'nothing' }).error, 'That forwarding is gone. Reload the list.');
	keep(fw.forwarding_remove({ id: added.id }));
	eq(all()[added.id], null);
});

test('a new rule is checked field by field, then written', () => {
	for (let t in [
		[{}, 'Give the rule a name of up to 64 characters.'],
		[{ name: 'x', src: 'nowhere' }, 'There’s no zone called nowhere.'],
		[{ name: 'x', dest: 'nowhere' }, 'There’s no zone called nowhere.'],
		[{ name: 'x', proto: 'gre' }, 'The protocol must be TCP, UDP, both, ICMP or any.'],
		[{ name: 'x', destPort: '99999' }, 'Ports must be 1 to 65535: 443, 8000-8010 or 80 443.'],
		[{ name: 'x', destPort: '80;reboot' }, 'Ports must be 1 to 65535: 443, 8000-8010 or 80 443.'],
		[{ name: 'x', proto: 'icmp', destPort: '80' }, 'Ports only apply to TCP or UDP.'],
		[{ name: 'x', srcIp: '300.1.1.1' }, 'The from address must be an IP address or network.'],
		[{ name: 'x', destIp: '10.0.0.0/40' }, 'The to address must be an IP address or network.'],
		[{ name: 'x', target: 'MARK' }, 'The action must be allow, reject or drop.'],
		[{ name: 'x', family: 'ipv5' }, 'The IP version must be IPv4, IPv6 or both.'],
	])
		eq(fw.rule_add(t[0]).error, t[1], sprintf('%J', t[0]));
	const r = keep(fw.rule_add({ name: 'Game server', src: 'wan', dest: 'lan', proto: 'udp', destPort: '27015 27016', destIp: '192.168.8.20', target: 'ACCEPT' }));
	const s = all()[r.id];
	eq([s.name, s.src, s.dest, s.proto, s.dest_port, s.dest_ip, s.target, s.enabled], ['Game server', 'wan', 'lan', 'udp', '27015 27016', '192.168.8.20', 'ACCEPT', '1']);
	eq(rule('Game server').owner, 'custom');
	eq(order()[length(order()) - 1], 'Game server');
});

test('rule updates change what was given, clear what is blank and refuse a stale list', () => {
	const r = rule('Game server');
	eq(fw.rule_update({ id: r.id, current: 'Someone else’s rule', target: 'DROP' }).error, 'The firewall changed since you loaded it. Reload the list.');
	keep(fw.rule_update({ id: r.id, current: 'Game server', target: 'DROP', destPort: '', name: 'Game server 2' }));
	const now = rule('Game server 2');
	eq([now.target, now.destPort, now.destIp, now.proto], ['DROP', '', '192.168.8.20', 'udp']);
	eq(fw.rule_update({ id: now.id, current: 'Game server 2', proto: 'icmp', destPort: '53' }).error, 'Ports only apply to TCP or UDP.');
	eq(fw.rule_update({ id: 'sambasharewan', current: '' }).error, 'Rules made by router services are changed from that service.');
	eq(fw.rule_update({ id: 'nothing', current: 'x' }).error, 'That rule is gone. Reload the list.');
	keep(fw.rule_enable({ id: now.id, current: 'Game server 2', enabled: false }));
	eq(rule('Game server 2').enabled, false);
	keep(fw.rule_enable({ id: now.id, current: 'Game server 2', enabled: true }));
	eq(rule('Game server 2').enabled, true);
	eq(call('rule_enable', { id: now.id, current: 'Game server 2' }), { error: 'Turn the rule on or off.' });
});

test('rules move within the visible list and the agent’s own rules keep their places', () => {
	// the policy engine's rule: named zeeli_*, between two ordinary rules
	const c = cursor();
	c.get_all('firewall');
	c.set('firewall', 'zeeli_block_kids', 'rule');
	c.set('firewall', 'zeeli_block_kids', 'name', 'Kids bedtime');
	c.set('firewall', 'zeeli_block_kids', 'zeeli', '1');
	c.reorder('firewall', 'zeeli_block_kids', named('rule', 'Allow-IGMP')['.index'] + 1);
	c.save('firewall');
	c.commit('firewall');
	eq(index(map(fw.rules().rules, (r) => r.name), 'Kids bedtime'), -1, 'the agent’s rules are hidden');
	const list = () => map(fw.rules().rules, (r) => r.name);
	const hidden = () => index(order(), 'Kids bedtime');
	const start = hidden();
	const g = rule('Game server 2');
	eq(g.index, length(list()) - 1);
	keep(fw.rule_move({ id: g.id, current: 'Game server 2', to: 0 }));
	eq(list()[0], 'Game server 2');
	eq(order()[0], 'Game server 2');
	eq(hidden(), start + 1, 'the agent’s rule is where it was relative to its neighbours');
	eq(order()[hidden() - 1], 'Allow-IGMP');
	keep(fw.rule_move({ id: rule('Game server 2').id, current: 'Game server 2', to: 3 }));
	eq(index(list(), 'Game server 2'), 3);
	keep(fw.rule_move({ id: rule('Game server 2').id, current: 'Game server 2', to: 9999 }));
	eq(index(list(), 'Game server 2'), length(list()) - 1);
	eq(fw.rule_move({ id: rule('Game server 2').id, current: 'Game server 2', to: length(list()) - 1 }).moved, false);
	eq(fw.rule_move({ id: rule('Game server 2').id, current: 'Game server 2', to: -1 }).error, 'Pick where the rule goes.');
	eq(fw.rule_move({ id: 'zeeli_block_kids', current: 'Kids bedtime', to: 0 }).error, 'That rule is gone. Reload the list.');
});

test('the agent’s own sections can’t be changed or deleted through this area', () => {
	const before = file();
	eq(fw.rule_delete({ id: 'zeeli_block_kids', current: 'Kids bedtime' }).error, 'That rule is gone. Reload the list.');
	eq(fw.rule_enable({ id: 'zeeli_block_kids', current: 'Kids bedtime', enabled: false }).error, 'That rule is gone. Reload the list.');
	eq(fw.forwarding_remove({ id: 'zeeli_block_kids' }).error, 'That forwarding is gone. Reload the list.');
	eq(file(), before);
});

test('deleting a rule', () => {
	const g = rule('Game server 2');
	keep(fw.rule_delete({ id: g.id, current: 'Game server 2' }));
	eq(rule('Game server 2'), null);
	eq(fw.rule_delete({ id: 'sambasharewan', current: '' }).error, 'Rules made by router services are changed from that service.');
});

test('confirming keeps the change, and the timer firing afterwards does nothing', () => {
	const r = fw.zone_update({ name: 'lan', output: 'DROP' });
	eq(rollback.status(r.token).state, 'pending');
	eq(rollback.confirm(r.token).state, 'confirmed');
	eq(rollback.expire(r.token).state, 'confirmed');
	eq(named('zone', 'lan').output, 'DROP');
	eq(rollback.status(r.token).state, 'confirmed');
	eq(rollback.confirm(r.token).state, 'confirmed');
	keep(fw.zone_update({ name: 'lan', output: 'ACCEPT' }));
});

test('with no confirm, the timer puts the firewall back and reloads it', () => {
	const before = file();
	splice(reloaded, 0);
	writefile(`${paths.confdir}/dhcp`, `${readfile(`${paths.confdir}/dhcp`)}# touched while waiting\n`);
	const r = fw.rule_add({ name: 'Lock me out', src: 'lan', target: 'DROP', proto: 'all' });
	ok(!r.error, r.error);
	ok(rule('Lock me out'), 'written');
	splice(reloaded, 0);
	const out = rollback.expire(r.token);
	eq(out.state, 'rolledBack');
	eq(out.message, 'The router undid adding a firewall rule because it wasn’t confirmed in time.');
	eq(file(), before);
	ok(match(readfile(`${paths.confdir}/dhcp`), /touched while waiting/), 'other settings are not rolled back');
	eq(reloaded, ['firewall']);
	// the console arrives late
	eq(rollback.confirm(r.token), { state: 'rolledBack', message: out.message });
	eq(rollback.status(r.token).state, 'rolledBack');
	eq(rollback.expire(r.token).state, 'rolledBack');
	ok(!pendingToken(), 'nothing is waiting');
});

test('a countdown whose timer never ran is finished before the next change starts', () => {
	const before = file();
	const r = fw.rule_add({ name: 'Stale', src: 'lan', target: 'DROP', proto: 'all' });
	const p = `${paths.state}/rollback/${r.token}.pending`;
	writefile(p, replace(readfile(p), sprintf('%d', r.expires), sprintf('%d', time() - 5)));
	const next = fw.zone_update({ name: 'lan', mssClamp: true });
	ok(!next.error, next.error);
	ok(!rule('Stale'), 'the stale change was undone first');
	eq(rollback.status(r.token).state, 'rolledBack');
	keep(next);
	eq(before != file(), true);
});

test('a rejected change starts no countdown', () => {
	// a bad rule never reaches begin(), so no snapshot or timer is left behind
	const snaps = length(snapshots.list());
	const t = length(timers);
	eq(fw.rule_add({ name: 'x', destPort: 'nope' }).error, 'Ports must be 1 to 65535: 443, 8000-8010 or 80 443.');
	eq(length(timers), t);
	eq(length(snapshots.list()), snaps);
	ok(!pendingToken());
});

test('tokens are checked everywhere they are read', () => {
	for (let bad in ['', '../x', 'ABCDEF0123456789', '0123456789abcde', null, 5]) {
		eq(rollback.confirm(bad).error, 'That isn’t a change token.', `${bad}`);
		eq(rollback.expire(bad).error, 'That isn’t a change token.');
		eq(rollback.status(bad).error, 'That isn’t a change token.');
	}
	eq(call('confirm', { token: 'x' }), { error: 'That isn’t a change token.' });
	eq(rollback.confirm('0123456789abcdef'), { state: 'unknown', message: 'The router has no record of that change.' });
});

done();
