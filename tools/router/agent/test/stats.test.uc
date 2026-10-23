'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { lsdir, readfile, unlink, writefile } from 'fs';
import { cursor, paths } from 'zeeli.common';
import * as ring from 'zeeli.ring';
import * as stats from 'zeeli.stats';

const api = plugin('stats')['zeeli.stats'];
const call = (method, args) => api[method].call({ args: args ?? {} });
const T0 = 1700006400;
const MAC = 'AA:BB:CC:00:00:01';

function fresh() {
	stats.mkdirp(stats.dir());
	for (let name in lsdir(stats.dir())) unlink(`${stats.dir()}/${name}`);
}

function seed() {
	fresh();
	const put = (kind, id, values, t) => ring.put(stats.ringPath(kind, stats.keyOf(kind, id)), stats.KINDS[kind], t ?? T0 + 60, values, 0);
	put('client', MAC, [3000, 300]);
	put('client', 'AA:BB:CC:00:00:02', [9000, 100]);
	put('client', 'AA:BB:CC:00:00:03', [10, 10]);
	put('network', 'lan', [12010, 410]);
	put('wan', 'wan', [12010, 410]);
	put('system', 'router', [100, 500, 600]);
	put('health', 'wan', [200, 0, 2000, 10]);
}

test('series answers for the things we have history of', () => {
	seed();
	const r = stats.series({ kind: 'client', id: MAC, range: '30d' }, T0 + 120);
	eq(r.id, MAC);
	eq(r.fields, ['down', 'up']);
	eq(r.step, 3600);
	eq(r.totals, { down: 3000, up: 300 });
	eq(length(r.points), 720);
	eq(r.points[719], [3000, 300]);
	ok(call('series', { kind: 'network', id: 'lan', range: '12m' }).error == null);
});

test('series refuses anything it does not know, and never builds a path from the id', () => {
	seed();
	const bad = (args, what) => ok(call('series', args).error, what);
	bad({ kind: 'bogus', id: 'wan', range: '24h' }, 'unknown kind');
	bad({ kind: 'wan', id: 'wan', range: '7d' }, 'unknown range');
	bad({ kind: 'wan', id: 'wan' }, 'missing range');
	bad({ kind: 'wan', id: 'wwan', range: '24h' }, 'an uplink with no history');
	bad({ kind: 'client', id: 'AA:BB:CC:00:00:99', range: '24h' }, 'a device with no history');
	bad({ kind: 'client', id: 'AA-BB-CC-00-00-01', range: '24h' }, 'a MAC with the wrong separators');
	bad({ kind: 'wan', id: MAC, range: '24h' }, 'a device id used as an uplink');
	bad({ kind: 'wan', id: '../../etc/passwd', range: '24h' }, 'path traversal');
	bad({ kind: 'wan', id: 'wan.ring', range: '24h' }, 'a file name');
	bad({ kind: 'wan', id: 'wan; reboot', range: '24h' }, 'shell words');
	bad({ kind: 'wan', id: ['wan'], range: '24h' }, 'a list for an id');
	bad({ kind: ['wan'], id: 'wan', range: '24h' }, 'a list for a kind');
	bad({ kind: 'client', id: null, range: '24h' }, 'a missing id');
});

test('top ranks devices and networks from the latest summary', () => {
	seed();
	eq(call('top', { range: '24h' }).clients, []);
	stats.summarize(T0 + 120);
	const t = call('top', { range: '24h' });
	eq(t.clients, [
		{ id: 'AA:BB:CC:00:00:02', down: 9000, up: 100 },
		{ id: MAC, down: 3000, up: 300 },
		{ id: 'AA:BB:CC:00:00:03', down: 10, up: 10 },
	]);
	eq(t.networks, [{ id: 'lan', down: 12010, up: 410 }]);
	eq(length(call('top', { range: '12m', kind: 'client', limit: '2' }).clients), 2);
	ok(call('top', { range: '12m', kind: 'client' }).networks == null);
	ok(call('top', { range: 'year' }).error, 'bad range');
	ok(call('top', { range: '24h', kind: 'system' }).error, 'bad kind');
	ok(call('top', { range: '24h', limit: '0' }).error, 'limit too small');
	ok(call('top', { range: '24h', limit: '1000' }).error, 'limit too large');
	ok(call('top', { range: '24h', limit: '3x' }).error, 'limit not a number');
});

test('events come newest first and can be narrowed by time, count and kind', () => {
	fresh();
	const kinds = ['device.new', 'device.joined', 'wan.down', 'wan.up', 'device.left'];
	for (let i = 0; i < length(kinds); i++) stats.addEvent({ id: i + 1, t: T0 + i * 10, kind: kinds[i], subject: 'x', name: '', value: null, alert: false });
	eq(map(call('events').events, (e) => e.id), [5, 4, 3, 2, 1]);
	eq(map(call('events', { limit: '2' }).events, (e) => e.id), [5, 4]);
	eq(map(call('events', { since: `${T0 + 20}` }).events, (e) => e.id), [5, 4]);
	eq(map(call('events', { kinds: ['wan.down', 'wan.up'] }).events, (e) => e.kind), ['wan.up', 'wan.down']);
	ok(call('events', { kinds: ['wan.explode'] }).error, 'unknown kind');
	ok(call('events', { limit: '0' }).error, 'limit too small');
	ok(call('events', { limit: '99999' }).error, 'limit too large');
	ok(call('events', { since: '-5' }).error, 'since is not a time');
	// a half-written line at the end of the file is skipped, not fatal
	writefile(`${stats.dir()}/events.jsonl`, readfile(`${stats.dir()}/events.jsonl`) + '{"id":6,"t":1');
	eq(length(call('events').events), 5);
});

test('alerts: unread ones come back until acknowledged, one at a time or all at once', () => {
	fresh();
	const add = (id, kind, alert) => stats.addEvent({ id, t: T0 + id, kind, subject: 'x', name: '', value: null, alert });
	add(1, 'wan.down', true);
	add(2, 'device.joined', false);
	add(3, 'device.new', true);
	add(4, 'wan.up', true);
	let r = call('alerts');
	eq([r.unread, map(r.alerts, (a) => a.id)], [3, [4, 3, 1]]);
	r = call('alerts', { ack: ['3'] });
	eq(map(r.alerts, (a) => a.id), [4, 1]);
	// acknowledging twice, or something that isn't an alert, changes nothing
	eq(call('alerts', { ack: ['3', '2'] }).unread, 2);
	r = call('alerts', { all: true });
	eq([r.unread, r.alerts], [0, []]);
	// new alerts after that are unread again
	add(5, 'temp.high', true);
	eq(call('alerts').unread, 1);

	ok(call('alerts', { ack: [3] }).error, 'numbers travel as strings');
	ok(call('alerts', { ack: ['../acks'] }).error, 'not a number');
	ok(call('alerts', { ack: 'all' }).error, 'not a list');
});

test('alert settings default to the important kinds and are saved in /etc/config/zeeli', () => {
	fresh();
	const r = call('alerts');
	eq(r.on, ['device.new', 'wan.down', 'wan.up', 'wan.failover', 'temp.high']);
	eq(r.available, stats.EVENT_KINDS);

	const set = call('alerts', { save: true, kinds: ['device.left', 'wan.down'] });
	eq(set.on, ['device.left', 'wan.down']);
	const c = cursor();
	eq(c.get('zeeli', 'zeeli_alerts'), 'alerts');
	eq(c.get('zeeli', 'zeeli_alerts', 'zeeli'), '1');
	eq(c.get('zeeli', 'zeeli_alerts', 'on'), ['device.left', 'wan.down']);

	// turning every kind off is a setting too, not "unset"
	eq(call('alerts', { save: true, kinds: [] }).on, []);
	// without `save`, a call can't change anything
	eq(call('alerts', { kinds: ['wan.down'] }).on, []);
	// a bad list is refused and leaves the saved one alone
	ok(call('alerts', { save: true, kinds: ['wan.down', 'rm -rf'] }).error, 'unknown kind');
	eq(call('alerts').on, []);
});

test('settings: the ping target and the temperature limit are checked before they are saved', () => {
	fresh();
	eq(call('settings'), { target: '1.1.1.1', tempHigh: 85 });
	eq(call('settings', { save: true, target: '9.9.9.9', tempHigh: '90' }), { target: '9.9.9.9', tempHigh: 90 });
	const c = cursor();
	eq(c.get('zeeli', 'zeeli_stats'), 'stats');
	eq(c.get('zeeli', 'zeeli_stats', 'zeeli'), '1');
	eq(c.get('zeeli', 'zeeli_stats', 'target'), '9.9.9.9');
	eq(c.get('zeeli', 'zeeli_stats', 'temp_high'), '90');
	eq(call('settings', { save: true, target: 'one.one.one.one' }).target, 'one.one.one.one');
	eq(call('settings', { save: true, target: '2606:4700:4700::1111' }).target, '2606:4700:4700::1111');

	for (let bad in ['-c1', '--help', '', 'a b', '1.2.3.999', 'x;reboot', '$(id)', 'a/b', '.', replace(sprintf('%300s', ''), ' ', 'a')])
		ok(call('settings', { save: true, target: bad }).error, `refuses "${substr(bad, 0, 20)}"`);
	for (let bad in ['10', '200', 'hot', '85.5', '-90'])
		ok(call('settings', { save: true, tempHigh: bad }).error, `refuses ${bad}`);
	// nothing above changed what was saved
	eq(call('settings'), { target: '2606:4700:4700::1111', tempHigh: 90 });
	eq(call('settings', { target: '8.8.8.8' }).target, '2606:4700:4700::1111');
});

test('status says whether the collector is running and how much it keeps', () => {
	seed();
	let s = call('status');
	eq([s.running, s.lastSample, s.devices], [false, null, 3]);
	ok(s.storage.bytes > 200000, 'counts the history files');
	writefile(`${stats.dir()}/status.json`, sprintf('%J', { t: time() - 30, took: 120 }));
	s = call('status');
	eq([s.running, s.took], [true, 120]);
	writefile(`${stats.dir()}/status.json`, sprintf('%J', { t: time() - 600, took: 120 }));
	eq(call('status').running, false);
});

done();
