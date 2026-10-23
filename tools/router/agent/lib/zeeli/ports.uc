// zeeli.ports: what each physical port is doing, and the port profiles kept in /etc/config/zeeli.
//
// The port list is GL’s own map, /etc/config/eth_ports_config_map, so labels and roles match
// the firmware. Link state comes from where the hardware reports it:
//   gsw ports (LAN1 to LAN4, an RTL8372N behind eth1): swconfig dev <switch> port <n> get link
//   dsa ports (the WAN, eth0): /sys/class/net/<dev>/{carrier,speed,duplex}
// The RTL8372N has no readable MAC table (no dump_arl), so a device behind a gsw port is only
// known when one LAN port has a cable: then every wired MAC the bridge learned on the switch's
// VLAN devices must be behind it, and is marked `inferred`. Otherwise those MACs come back in
// `unattributed`. On dsa ports the bridge FDB names the port outright.
//
// Profiles are only stored here. Applying one is GL’s cable.set_port_config, called by the console,
// so GL’s port settings stay the one source of truth.
'use strict';

import { open, readfile, stat, writefile } from 'fs';
import { cursor, fail, paths, run } from 'zeeli.common';

/** Tests replace these to feed canned hardware output. */
const probe = {
	swconfig: function(sw, port) {
		return run(['swconfig', 'dev', sw, 'port', `${port}`, 'get', 'link']).stdout;
	},
	sys: function(dev, file) {
		return trim(readfile(`/sys/class/net/${dev}/${file}`) ?? '');
	},
	fdb: function() {
		return run(['bridge', 'fdb', 'show']).stdout;
	},
};

const DEV = /^[A-Za-z0-9_.-]{1,15}$/;
const SWITCH = /^switch[0-9]{1,2}$/;

/** `port:7 link:up speed:2500baseT full-duplex` → { link, speedMbps, duplex }. */
function parseSwconfig(out) {
	const link = match(out, /link:(up|down)/);
	if (!link) return { link: null, speedMbps: null, duplex: null };
	const speed = match(out, /speed:([0-9]+)base/);
	const duplex = match(out, /(full|half)-duplex/);
	return { link: link[1] == 'up', speedMbps: speed ? int(speed[1]) : null, duplex: duplex ? duplex[1] : null };
}

function sysLink(dev) {
	if (!match(dev, DEV)) return { link: null, speedMbps: null, duplex: null };
	const carrier = probe.sys(dev, 'carrier');
	if (carrier == '') return { link: null, speedMbps: null, duplex: null };
	const speed = int(probe.sys(dev, 'speed'));
	const duplex = probe.sys(dev, 'duplex');
	return {
		link: carrier == '1',
		// a down link reports -1
		speedMbps: carrier == '1' && speed > 0 ? speed : null,
		duplex: carrier == '1' && (duplex == 'full' || duplex == 'half') ? duplex : null,
	};
}

/** Learned (not permanent) unicast MACs and the device each was learned on. */
function parseFdb(out) {
	const found = [];
	for (let line in split(out, '\n')) {
		const m = match(line, /^([0-9a-f]{2}(:[0-9a-f]{2}){5}) dev ([^ ]+) (.*)$/);
		if (!m || index(split(m[4], ' '), 'permanent') >= 0 || index(split(m[4], ' '), 'self') >= 0) continue;
		// a multicast address has the low bit of its first byte set
		if (int(substr(m[1], 1, 1), 16) % 2 == 1) continue;
		push(found, { mac: uc(m[1]), dev: m[3] });
	}
	return found;
}

function status() {
	const c = cursor();
	const ports = [];
	c.foreach('eth_ports_config_map', 'port', (s) => {
		push(ports, { ...s });
	});
	const fdb = parseFdb(probe.fdb());
	const rows = [];
	// per switch: its LAN-role ports that have a cable, to decide whether devices can be placed
	const active = {};
	for (let p in ports) {
		const gsw = p.type == 'gsw';
		const link = gsw && match(`${p.switch}`, SWITCH) && match(`${p.port}`, /^[0-9]{1,2}$/)
			? parseSwconfig(probe.swconfig(p.switch, p.port))
			: sysLink(p.type == 'dsa' ? `${p.port}` : '');
		const role = p.mode == 'wan' ? 'wan' : 'lan';
		push(rows, {
			name: p.name,
			label: p.silk ?? p.name,
			role,
			kind: gsw ? 'switch' : 'direct',
			...link,
			devices: [],
		});
		if (gsw && role == 'lan' && link.link) active[p.switch] = [...(active[p.switch] ?? []), length(rows) - 1];
	}
	const unattributed = [];
	for (let i, p in ports) {
		if (p.type == 'dsa') rows[i].devices = map(filter(fdb, (e) => e.dev == p.port), (e) => ({ mac: e.mac, inferred: false }));
	}
	// everything the bridge learned on a switch’s VLAN devices (eth1, eth1.9, …)
	const switches = uniq(map(filter(ports, (p) => p.type == 'gsw'), (p) => `${p.switch}|${p.main_interface}`));
	for (let sw in switches) {
		const parts = split(sw, '|');
		const name = parts[0], main = parts[1];
		const behind = filter(fdb, (e) => e.dev == main || index(`${e.dev}`, `${main}.`) == 0);
		if (length(active[name] ?? []) == 1) rows[active[name][0]].devices = map(behind, (e) => ({ mac: e.mac, inferred: true }));
		else push(unattributed, ...map(behind, (e) => ({ mac: e.mac })));
	}
	return { ports: rows, unattributed };
}

/* ---------- profiles ---------- */

function ensureConfig() {
	const file = `${paths.confdir ?? '/etc/config'}/zeeli`;
	if (!stat(file)) writefile(file, '');
}

function profileRow(s) {
	return { id: s['.name'], name: s.name ?? '', untagged: s.untagged ?? '', tagged: type(s.tagged) == 'array' ? s.tagged : s.tagged ? [s.tagged] : [] };
}

function profiles() {
	const all = cursor().get_all('zeeli') ?? {};
	const found = filter(map(keys(all), (k) => all[k]), (s) => s['.type'] == 'port_profile' && s.zeeli == '1');
	return { profiles: sort(map(found, profileRow), (a, b) => (lc(a.name) < lc(b.name) ? -1 : 1)) };
}

/** A network’s key as GL names it: main, guest, iot or the name a person gave a custom one. */
const validNetwork = (s) => type(s) == 'string' && length(s) >= 1 && length(s) <= 32 && !match(s, /[[:cntrl:]'"\\]/);

/** Create a profile, or change the one with `id`. */
function profile_save(a) {
	const name = type(a.name) == 'string' ? trim(a.name) : '';
	if (name == '' || length(name) > 32 || match(name, /[[:cntrl:]]/)) return fail('Give the profile a name of up to 32 characters.');
	if (!validNetwork(a.untagged)) return fail('Pick the network this profile carries untagged.');
	const tagged = uniq(filter(a.tagged ?? [], (n) => n != a.untagged));
	if (length(tagged) > 16 || length(filter(tagged, (n) => !validNetwork(n)))) return fail('Tagged networks must be network names, up to 16.');

	ensureConfig();
	const c = cursor();
	c.get_all('zeeli');
	const existing = profiles().profiles;
	if (length(filter(existing, (p) => lc(p.name) == lc(name) && p.id != a.id))) return fail(`A profile called ${name} already exists.`);
	let id = a.id;
	if (id != null) {
		if (!length(filter(existing, (p) => p.id == id))) return fail('That profile is gone. Reload the list.');
	} else {
		const f = open('/dev/urandom', 'r');
		id = `zeeli_pp_${hexenc(f.read(3))}`;
		f.close();
		c.set('zeeli', id, 'port_profile');
		c.set('zeeli', id, 'zeeli', '1');
	}
	c.set('zeeli', id, 'name', name);
	c.set('zeeli', id, 'untagged', a.untagged);
	if (length(tagged)) c.set('zeeli', id, 'tagged', tagged);
	else c.delete('zeeli', id, 'tagged');
	c.save('zeeli');
	if (!c.commit('zeeli')) return fail(`The router wouldn’t save the profile: ${c.error() ?? 'unknown error'}`);
	return { profile: profileRow(c.get_all('zeeli')[id]) };
}

function profile_delete(a) {
	const c = cursor();
	c.get_all('zeeli');
	if (type(a.id) != 'string' || !length(filter(profiles().profiles, (p) => p.id == a.id))) return fail('That profile is already gone.');
	c.delete('zeeli', a.id);
	c.save('zeeli');
	if (!c.commit('zeeli')) return fail(`The router wouldn’t delete the profile: ${c.error() ?? 'unknown error'}`);
	return { id: a.id };
}

// this ucode needs exports listed rather than marked inline
export { probe, parseSwconfig, parseFdb, status, profiles, profile_save, profile_delete };
