'use strict';

import { eq, ok, test, done } from 'assert';
import { cursor, paths } from 'zeeli.common';
import * as fw from 'zeeli.firewall';
import * as rollback from 'zeeli.rollback';
import * as snapshots from 'zeeli.snapshots';
import { pendingdir, reloader } from 'zeeli.snapshots';
import { lsdir, readfile, stat, unlink, writefile } from 'fs';

// record what would be reloaded, started and flushed, instead of doing it
const reloaded = [];
let failReload = null;
reloader.run = (name) => {
	push(reloaded, name);
	return name == failReload ? { code: 1, stdout: `${name} is unhappy` } : { code: 0, stdout: '' };
};
const timers = [];
rollback.timer.start = (token, seconds) => push(timers, [token, seconds]);
let flushes = 0;
rollback.admin.flush = () => flushes++;

const file = (name) => `${paths.confdir}/${name}`;
const edit = (name, from, to) => writefile(file(name), replace(readfile(file(name)), from, to));
const clearReloads = () => splice(reloaded, 0);
const original = { network: readfile(file('network')), firewall: readfile(file('firewall')) };
const reset = () => {
	for (let n, content in original) writefile(file(n), content);
};
const pendingFiles = () => filter(lsdir(pendingdir()) ?? [], (n) => match(n, /^[0-9a-f]{16}\.pending/));

test('a waiting change is recorded on flash, apart from the outcomes kept in RAM', () => {
	const r = fw.zone_update({ name: 'guest', mssClamp: true });
	ok(!r.error, r.error);
	eq(r.settle, 2);
	ok(stat(`${pendingdir()}/${r.token}.pending`), 'in the persistent folder');
	ok(!stat(`${paths.state}/rollback/${r.token}.pending`), 'not in the RAM folder');
	eq(rollback.confirm(r.token).state, 'confirmed');
	ok(stat(`${paths.state}/rollback/${r.token}.done`), 'the outcome is in RAM');
	eq(pendingFiles(), []);
});

test('a reboot inside the window puts the change back, before the services start', () => {
	const before = readfile(file('firewall'));
	const r = fw.zone_update({ name: 'guest', input: 'ACCEPT' });
	ok(match(readfile(file('firewall')), /input 'ACCEPT'/), 'written');
	clearReloads();
	const undone = rollback.recover();
	eq(undone, [r.token]);
	eq(readfile(file('firewall')), before);
	eq(reloaded, [], 'nothing is reloaded at boot: the services read the files as they start');
	eq(pendingFiles(), []);
	eq(rollback.confirm(r.token).state, 'rolledBack');
	eq(rollback.recover(), [], 'a second boot has nothing to do');
});

test('a boot that finds a half-finished undo finishes it', () => {
	const before = readfile(file('firewall'));
	const r = fw.zone_update({ name: 'guest', input: 'ACCEPT' });
	ok(!r.error);
	// the router went down while the timer was undoing it
	writefile(`${pendingdir()}/${r.token}.pending.running`, readfile(`${pendingdir()}/${r.token}.pending`));
	unlink(`${pendingdir()}/${r.token}.pending`);
	eq(rollback.recover(), [r.token]);
	eq(readfile(file('firewall')), before);
	eq(pendingFiles(), []);
});

test('while an undo is running, nothing else may start', () => {
	const r = fw.zone_update({ name: 'guest', mssClamp: false });
	writefile(`${pendingdir()}/${r.token}.pending.running`, readfile(`${pendingdir()}/${r.token}.pending`));
	unlink(`${pendingdir()}/${r.token}.pending`);
	eq(fw.zone_update({ name: 'guest', mssClamp: true }), { error: 'A change is being undone. Try again in a moment.' });
	rollback.recover();
});

test('the snapshot a waiting change needs is never pruned or deleted', () => {
	const r = fw.zone_update({ name: 'guest', mssClamp: true });
	const needed = snapshots.list()[0].id;
	for (let i = 0; i < 15; i++) snapshots.create(`Auto ${i}`, ['firewall'], 'auto');
	ok(snapshots.find(needed), 'still there after 15 newer automatic snapshots');
	eq(snapshots.remove(needed), { error: 'A change that is still waiting to be confirmed needs this snapshot.' });
	rollback.confirm(r.token);
	snapshots.create('One more', ['firewall'], 'auto');
	ok(!snapshots.find(needed), 'once confirmed it goes with the rest');
});

test('automatic and manual snapshots have separate limits', () => {
	for (let i = 0; i < 3; i++) snapshots.create(`Mine ${i}`);
	for (let i = 0; i < 25; i++) snapshots.create(`Auto ${i}`, ['firewall'], 'auto');
	const all = snapshots.list();
	eq(length(filter(all, (s) => s.kind == 'auto')), snapshots.AUTO_KEEP);
	eq(length(filter(all, (s) => match(s.reason, /^Mine/))), 3, 'a person’s snapshots survive ten firewall edits');
});

test('a restore that touches only safe settings is immediate and needs no confirm', () => {
	flushes = 0;
	const s = snapshots.create('Good state');
	edit('dhcp', 'config dnsmasq', 'config dnsmasq # changed');
	clearReloads();
	const r = rollback.restoreSnapshot(s.id);
	eq(r.restored, ['dhcp']);
	eq(r.token, null);
	eq(reloaded, ['dnsmasq']);
	eq(flushes, 0);
});

test('a restore that touches the network or firewall waits for a confirm, and is undone without one', () => {
	reset();
	const s = snapshots.create('Other LAN address');
	const goodNetwork = readfile(file('network'));
	const goodFirewall = readfile(file('firewall'));
	edit('network', "option ipaddr '10.0.10.1'", "option ipaddr '10.9.9.1'");
	edit('firewall', "option name 'lan'", "option name 'lan' # edited");
	const current = readfile(file('network'));
	clearReloads();
	flushes = 0;
	const r = rollback.restoreSnapshot(s.id);
	ok(!r.error, r.error);
	eq(r.restored, ['firewall', 'network']);
	eq([r.seconds, r.settle], [30, 2]);
	ok(match(r.token, /^[0-9a-f]{16}$/), r.token);
	eq(readfile(file('network')), goodNetwork);
	eq(reloaded, ['network', 'firewall']);
	eq(flushes, 1);
	eq(snapshots.find(r.undo).reason, 'Before restoring a snapshot');
	eq(snapshots.find(r.undo).kind, 'auto');
	// nobody confirms: the router goes back to what it had before the restore
	clearReloads();
	eq(rollback.expire(r.token).state, 'rolledBack');
	eq(readfile(file('network')), current);
	eq(reloaded, ['network', 'firewall']);
	eq(readfile(file('firewall')) != goodFirewall, true);
	eq(rollback.confirm(r.token).state, 'rolledBack');
});

test('a confirmed restore stays', () => {
	reset();
	const s = snapshots.create('Keep me');
	edit('network', "option ipaddr '10.0.10.1'", "option ipaddr '10.8.8.1'");
	const r = rollback.restoreSnapshot(s.id);
	eq(rollback.confirm(r.token).state, 'confirmed');
	ok(match(readfile(file('network')), /10\.0\.10\.1/));
	eq(rollback.expire(r.token).state, 'confirmed');
	ok(match(readfile(file('network')), /10\.0\.10\.1/));
});

test('a reload that fails undoes the change at once and says which service', () => {
	reset();
	const s = snapshots.create('Reload test');
	edit('firewall', "option name 'lan'", "option name 'lan' # edited");
	const current = readfile(file('firewall'));
	failReload = 'firewall';
	const r = rollback.restoreSnapshot(s.id);
	failReload = null;
	eq(r, { error: 'firewall didn’t reload cleanly, so the router put the settings back.' });
	eq(readfile(file('firewall')), current);
	eq(pendingFiles(), []);
});

test('a firewall write whose reload fails is undone at once', () => {
	const before = readfile(file('firewall'));
	failReload = 'firewall';
	const r = fw.zone_update({ name: 'guest', input: 'ACCEPT' });
	failReload = null;
	eq(r, { error: 'The firewall didn’t reload (firewall is unhappy), so the router put the settings back.' });
	eq(readfile(file('firewall')), before);
	eq(pendingFiles(), []);
});

test('a restore and a firewall write can’t be waiting at the same time', () => {
	reset();
	const r = fw.zone_update({ name: 'guest', mssClamp: true });
	const s = snapshots.create('Anything');
	edit('network', "option ipaddr '10.0.10.1'", "option ipaddr '10.7.7.1'");
	eq(rollback.restoreSnapshot(s.id), { error: 'A change is still waiting to be confirmed. Confirm or undo it first.' });
	rollback.confirm(r.token);
	ok(rollback.restoreSnapshot(s.id).token != null);
});

done();
