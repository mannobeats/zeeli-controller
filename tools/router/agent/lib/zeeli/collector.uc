// zeeli.collector: the minute loop. `tick` turns one snapshot of the router into history
// (rings.uc) and events; it takes the snapshot as an argument so tests can feed it made-up
// ones. `run` is the service: ucode here has no uloop, so it samples, sleeps until the next
// minute and samples again, doing nothing in between.
'use strict';

import { stat } from 'fs';
import * as ring from 'zeeli.ring';
import * as stats from 'zeeli.stats';
import { inNet, snapshot } from 'zeeli.sources';

/** A clock before this isn't set yet (the router is still waiting for NTP). */
const MIN_TIME = 1700000000;
const PERSIST_EVERY = 900;
const SUMMARY_EVERY = 600;

const round = (x) => int(x + 0.5);
/** a / b rounded to the nearest whole number (ucode divides whole numbers without a fraction) */
const ratio = (a, b) => int((a * 2 + b) / (b * 2));
const tenths = (x) => x == null ? null : round(x * 10);

function toSet(list) {
	const out = {};
	for (let k in list) out[k] = true;
	return out;
}

/** What the collector remembers between ticks: counter baselines and who was connected. */
function newState() {
	const present = stats.readJson(`${stats.dir()}/presence.json`);
	return {
		seq: stats.lastEventId(),
		// the very first run only learns what's here, so it doesn't call every device new
		seeded: stat(`${stats.dir()}/seeded.json`) != null,
		present: present ? toSet(present) : null,
		clients: {},
		wan: {},
		wanUp: {},
		active: null,
		hot: false,
		cpu: null,
		warm: false,
		persisted: time(),
		summarized: 0,
	};
}

/** Bytes since the last tick. A counter that went down was reset (reboot, cleared), so it counts from zero. */
function delta(prev, cur) {
	if (!prev) return null;
	return [cur.down >= prev.down ? cur.down - prev.down : cur.down, cur.up >= prev.up ? cur.up - prev.up : cur.up];
}

function emit(st, cfg, t, kind, subject, name, value) {
	st.seq++;
	stats.addEvent({ id: st.seq, t, kind, subject, name: name ?? '', value: value ?? null, alert: kind in cfg.alerts });
}

/** Record one snapshot: history for every device, network and uplink, and the events it shows. */
function tick(st, snap, cfg) {
	stats.mkdirp(stats.dir());
	const t = snap.t;
	// the sample covers the minute that just ended
	const at = int((t - 30) / 60) * 60;
	const off = ring.tzoff(t);
	const put = (kind, key, values) => ring.put(stats.ringPath(kind, key), stats.KINDS[kind], at, values, off);

	// devices, and the networks they add up to
	const online = {}, names = {}, nets = {};
	for (let n in snap.networks) nets[n.name] = [0, 0];
	for (let c in snap.clients) {
		const key = stats.keyOf('client', c.mac);
		const known = stat(stats.ringPath('client', key)) != null;
		names[c.mac] = c.name;
		let prev = st.clients[c.mac];
		if (c.online) {
			online[c.mac] = true;
			// new: no history, and not in the list on an earlier tick either
			if (!known && st.seeded && !prev) {
				emit(st, cfg, t, 'device.new', c.mac, c.name);
				prev = { down: 0, up: 0 };
			}
			const d = delta(prev, c);
			if (d) {
				put('client', key, d);
				for (let n in snap.networks) {
					if (!inNet(c.ip, n)) continue;
					nets[n.name][0] += d[0];
					nets[n.name][1] += d[1];
					break;
				}
			}
		}
		st.clients[c.mac] = { down: c.down, up: c.up };
	}
	if (st.warm) for (let name, v in nets) put('network', name, v);
	if (st.present) {
		for (let mac in online) if (!st.present[mac]) emit(st, cfg, t, 'device.joined', mac, names[mac]);
		for (let mac in st.present) if (!online[mac]) emit(st, cfg, t, 'device.left', mac, names[mac]);
	}
	st.present = online;
	stats.writeAtomic(`${stats.dir()}/presence.json`, sprintf('%J', keys(online)));

	// uplinks: bytes, health and what changed
	let active = null;
	for (let u in snap.uplinks) {
		const was = st.wanUp[u.name];
		if (was != null && was != u.up) emit(st, cfg, t, u.up ? 'wan.up' : 'wan.down', u.name);
		st.wanUp[u.name] = u.up;
		if (u.active) active = u.name;
		if (!u.up) {
			delete st.wan[u.name]; // count from zero when it comes back
			continue;
		}
		if (u.rx != null) {
			const d = delta(st.wan[u.name], { down: u.rx, up: u.tx });
			if (d) put('wan', u.name, d);
			st.wan[u.name] = { down: u.rx, up: u.tx };
		}
		put('health', u.name, [
			u.gw?.ms == null ? null : round(u.gw.ms * 100), u.gw ? tenths(u.gw.loss) : null,
			u.net?.ms == null ? null : round(u.net.ms * 100), u.net ? tenths(u.net.loss) : null,
		]);
	}
	if (active && st.active && active != st.active) emit(st, cfg, t, 'wan.failover', active, st.active);
	if (active) st.active = active;

	// the router itself
	let cpu = null;
	if (snap.cpu && st.cpu && snap.cpu.total > st.cpu.total)
		cpu = ratio(1000 * (snap.cpu.busy - st.cpu.busy), snap.cpu.total - st.cpu.total);
	st.cpu = snap.cpu;
	put('system', 'router', [cpu, snap.mem ? ratio(1000 * (snap.mem.total - snap.mem.avail), snap.mem.total) : null, tenths(snap.temp)]);
	if (snap.temp != null) {
		if (snap.temp >= cfg.tempHigh && !st.hot) {
			st.hot = true;
			emit(st, cfg, t, 'temp.high', 'router', '', round(snap.temp));
		} else if (snap.temp < cfg.tempHigh - 5) {
			st.hot = false;
		}
	}

	st.warm = true;
	if (!st.seeded) {
		stats.writeAtomic(`${stats.dir()}/seeded.json`, sprintf('%J', { since: t }));
		st.seeded = true;
	}
}

/** Save to flash, dropping what's a year old first. Also what `stop` runs. */
function save() {
	stats.prune();
	return stats.persist();
}

function run() {
	stats.restore();
	const st = newState();
	for (;;) {
		const t = time();
		if (t >= MIN_TIME) {
			const began = clock();
			const cfg = stats.config();
			tick(st, snapshot(cfg.target), cfg);
			const done = clock();
			stats.writeAtomic(`${stats.dir()}/status.json`, sprintf('%J', { t, took: (done[0] - began[0]) * 1000 + int((done[1] - began[1]) / 1000000) }));
			if (t - st.summarized >= SUMMARY_EVERY) {
				stats.summarize();
				st.summarized = t;
			}
			if (t - st.persisted >= PERSIST_EVERY) {
				save();
				st.persisted = t;
			}
		}
		// the next minute, a few seconds in so counters have settled
		const now = time();
		sleep(((int(now / 60) + 1) * 60 + 3 - now) * 1000);
	}
}

export { MIN_TIME, newState, tick, save, run };
