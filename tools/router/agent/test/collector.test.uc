'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { lsdir, readfile, unlink } from 'fs';
import { paths } from 'zeeli.common';
import * as collector from 'zeeli.collector';
import * as ring from 'zeeli.ring';
import * as sources from 'zeeli.sources';
import * as stats from 'zeeli.stats';

const api = plugin('stats')['zeeli.stats'];
// 2023-11-15 00:00:30 UTC; ticks are a minute apart and describe the minute before
const T0 = 1700006430;
const CFG = { target: '1.1.1.1', tempHigh: 85, alerts: ['device.new', 'wan.down', 'wan.up', 'wan.failover', 'temp.high'] };
const LAN = { name: 'lan', addr: sources.ip4('192.168.8.0'), bits: 24 };
const GUEST = { name: 'guest', addr: sources.ip4('192.168.9.0'), bits: 24 };

const client = (mac, ip, down, up, online) => ({ mac, name: `host-${mac}`, ip, online: online ?? true, down, up });
const uplink = (name, up, rx, tx, active) => ({ name, up, dev: up ? `dev-${name}` : null, gateway: '192.168.1.1', rx, tx, active, gw: { loss: 0, ms: 2 }, net: { loss: 25, ms: 21.5 } });

function snap(minute, parts) {
	return { t: T0 + minute * 60, uplinks: [], networks: [LAN, GUEST], clients: [], cpu: null, mem: null, temp: null, ...parts };
}

/** Every test starts with an empty history, as on a router that has just been set up. */
function fresh() {
	stats.mkdirp(stats.dir());
	for (let name in lsdir(stats.dir())) unlink(`${stats.dir()}/${name}`);
	return collector.newState();
}

const kinds = () => map(stats.events({}).events, (e) => e.kind);

/** The history of one thing as the console receives it: just the points that have a sample. */
function points(kind, id, range) {
	const r = stats.series({ kind, id, range: range ?? '24h' }, T0 + 600);
	return { ...r, points: filter(r.points, (p) => p != null) };
}

test('the first tick only learns the router: baselines, no events, nothing called new', () => {
	const st = fresh();
	collector.tick(st, snap(0, { clients: [client('AA:00:00:00:00:01', '192.168.8.10', 1000, 100)] }), CFG);
	collector.tick(st, snap(1, { clients: [client('AA:00:00:00:00:01', '192.168.8.10', 5000, 600)] }), CFG);
	eq(kinds(), []);
	eq(points('client', 'AA:00:00:00:00:01', '12m').totals, { down: 4000, up: 500 });
});

test('a device’s bytes are what it moved since the last tick, and add up to its network', () => {
	const st = fresh();
	const a = '0A:00:00:00:00:0A', b = '0A:00:00:00:00:0B', c = '0A:00:00:00:00:0C';
	const at = (minute, down) => snap(minute, { clients: [
		client(a, '192.168.8.10', 1000 * down, 100 * down),
		client(b, '192.168.8.11', 500 * down, 50 * down),
		client(c, '192.168.9.20', 200 * down, 20 * down),
	] });
	for (let m = 0; m < 4; m++) collector.tick(st, at(m, m + 1), CFG);
	// minutes 1..3 moved 1x, 2x, 3x of the base amount
	eq(points('client', a, '12m').totals, { down: 3000, up: 300 });
	const lan = points('network', 'lan', '12m').totals, guest = points('network', 'guest', '12m').totals;
	eq(lan, { down: 4500, up: 450 });
	eq(guest, { down: 600, up: 60 });
});

test('a counter that went back was reset, and counts from zero', () => {
	const st = fresh();
	const mac = '0A:00:00:00:00:0A';
	collector.tick(st, snap(0, { clients: [client(mac, '192.168.8.10', 9000, 900)] }), CFG);
	collector.tick(st, snap(1, { clients: [client(mac, '192.168.8.10', 400, 40)] }), CFG);
	eq(points('client', mac, '12m').totals, { down: 400, up: 40 });
});

test('devices joining, leaving and showing up for the first time become events', () => {
	const st = fresh();
	const old = '0B:00:00:00:00:01', fresh = '0B:00:00:00:00:02';
	collector.tick(st, snap(0, { clients: [client(old, '192.168.8.10', 10, 1)] }), CFG);
	collector.tick(st, snap(1, { clients: [client(old, '192.168.8.10', 20, 2), client(fresh, '192.168.8.11', 0, 0)] }), CFG);
	collector.tick(st, snap(2, { clients: [client(old, '192.168.8.10', 30, 3, false), client(fresh, '192.168.8.11', 5, 5)] }), CFG);
	const all = stats.events({}).events;
	eq(map(reverse(all), (e) => [e.kind, e.subject]), [
		['device.new', fresh], ['device.joined', fresh], ['device.left', old],
	]);
	// new devices alert, joins don't unless asked
	eq(map(reverse(all), (e) => e.alert), [true, false, false]);
	eq(all[0].name, `host-${old}`);
});

test('a device that was already there when the collector started is not new', () => {
	const st = fresh();
	const mac = '0C:00:00:00:00:01';
	collector.tick(st, snap(0, { clients: [client(mac, '192.168.8.10', 10, 1, false)] }), CFG);
	collector.tick(st, snap(1, { clients: [client(mac, '192.168.8.10', 20, 2, true)] }), CFG);
	eq(kinds(), ['device.joined']);
});

test('uplinks: bytes, health, and down, up and failover events', () => {
	const st = fresh();
	collector.tick(st, snap(0, { uplinks: [uplink('wan', true, 1000, 100, true), uplink('wwan', true, 0, 0, false)] }), CFG);
	collector.tick(st, snap(1, { uplinks: [uplink('wan', true, 9000, 900, true), uplink('wwan', true, 10, 1, false)] }), CFG);
	eq(points('wan', 'wan', '12m').totals, { down: 8000, up: 800 });
	// health keeps latency as ms and loss as percent
	const h = points('health', 'wan', '24h');
	eq(h.fields, ['gatewayMs', 'gatewayLoss', 'internetMs', 'internetLoss']);
	eq(h.points[0], [2, 0, 21.5, 25]);

	collector.tick(st, snap(2, { uplinks: [uplink('wan', false, null, null, false), uplink('wwan', true, 20, 2, true)] }), CFG);
	collector.tick(st, snap(3, { uplinks: [uplink('wan', true, 50, 5, true), uplink('wwan', true, 30, 3, false)] }), CFG);
	eq(map(reverse(stats.events({}).events), (e) => [e.kind, e.subject, e.name]), [
		['wan.down', 'wan', ''], ['wan.failover', 'wwan', 'wan'], ['wan.up', 'wan', ''], ['wan.failover', 'wan', 'wwan'],
	]);
	// the cable was out: counting restarts, so the first minute back isn't a jump from the old counter
	eq(points('wan', 'wan', '12m').totals, { down: 8000, up: 800 });
});

test('the router: CPU and memory as percent, temperature, and a heat alert with a margin', () => {
	const st = fresh();
	const at = (m, busy, temp) => snap(m, { cpu: { busy, total: 1000 * (m + 1) }, mem: { total: 800000, avail: 200000 }, temp });
	collector.tick(st, at(0, 0, 60), CFG);
	collector.tick(st, at(1, 250, 61.5), CFG);
	// the day chart folds minutes into five-minute points, so read the minutes themselves
	const sys = ring.read(stats.ringPath('system', 'router'), 0, T0 + 600, 0).rows;
	const minute = filter(sys, (r) => r != null);
	eq(minute, [[null, 750, 600], [250, 750, 615]]);
	eq(stats.series({ kind: 'system', id: 'router', range: '24h' }, T0 + 600).fields, ['cpu', 'mem', 'temp']);

	collector.tick(st, at(2, 300, 86), CFG);
	collector.tick(st, at(3, 350, 87), CFG);
	collector.tick(st, at(4, 400, 82), CFG);
	collector.tick(st, at(5, 450, 90), CFG);
	// one alert while it stays hot; 82 is still within 5 degrees of the limit, so no second one after it
	eq(filter(stats.events({}).events, (e) => e.kind == 'temp.high')[0].value, 86);
	eq(length(filter(stats.events({}).events, (e) => e.kind == 'temp.high')), 1);
});

test('history survives a reboot: saved to flash, restored into empty RAM', () => {
	const st = fresh();
	const mac = '0D:00:00:00:00:01';
	collector.tick(st, snap(0, { clients: [client(mac, '192.168.8.10', 100, 10)] }), CFG);
	collector.tick(st, snap(1, { clients: [client(mac, '192.168.8.10', 600, 60)] }), CFG);
	ok(collector.save());
	// the saved copy is where the status says
	ok(api.status.call({ args: {} }).saved.bytes > 40000);

	for (let name in lsdir(stats.dir())) unlink(`${stats.dir()}/${name}`);
	eq(api.series.call({ args: { kind: 'client', id: mac, range: '24h' } }).error != null, true);
	ok(stats.restore());
	eq(points('client', mac, '12m').totals, { down: 500, up: 50 });
	// a collector that starts now knows the router was already seeded
	eq(collector.newState().seeded, true);
	// restoring never overwrites history that is already there
	ok(!stats.restore());
});

test('the event list is bounded', () => {
	for (let i = 1; i <= stats.MAX_EVENTS + 120; i++) stats.addEvent({ id: 10000 + i, t: T0 + i, kind: 'wan.up', subject: 'wan', name: '', value: null, alert: false });
	const n = length(readfile(`${stats.dir()}/events.jsonl`) ? split(trim(readfile(`${stats.dir()}/events.jsonl`)), '\n') : []);
	ok(n <= stats.MAX_EVENTS + 50, `${n} events kept`);
});

test('a clock that is not set yet is not sampled', () => {
	ok(collector.MIN_TIME > 1600000000);
});

done();
