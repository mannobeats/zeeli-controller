'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { cursor, paths } from 'zeeli.common';
import * as snapshots from 'zeeli.snapshots';
import { reloader } from 'zeeli.snapshots';
import { readfile, stat, writefile } from 'fs';

const backup = plugin('backup')['zeeli.backup'];

// record reloads instead of running init scripts. This replaces the hook of the copy of the lib
// imported here, so the tests that look at reloads call the lib, not rpcd.
const reloaded = [];
reloader.run = (name) => {
	push(reloaded, name);
	return { code: 0, stdout: '' };
};

const file = (name) => `${paths.confdir}/${name}`;
const edit = (name, from, to) => writefile(file(name), replace(readfile(file(name)), from, to));

test('a snapshot copies the settings files and records why', () => {
	const s = snapshots.create('Before testing');
	ok(!s.error, s.error);
	eq(s.reason, 'Before testing');
	ok(s.size > 1000, 'size is the files’ size');
	ok(index(s.configs, 'firewall') >= 0 && index(s.configs, 'network') >= 0, 'every settings file is in it');
	eq(readfile(`${paths.state}/snapshots/${s.id}/config/firewall`), readfile(file('firewall')));
	eq(map(backup.list.call({ args: {} }).snapshots, (x) => x.id), [s.id]);
	eq(backup.list.call({ args: {} }).keep, 10);
});

test('only the newest ten are kept, even within the same second', () => {
	for (let i = 0; i < 12; i++) snapshots.create(`Number ${i}`);
	const all = backup.list.call({ args: {} }).snapshots;
	eq(length(all), 10);
	eq(length(uniq(map(all, (x) => x.id))), 10);
	eq(all[0].reason, 'Number 11');
});

test('a snapshot can cover just some settings files', () => {
	const s = snapshots.create('Firewall only', ['firewall']);
	eq(s.configs, ['firewall']);
	ok(!stat(`${paths.state}/snapshots/${s.id}/config/network`), 'network is not copied');
});

test('creating checks the reason, and ids are never used as paths', () => {
	ok(backup.create.call({ args: { reason: '' } }).error);
	ok(backup.create.call({ args: { reason: 'x\ny' } }).error);
	ok(backup.create.call({ args: { reason: replace(sprintf('%81s', ''), ' ', 'x') } }).error, 'over 80 characters');
	for (let bad in ['../config', 's1/../../x', '', null, 5, 's'])
		for (let m in ['delete', 'restore', 'diff'])
			eq(backup[m].call({ args: { id: bad } }), { error: 'That isn’t a snapshot.' }, `${m} ${bad}`);
	eq(backup.delete.call({ args: { id: 's1' } }), { error: 'That snapshot is already gone.' });
});

test('restoring writes the files back, reloads what can reload and snapshots first', () => {
	const s = snapshots.create('Good state');
	edit('firewall', "option name 'wan'", "option name 'wan'\n\toption comment 'changed'");
	edit('dhcp', 'config dnsmasq', 'config dnsmasq # changed');
	const r = snapshots.restore(s.id);
	eq(r.restored, ['dhcp', 'firewall']);
	eq(r.reloaded, ['dnsmasq', 'firewall']);
	eq(r.rebootNeeded, false);
	eq(reloaded, ['dnsmasq', 'firewall']);
	ok(!match(readfile(file('firewall')), /changed/), 'firewall is back');
	ok(match(r.summary, /Reloaded dnsmasq, firewall/), r.summary);
	eq(snapshots.find(r.undo).reason, 'Before restoring the snapshot from Good state');
});

test('settings only read at startup mean a restart is needed, and it says which', () => {
	writefile(file('kmwan'), "config global 'global'\n\toption enable '1'\n");
	const s = snapshots.create('With kmwan');
	writefile(file('kmwan'), "config global 'global'\n\toption enable '0'\n");
	edit('network', "config interface 'lan'", "config interface 'lan' # changed");
	splice(reloaded, 0);
	const r = snapshots.restore(s.id);
	eq(r.restored, ['kmwan', 'network']);
	eq(r.reloaded, ['network']);
	eq(r.rebootNeeded, true);
	ok(match(r.summary, /kmwan is only read when the router starts/), r.summary);
	eq(reloaded, ['network']);
});

test('restoring the state it already has changes nothing', () => {
	const s = snapshots.create('Same');
	const before = length(snapshots.list());
	splice(reloaded, 0);
	const r = snapshots.restore(s.id);
	eq(r.restored, []);
	eq(r.rebootNeeded, false);
	eq(length(snapshots.list()), before, 'no undo snapshot when nothing changes');
	eq(reloaded, []);
});

test('a rollback restores only the files it names and makes no snapshot of its own', () => {
	const s = snapshots.create('Rollback point', ['firewall']);
	edit('firewall', "option name 'wan'", "option name 'wan'\n\toption comment 'x'");
	edit('dhcp', 'config dnsmasq', 'config dnsmasq # also changed');
	const before = length(snapshots.list());
	splice(reloaded, 0);
	const r = snapshots.restore(s.id, { only: ['firewall'] });
	eq(r.restored, ['firewall']);
	ok(match(readfile(file('dhcp')), /also changed/), 'dhcp is left as it is');
	eq(length(snapshots.list()), before);
	eq(reloaded, ['firewall']);
});

test('a diff names changed files, sections and options, never values', () => {
	const s = snapshots.create('For diffing');
	edit('firewall', "option name 'Allow-IGMP'", "option name 'Allow-IGMP'\n\toption comment 'secret-value-123'");
	edit('network', "option vlan_id '9'", "option vlan_id '99'");
	const c = cursor();
	c.get_all('firewall');
	const sid = c.add('firewall', 'rule');
	c.set('firewall', sid, 'name', 'Brand new rule');
	c.save('firewall');
	c.commit('firewall');
	writefile(file('extra'), '');
	const d = backup.diff.call({ args: { id: s.id } });
	ok(!d.error, d.error);
	const fw = filter(d.files, (f) => f.name == 'firewall')[0];
	eq(fw.change, 'changed');
	eq(filter(fw.sections, (x) => x.section == 'rule Allow-IGMP')[0], { section: 'rule Allow-IGMP', change: 'changed', options: ['comment'] });
	eq(filter(fw.sections, (x) => x.section == 'rule Brand new rule')[0].change, 'added');
	eq(filter(d.files, (f) => f.name == 'extra')[0], { name: 'extra', change: 'added', sections: [] });
	ok(index(sprintf('%J', d), 'secret-value-123') < 0, 'values stay out of a diff');
	ok(index(sprintf('%J', d), '99') < 0, 'values stay out of a diff');
	const net = filter(d.files, (f) => f.name == 'network')[0];
	eq(net.sections[0].options, ['vlan_id']);
});

test('deleting removes the snapshot', () => {
	const s = snapshots.create('Temporary');
	eq(backup.delete.call({ args: { id: s.id } }), { id: s.id });
	ok(!snapshots.find(s.id));
	ok(!stat(`${paths.state}/snapshots/${s.id}`));
});

done();
