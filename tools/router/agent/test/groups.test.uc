// zeeli.groups: what lands in /etc/config/zeeli, and what is refused.
'use strict';

import { eq, ok, test, done } from 'assert';
import { mac, ran, reset, sections, uci } from 'sandbox';
import * as groups from 'zeeli.groups';
import * as policies from 'zeeli.policies';
import { sys } from 'zeeli.policyapply';

const MAYA = '02:5E:E1:10:14:C8', LEO = '02:5E:E1:17:2B:C1';

function macs(n) {
	const list = [];
	for (let i = 0; i < n; i++) push(list, mac(i));
	return list;
}

function made(args) {
	const r = groups.create(args);
	if (r.error) die(r.error);
	return r.group;
}

test('create stores the group in its own UCI section', () => {
	reset();
	const g = made({ name: ' Kids ', kind: 'person', members: [MAYA, LEO] });
	ok(match(g.id, /^[0-9a-f]{6}$/), 'a six-digit id');
	eq(g.name, 'Kids');
	const s = sections('group');
	eq(length(s), 1);
	eq(s[0]['.name'], `zeeli_g_${g.id}`);
	eq([s[0].zeeli, s[0].name, s[0].kind, s[0].member], ['1', 'Kids', 'person', [MAYA, LEO]]);
});

test('members are stored upper case, once each', () => {
	reset();
	const g = made({ name: 'Devices', kind: 'devices', members: ['02:5e:e1:10:14:c8', MAYA, LEO] });
	eq(g.members, [MAYA, LEO]);
	eq(groups.list(), { groups: [g] });
});

test('a group can start empty', () => {
	reset();
	eq(made({ name: 'Nobody yet', kind: 'devices' }).members, []);
	eq(uci(`zeeli_g_${groups.list().groups[0].id}`, 'member'), null);
});

test('names are checked', () => {
	reset();
	let long = '';
	for (let i = 0; i < 50; i++) long += 'abcd';
	for (let bad in ['', '   ', null, 5, 'x\ny', 'bell\x07', long])
		ok(groups.create({ name: bad, kind: 'devices', members: [] }).error, `refuses ${sprintf('%J', bad)}`);
	eq(length(sections('group')), 0, 'nothing was written');
	ok(groups.create({ name: 'Mum’s phone & tablet (old)', kind: 'devices', members: [] }).group, 'ordinary punctuation is fine');
});

test('a name can’t be used twice, however it is capitalised', () => {
	reset();
	const g = made({ name: 'Kids', kind: 'person', members: [] });
	eq(groups.create({ name: 'kids', kind: 'devices', members: [] }).error, 'There is already a group called kids.');
	ok(groups.update({ id: g.id, name: 'KIDS' }).group, 'but a group may change its own capitals');
});

test('a group is for a person or for devices', () => {
	reset();
	eq(groups.create({ name: 'A', kind: 'cat', members: [] }).error, 'A group is for a person or for a set of devices.');
	eq(groups.create({ name: 'A', members: [] }).group.kind, 'devices', 'devices is the default');
});

test('members must be MAC addresses', () => {
	reset();
	eq(groups.create({ name: 'A', kind: 'devices', members: ['nope'] }).error, '“nope” isn’t a MAC address.');
	eq(groups.create({ name: 'A', kind: 'devices', members: [MAYA, '02:5E:E1:10:14'] }).error, '“02:5E:E1:10:14” isn’t a MAC address.');
	eq(groups.create({ name: 'A', kind: 'devices', members: 'x' }).error, 'Members must be a list of MAC addresses.');
	eq(groups.create({ name: 'A', kind: 'devices', members: [MAYA + '; reboot'] }).error, `“${MAYA}; reboot” isn’t a MAC address.`);
	eq(length(sections('group')), 0);
});

test('a group holds up to 256 devices and there are up to 64 groups', () => {
	reset();
	const lots = macs(257);
	eq(groups.create({ name: 'Big', kind: 'devices', members: lots }).error, 'A group can hold up to 256 devices.');
	const g = made({ name: 'Big', kind: 'devices', members: slice(lots, 0, 256) });
	eq(length(g.members), 256);
	eq(groups.setMembers({ id: g.id, macs: [mac(300)] }, true).error, 'A group can hold up to 256 devices.');
	reset();
	for (let i = 0; i < 64; i++) made({ name: `Group ${i}`, kind: 'devices', members: [] });
	eq(groups.create({ name: 'One too many', kind: 'devices', members: [] }).error, 'You can have up to 64 groups.');
});

test('update changes only what it is given', () => {
	reset();
	const g = made({ name: 'Kids', kind: 'person', members: [MAYA] });
	eq(groups.update({ id: g.id, name: 'Children' }).group, { id: g.id, name: 'Children', kind: 'person', members: [MAYA] });
	eq(groups.update({ id: g.id, members: [LEO] }).group.members, [LEO]);
	eq(groups.update({ id: g.id, kind: 'devices' }).group.kind, 'devices');
	eq(uci(`zeeli_g_${g.id}`, 'name'), 'Children');
	eq(groups.update({ id: g.id, name: '' }).error, 'Give the group a name.');
	eq(uci(`zeeli_g_${g.id}`, 'name'), 'Children', 'a refused update changes nothing');
});

test('unknown and malformed ids are refused', () => {
	reset();
	for (let id in ['abcdef', 'nothex', '', null, '../../x', 'ABCDEF'])
		for (let call in [groups.update, groups.remove, (a) => groups.setMembers(a, true)])
			eq(call({ id, name: 'x', macs: [] }).error, 'That group doesn’t exist.');
});

test('adding and removing members is forgiving', () => {
	reset();
	const g = made({ name: 'Kids', kind: 'person', members: [MAYA] });
	eq(groups.setMembers({ id: g.id, macs: [LEO, '02:5e:e1:10:14:c8'] }, true).group.members, [MAYA, LEO]);
	eq(groups.setMembers({ id: g.id, macs: ['02:5e:e1:99:99:99', '02:5e:e1:17:2b:c1'] }, false).group.members, [MAYA]);
	eq(groups.setMembers({ id: g.id, macs: ['bad'] }, true).error, '“bad” isn’t a MAC address.');
	eq(uci(`zeeli_g_${g.id}`, 'member'), [MAYA]);
});

test('deleting a group takes it out of policies and switches off those left with nobody', () => {
	reset();
	const g = made({ name: 'Kids', kind: 'person', members: [MAYA] });
	const other = made({ name: 'Parents', kind: 'person', members: [LEO] });
	const block = (name, who) => policies.create({ name, who, what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' } }).policy;
	const both = block('Both', [{ type: 'group', id: g.id }, { type: 'group', id: other.id }]);
	const only = block('Only kids', [{ type: 'group', id: g.id }]);
	eq(groups.remove({ id: g.id }), { affected: 2, applied: 'reload', warnings: [] });
	eq(length(sections('group')), 1);
	const left = policies.list().policies;
	eq(filter(left, (p) => p.id == both.id)[0].who, [{ type: 'group', id: other.id }]);
	eq(filter(left, (p) => p.id == both.id)[0].enabled, true);
	eq(filter(left, (p) => p.id == only.id)[0].who, []);
	eq(filter(left, (p) => p.id == only.id)[0].enabled, false);
});

test('a group nobody uses never touches the firewall', () => {
	reset();
	eq(made({ name: 'Idle', kind: 'devices', members: [MAYA] }).name, 'Idle');
	eq(ran(), []);
});

test('changing the members of a group in use reloads the firewall with the new set', () => {
	reset();
	const g = made({ name: 'Kids', kind: 'person', members: [MAYA] });
	policies.create({ name: 'Bedtime', who: [{ type: 'group', id: g.id }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' } });
	sys.calls = [];
	eq(groups.setMembers({ id: g.id, macs: [LEO] }, true).applied, 'reload');
	eq(ran('reload'), ['reload firewall']);
});

test('a firewall that refuses the file leaves the group as it was', () => {
	reset();
	const g = made({ name: 'Kids', kind: 'person', members: [MAYA] });
	policies.create({ name: 'Bedtime', who: [{ type: 'group', id: g.id }], what: { kind: 'internet' }, when: { kind: 'always' }, action: { kind: 'block' } });
	sys.answer = (argv) => (argv[0] == 'nft' && argv[1] == '-c' ? { code: 1, stdout: 'Error: nope\nsecond line' } : { code: 0, stdout: '' });
	const r = groups.setMembers({ id: g.id, macs: [LEO] }, true);
	ok(match(r.error, /^The firewall wouldn’t take these policies \(Error: nope\), so nothing was changed\.$/), r.error);
	eq(groups.list().groups[0].members, [MAYA]);
});

done();
