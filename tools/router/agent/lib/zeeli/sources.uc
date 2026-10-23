// zeeli.sources: where the collector's numbers come from, and the parsers for them. Reading
// is cheap (a few small files and two ubus calls); the only commands are the pings.
//
// Which counters are right with hardware acceleration on:
// - an uplink's own netdev (`/sys/class/net/<l3_device>/statistics`): GL's own WAN speed
//   reads the same files, and traffic to and from the router itself is counted too;
// - a device's bytes: GL's `gl-clients` list, whose totals its `oui-tertf` kernel module
//   counts for every client, offloaded flows included. The bridge counters (`br-lan`) can
//   miss flows the hardware forwards, so a network's bytes are the sum over its devices.
'use strict';

import { lsdir, popen, readfile } from 'fs';
import { connect } from 'ubus';
import { shellquote, valid } from 'zeeli.common';

/** Interface names that are uplinks (GL's naming); `wan6` and the like are the same link's IPv6. */
const UPLINK = /^(wan[2-5]?|secondwan|wwan|tethering|modem_[0-9]+_[0-9]+_[0-9]+)$/;

/* ---------- parsers ---------- */

/** /proc/stat -> busy and total jiffies across all cores. */
function parseStat(text) {
	const line = split(text ?? '', '\n')[0] ?? '';
	if (substr(line, 0, 4) != 'cpu ') return null;
	const f = map(split(trim(substr(line, 4)), /\s+/), (x) => int(x));
	let total = 0;
	for (let i = 0; i < 8 && i < length(f); i++) total += f[i];
	return { busy: total - (f[3] ?? 0) - (f[4] ?? 0), total };
}

/** /proc/meminfo -> kB total and available. */
function parseMeminfo(text) {
	const total = match(text ?? '', /MemTotal:\s+([0-9]+)/), avail = match(text ?? '', /MemAvailable:\s+([0-9]+)/);
	return total && avail ? { total: int(total[1]), avail: int(avail[1]) } : null;
}

/** /proc/net/route -> the device the lowest-metric default route leaves by. */
function parseRoute(text) {
	let best = null;
	for (let line in slice(split(text ?? '', '\n'), 1)) {
		const f = split(trim(line), /\s+/);
		if (length(f) < 8 || f[1] != '00000000' || f[7] != '00000000' || !(hex(f[3]) & 1)) continue;
		if (!best || int(f[6]) < best.metric) best = { dev: f[0], metric: int(f[6]) };
	}
	return best?.dev;
}

/** busybox `ping -q` -> loss in percent and the average round trip in ms (null if nothing came back). */
function parsePing(text) {
	const sent = match(text ?? '', /([0-9]+) packets transmitted, ([0-9]+) packets received/);
	const rtt = match(text ?? '', /min\/avg\/max = [0-9.]+\/([0-9.]+)\/[0-9.]+ ms/);
	if (!sent || int(sent[1]) == 0) return { loss: 100, ms: null };
	return { loss: int(((int(sent[1]) - int(sent[2])) * 200 + int(sent[1])) / (int(sent[1]) * 2)), ms: rtt ? rtt[1] * 1 : null };
}

/** "192.168.8.1" -> a number, so subnets can be compared. */
function ip4(s) {
	const p = split(s ?? '', '.');
	if (length(p) != 4) return null;
	return (int(p[0]) << 24) | (int(p[1]) << 16) | (int(p[2]) << 8) | int(p[3]);
}

const maskOf = (bits) => bits <= 0 ? 0 : (0xffffffff << (32 - bits)) & 0xffffffff;

/** Is `ip` inside the network { addr, bits }? */
function inNet(ip, net) {
	const a = ip4(ip);
	return a != null && (a & maskOf(net.bits)) == (net.addr & maskOf(net.bits));
}

/** netifd's interface dump -> the uplinks and the LAN networks. */
function parseInterfaces(dump) {
	const uplinks = [], networks = [];
	for (let i in dump?.interface ?? []) {
		const name = i.interface, dev = i.l3_device ?? i.device;
		if (match(name, UPLINK)) {
			const gw = filter(i.route ?? [], (r) => r.target == '0.0.0.0' && r.mask == 0)[0];
			push(uplinks, { name, up: i.up == true, dev: i.up ? dev : null, gateway: gw?.nexthop ?? null });
		} else if (i.up && i.proto == 'static' && substr(dev ?? '', 0, 3) == 'br-' && length(i['ipv4-address'] ?? [])) {
			const a = i['ipv4-address'][0];
			push(networks, { name, addr: ip4(a.address), bits: a.mask });
		}
	}
	return { uplinks, networks };
}

/** gl-clients `list` -> one entry per device with its running totals. */
function parseClients(res) {
	const out = [];
	for (let mac, c in res?.clients ?? {}) {
		if (!valid.mac(mac) || uc(mac) == 'FF:FF:FF:FF:FF:FF') continue;
		push(out, { mac: uc(mac), name: c.name ?? '', ip: c.ip ?? '', online: c.online == true, down: int(c.total_rx ?? 0), up: int(c.total_tx ?? 0) });
	}
	return out;
}

/* ---------- reading the router ---------- */

let bus = null;

function ubusCall(object, method) {
	if (!bus) {
		bus = connect();
		// connecting installs uloop's handlers, which swallow SIGTERM when no uloop runs, so
		// procd could never stop us short of SIGKILL
		signal('SIGTERM', 'default');
		signal('SIGINT', 'default');
	}
	const r = bus?.call(object, method, {});
	if (r == null) bus = null; // reconnect next time
	return r;
}

function counters(dev) {
	const rx = readfile(`/sys/class/net/${dev}/statistics/rx_bytes`), tx = readfile(`/sys/class/net/${dev}/statistics/tx_bytes`);
	return rx != null && tx != null ? { rx: int(trim(rx)), tx: int(trim(tx)) } : null;
}

/** The hottest thermal zone, in °C. */
function temperature() {
	let hot = null;
	for (let zone in lsdir('/sys/class/thermal') ?? []) {
		if (substr(zone, 0, 12) != 'thermal_zone') continue;
		const v = readfile(`/sys/class/thermal/${zone}/temp`);
		if (v != null && (hot == null || int(trim(v)) > hot)) hot = int(trim(v));
	}
	return hot == null ? null : hot / 1000.0;
}

/** Start a ping and return the running process, so several can run side by side. */
function startPing(dev, target) {
	const argv = ['ping', '-A', '-c', '4', '-w', '3', '-W', '1', '-q', '-I', dev, target];
	return popen(join(' ', map(argv, shellquote)) + ' 2>&1', 'r');
}

function finishPing(p) {
	if (!p) return null;
	const out = parsePing(p.read('all'));
	p.close();
	return out;
}

/** Everything one tick needs. `target` is the public address to ping. */
function snapshot(target) {
	const t = time();
	const found = parseInterfaces(ubusCall('network.interface', 'dump'));
	const uplinks = found.uplinks, networks = found.networks;
	for (let u in uplinks) {
		const c = u.dev ? counters(u.dev) : null;
		u.rx = c?.rx;
		u.tx = c?.tx;
	}
	const active = parseRoute(readfile('/proc/net/route'));
	// pings run in parallel while the rest is read
	const pings = map(uplinks, (u) => u.up && u.dev ? { gw: u.gateway ? startPing(u.dev, u.gateway) : null, net: startPing(u.dev, target) } : null);
	const clients = parseClients(ubusCall('gl-clients', 'list'));
	const cpu = parseStat(readfile('/proc/stat')), mem = parseMeminfo(readfile('/proc/meminfo')), temp = temperature();
	for (let i = 0; i < length(uplinks); i++) {
		uplinks[i].gw = pings[i] ? finishPing(pings[i].gw) : null;
		uplinks[i].net = pings[i] ? finishPing(pings[i].net) : null;
		uplinks[i].active = uplinks[i].dev != null && uplinks[i].dev == active;
	}
	return { t, uplinks, networks, clients, cpu, mem, temp };
}

export { parseStat, parseMeminfo, parseRoute, parsePing, parseInterfaces, parseClients, ip4, inNet, snapshot };
