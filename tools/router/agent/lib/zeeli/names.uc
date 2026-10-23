// zeeli.names: every named device answers as <name>.lan. The names (and the devices a person
// has dismissed from onboarding) live in /etc/config/zeeli; the address book dnsmasq reads is
// /tmp/hosts/zeeli, rebuilt from them and each device's current address, so it never needs
// flash writes. dnsmasq reads every file in /tmp/hosts (addn-hosts), and OpenWrt's reload
// sends it SIGHUP.
'use strict';

import { readfile, unlink, writefile } from 'fs';
import { fail, paths, services, valid } from 'zeeli.common';
import * as store from 'zeeli.store';

const SECTION = 'zeeli_names';
const MAX_DEVICES = 256;

/** Where dnsmasq looks for extra hosts; tests keep it in their sandbox. */
const hostsFile = () => (paths.confdir ? `${paths.state}/hosts-zeeli` : '/tmp/hosts/zeeli');

/** "Nas 01 (Garage)" -> "nas-01-garage": a DNS label, or '' when nothing usable is left. */
function slugify(name) {
	let s = lc(`${name ?? ''}`);
	s = replace(s, /[^a-z0-9]+/g, '-');
	s = replace(s, /^-+|-+$/g, '');
	return substr(s, 0, 63);
}

/** The local zone dnsmasq answers on its own: the name in `local='/lan/'`, else lan. */
function zone(c) {
	const local = c.get('dhcp', '@dnsmasq[0]', 'local');
	const m = match(type(local) == 'array' ? local[0] : local, /^\/([a-z0-9-]+)\/$/);
	return m ? m[1] : 'lan';
}

/** devices [{ mac, name }] -> [{ mac, name, host }]. Repeats get -2, -3 in MAC order, so they stay put. */
function hostnames(devices) {
	const sorted = sort(map(devices, (d) => ({ ...d })), (a, b) => (a.mac < b.mac ? -1 : a.mac > b.mac ? 1 : 0));
	const taken = {};
	for (let d in sorted) {
		const base = slugify(d.name);
		if (!length(base)) {
			d.host = '';
			continue;
		}
		let host = base;
		for (let n = 2; taken[host]; n++) host = substr(base, 0, 62 - length(`${n}`)) + `-${n}`;
		taken[host] = true;
		d.host = host;
	}
	return sorted;
}

/** The hosts file: one "address name.zone" line per named device whose address is known. */
function render(devices, ips, domain) {
	const lines = [];
	for (let d in hostnames(devices)) {
		const ip = ips[d.mac];
		if (length(d.host) && ip) push(lines, `${ip} ${d.host}.${domain}`);
	}
	return length(lines) ? `# Zeeli: device names\n${join('\n', lines)}\n` : '';
}

/* ---------- stored settings ---------- */

const asList = (v) => (type(v) == 'array' ? v : v == null ? [] : [v]);

function read(c) {
	const devices = [];
	for (let e in asList(c.get('zeeli', SECTION, 'dev'))) {
		const at = index(e, '|');
		if (at > 0) push(devices, { mac: uc(substr(e, 0, at)), name: substr(e, at + 1) });
	}
	return {
		enabled: c.get('zeeli', SECTION, 'enabled') != '0',
		devices,
		dismissed: map(asList(c.get('zeeli', SECTION, 'dismissed')), (m) => uc(m)),
	};
}

function write(c, s) {
	c.delete('zeeli', SECTION);
	c.set('zeeli', SECTION, 'names');
	c.set('zeeli', SECTION, 'zeeli', '1');
	c.set('zeeli', SECTION, 'enabled', s.enabled ? '1' : '0');
	if (length(s.devices)) c.set('zeeli', SECTION, 'dev', map(s.devices, (d) => `${d.mac}|${d.name}`));
	if (length(s.dismissed)) c.set('zeeli', SECTION, 'dismissed', s.dismissed);
	c.commit('zeeli');
}

/* ---------- the hosts file ---------- */

/** Rebuild the hosts file, and tell dnsmasq only when it changed. */
function apply(c, s, ips) {
	const text = s.enabled ? render(s.devices, ips, zone(c)) : '';
	const file = hostsFile();
	if ((readfile(file) ?? '') == text) return false;
	if (length(text)) writefile(file, text);
	else unlink(file);
	services.reload('dnsmasq');
	return true;
}

/** The collector calls this every tick with the router's current clients. */
function refresh(clients) {
	try {
		const c = store.open();
		const ips = {};
		for (let k in clients) if (length(k.ip)) ips[k.mac] = k.ip;
		apply(c, read(c), ips);
	} catch (e) {
		// a naming problem must never stop the history
	}
}

/* ---------- the calls ---------- */

function list() {
	const c = store.open();
	const s = read(c);
	const hosts = {};
	for (let d in hostnames(s.devices)) hosts[d.mac] = d.host;
	return {
		enabled: s.enabled,
		zone: zone(c),
		devices: map(s.devices, (d) => ({ mac: d.mac, name: d.name, host: hosts[d.mac] })),
		dismissed: s.dismissed,
	};
}

/** The console's named devices, the whole list: [{ mac, name, ip }]. */
function sync(args) {
	const devices = [], ips = {};
	if (type(args.devices) != 'array' || length(args.devices) > MAX_DEVICES) return fail(`Names are kept for up to ${MAX_DEVICES} devices.`);
	for (let d in args.devices) {
		if (type(d) != 'object' || !valid.mac(d.mac) || type(d.name) != 'string' || match(d.name, /[[:cntrl:]]/)) return fail('That device list isn’t valid.');
		push(devices, { mac: uc(d.mac), name: trim(d.name) });
		if (type(d.ip) == 'string' && match(d.ip, /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/)) ips[uc(d.mac)] = d.ip;
	}
	const c = store.open();
	const s = { ...read(c), devices };
	write(c, s);
	apply(c, s, ips);
	return list();
}

function setEnabled(args) {
	if (type(args.enabled) != 'bool') return fail('Choose on or off.');
	const c = store.open();
	const s = { ...read(c), enabled: args.enabled };
	write(c, s);
	// switching on waits for the next sync or tick for addresses; switching off empties the file now
	if (!s.enabled) apply(c, s, {});
	return list();
}

/** Mark devices as set up (or bring them back to "new"). */
function dismiss(args) {
	const macs = store.checkMacs(args.macs);
	if (macs.error) return macs;
	const c = store.open();
	const s = read(c);
	const kept = filter(s.dismissed, (m) => index(macs.macs, m) < 0);
	write(c, { ...s, dismissed: args.dismissed ? uniq([...kept, ...macs.macs]) : kept });
	return list();
}

export { slugify, hostnames, render, zone, list, sync, setEnabled, dismiss, refresh };
