// zeeli.wifi: WiFi networks of our own, on any radio and any LAN network. Installed as
// /usr/share/ucode/zeeli/wifi.uc. The firmware's own slots (main, guest, IoT, MLO, mesh)
// are listed but never written here; the console keeps editing those through GL's API.
//
// Every write is committed to /etc/config/wireless straight away but does not touch the
// radios: `apply` does (one `wifi reload` for a whole batch of edits). See "WiFi and the
// firmware" in tools/router/agent/README.md for what that command does to devices.
//
// ucode compiles top to bottom: a function has to be defined above the code that calls it.
'use strict';

import { cursor, fail, run, paths } from 'zeeli.common';
import { readfile, writefile, mkdir, unlink, stat } from 'fs';

/** The radio's interface combinations say `#{ AP } <= 17, total <= 17` (iw phy info). */
const LIMIT = 17;
const BANDS = ['2g', '5g', '6g'];
const BAND_NAME = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz' };
const SECURITY = ['sae', 'sae-mixed', 'psk2'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ID = /^[a-z0-9]{4,12}$/;
const SECTION = /^zeeli_([a-z0-9]{4,12})_(2g|5g|6g)$/;
/**
 * The driver tells MLDs apart by a number below 16 (MAX_AP_MLDS_PER_LINK in umac.ko), and the
 * wifi scripts take that number from the digits of the `wifi-mld` section's name. GL's panel uses
 * mld0 and mld1; ours are zeeli_mld2 up, so GL's `^mld` matching never sees them.
 */
const MLD_LIMIT = 16;
const MLD_NAME = /^zeeli_mld([0-9]+)$/;

/**
 * Options a person can set. `rrm` and `bssTransition` start on, like the firmware's main networks.
 * `maxClients` and `dtim` take 0 (or null) for "the radio's own default": blobmsg has no null.
 */
const OPTION_DEFAULTS = { fastRoaming: false, rrm: true, bssTransition: true, maxClients: null, multicastToUnicast: false, dtim: null };
/** The UCI keys those options own: all deleted before a section is rewritten. */
const OPTION_KEYS = [
	'sae_pwe', 'ieee80211r', 'mobility_domain', 'nasid', 'r1_key_holder', 'ft_psk_generate_local', 'ft_over_ds',
	'ieee80211k', 'bss_transition', 'maxsta', 'mcastenhance', 'multicast_to_unicast', 'dtim_period'
];

// ---- small helpers -------------------------------------------------------------------

function pendingFile() {
	return `${paths.state}/wifi-pending`;
}

function markPending(on) {
	mkdir(paths.state);
	if (on) writefile(pendingFile(), '1\n');
	else unlink(pendingFile());
}

function sections(c, config, type) {
	const out = [];
	c.foreach(config, type, (s) => { push(out, s); });
	return out;
}

function uniq(a) {
	const seen = {};
	return filter(a, (x) => { if (seen[x]) return false; seen[x] = true; return true; });
}

function bandOrder(a, b) {
	return index(BANDS, a) - index(BANDS, b);
}

function randomBytes(n) {
	const b = readfile('/dev/urandom', n);
	if (b == null || length(b) < n) die('no randomness');
	return b;
}

function randomToken(n) {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const b = randomBytes(n);
	let out = '';
	for (let i = 0; i < n; i++) out += substr(chars, ord(b, i) % 36, 1);
	return out;
}

function hex2(n) {
	return sprintf('%02X', n);
}

/** A locally administered unicast address, the way GL makes its random BSSIDs. */
function randomMac() {
	const b = randomBytes(6);
	const o = [];
	for (let i = 0; i < 6; i++) push(o, ord(b, i));
	o[0] = (o[0] & 0xfc) | 0x02;
	return join(':', map(o, hex2));
}

/** /etc/config/zeeli is ours; uci can't stage into a file that isn't there. */
function ensureConfig() {
	const file = `${paths.confdir ?? '/etc/config'}/zeeli`;
	if (stat(file) == null) writefile(file, '');
}

/** Run a command, or in a test sandbox note it in wifi-apply.log instead. */
function runOrLog(argv) {
	if (!paths.confdir) return run(argv);
	mkdir(paths.state);
	const log = `${paths.state}/wifi-apply.log`;
	writefile(log, `${readfile(log) ?? ''}${join(' ', argv)}\n`);
	return { code: 0, stdout: '' };
}

/**
 * Deleting a multi-link network needs a restart. Destroying an MLD while the router runs
 * (`iw <mld> del`, which is also what the configurator does to a fully disabled group) panics
 * the kernel in osif_destroy_mld_bond, seen live. So the sections go and the radios keep
 * running them until the next boot. The file lives in RAM (paths.state), so a boot clears it.
 */
function restartFile() {
	return `${paths.state}/wifi-restart-needed`;
}

function restartFor() {
	try { return json(readfile(restartFile()) ?? 'null'); } catch (e) { return null; }
}

function markRestart(ssid) {
	mkdir(paths.state);
	writefile(restartFile(), sprintf('%J', uniq([...(restartFor() ?? []), ssid])));
}

const MLO_LOCKED = 'On this firmware a multi-link network can’t be changed or switched off while the router runs. Delete it and make it again.';

function teardownFile() {
	return `${paths.state}/wifi-teardown`;
}

/** Interfaces of deleted sections, which `apply` takes off the air. Never a multi-link network's: see `remove`. */
function queueTeardown(ifnames) {
	let queued = [];
	try { queued = json(readfile(teardownFile()) ?? '[]') ?? []; } catch (e) { queued = []; }
	mkdir(paths.state);
	writefile(teardownFile(), sprintf('%J', uniq([...queued, ...filter(ifnames, (n) => n)])));
}

/**
 * The reload builds and updates interfaces from the config, but on this driver it never removes
 * one whose section is gone: the network would stay on the air. So each deleted interface is
 * taken out of hostapd (one process serves every interface) and destroyed in the driver.
 */
function teardown(c) {
	let queued = [];
	try { queued = json(readfile(teardownFile()) ?? '[]') ?? []; } catch (e) { queued = []; }
	const inUse = {};
	for (let s in sections(c, 'wireless', 'wifi-iface')) if (s.ifname) inUse[s.ifname] = true;
	for (let n in queued) {
		if (type(n) != 'string' || !match(n, /^wlan[0-9]+$/) || inUse[n]) continue;
		if (!paths.confdir && stat(`/sys/class/net/${n}`) == null) continue;
		runOrLog(['hostapd_cli', '-p', '/var/run/hostapd', '-i', 'global', 'raw', 'REMOVE', n]);
		runOrLog(['ifconfig', n, 'down']);
		runOrLog(['wlanconfig', n, 'destroy']);
	}
	unlink(teardownFile());
}

// ---- reading -------------------------------------------------------------------------

/** Radios by device name. The band comes from the device, else from its hwmode. */
function radios(c) {
	const out = {};
	for (let d in sections(c, 'wireless', 'wifi-device')) {
		let band = d.band;
		if (!(band in BANDS)) band = match(d.hwmode ?? '', /a$/) ? '5g' : '2g';
		const digits = match(d['.name'], /([0-9]+)$/);
		out[d['.name']] = { device: d['.name'], band, disabled: d.disabled == '1', index: digits ? digits[1] : '0' };
	}
	return out;
}

function bandOf(devs, s) {
	return devs[s.device] ? devs[s.device].band : '2g';
}

function isAp(s) {
	return (s.mode ?? 'ap') == 'ap';
}

function owned(s) {
	return s.zeeli == '1' && match(s['.name'], SECTION) != null;
}

function groupOf(s) {
	return match(s['.name'], SECTION)[1];
}

/** How many of a radio's 17 slots are taken. Firmware slots count even while switched off, because the GL panel can turn them on at any time. */
function used(c, device) {
	let n = 0;
	for (let s in sections(c, 'wireless', 'wifi-iface'))
		if (s.device == device && (isAp(s) || s.disabled != '1')) n++;
	return n;
}

function security(s) {
	const enc = lc(s.encryption ?? 'none');
	const sae = s.sae == '1';
	if (enc == 'none') return 'none';
	if (enc == 'sae' || (sae && match(enc, /^ccmp/))) return 'sae';
	if (enc == 'sae-mixed' || (sae && match(enc, /^psk2/))) return 'sae-mixed';
	if (match(enc, /^psk2/)) return 'psk2';
	if (match(enc, /^psk-mixed/)) return 'psk-mixed';
	return enc;
}

/** The networks a WiFi network can join: an interface whose device is a bridge. */
function lanNetworks(c) {
	const bridges = {};
	for (let d in sections(c, 'network', 'device'))
		if (d.type == 'bridge' && d.name) bridges[d.name] = true;
	const out = [];
	for (let i in sections(c, 'network', 'interface')) {
		if (!(bridges[i.device] || i.type == 'bridge')) continue;
		push(out, { id: i.display_name ?? i['.name'], iface: i['.name'], device: i.device ?? `br-${i['.name']}`, disabled: i.disabled == '1' });
	}
	return out;
}

function networkOf(nets, name) {
	for (let n in nets) if (n.iface == name) return n;
	return null;
}

/** By the name the networks page uses (`main`, `guest`, a custom name) or by UCI interface name. */
function resolveNetwork(c, name) {
	if (type(name) != 'string') return null;
	for (let n in lanNetworks(c)) if (n.id == name || n.iface == name) return n;
	return null;
}

/** The bands the firmware lets an MLD join: GL's /etc/config/mlo, written once by the firmware. */
function mloBands(c) {
	if (c.get_all('mlo', 'global') == null) return [];
	return filter(c.get('mlo', 'global', 'support_bands') ?? [], (b) => b in BANDS);
}

/** The MLD numbers in use, GL's two included. */
function mldNumbers(c) {
	const used = {};
	for (let cfg in ['wireless', 'mlo'])
		for (let s in sections(c, cfg, 'wifi-mld')) {
			const m = match(s['.name'], /([0-9]+)$/);
			if (m) used[m[1]] = true;
		}
	return used;
}

/** The lowest MLD number below the driver's 16 that nothing uses, or null. GL has 0 and 1; ours start at 2. */
function freeMld(c) {
	const used = mldNumbers(c);
	for (let n = 2; n < MLD_LIMIT; n++) if (!used[`${n}`]) return `zeeli_mld${n}`;
	return null;
}

/** Whether another multi-link network can be made, and if not, why in words for the person. */
function mloState(c) {
	const bands = mloBands(c);
	const free = freeMld(c);
	let reason = null;
	if (!length(bands)) reason = 'This router’s firmware has no multi-link (Wi-Fi 7 MLO) support.';
	else if (length(bands) < 2) reason = 'Multi-link needs a router with at least two bands that support it.';
	else if (free == null) reason = `This router holds ${MLD_LIMIT} multi-link networks, and they’re all in use.`;
	return { supported: reason == null, bands, reason };
}

function role(s) {
	if (s.multi_ap == '1') return 'mesh-backhaul';
	if (!isAp(s)) return 'station';
	if (s.mld) return s.guest == '1' ? 'mlo-guest' : 'mlo';
	if (s.guest == '1') return 'guest';
	if (s.iot == '1') return 'iot';
	return match(s['.name'], /^wifi(2g|5g|6g)$/) ? 'main' : 'other';
}

function optionsOf(s) {
	return {
		fastRoaming: s.ieee80211r == '1',
		rrm: s.ieee80211k == '1',
		bssTransition: s.bss_transition == '1',
		maxClients: s.maxsta != null ? +s.maxsta : null,
		multicastToUnicast: s.multicast_to_unicast == '1',
		dtim: s.dtim_period != null ? +s.dtim_period : null
	};
}

function scheduleOf(c, id) {
	const s = c.get_all('zeeli', `wifi_${id}`);
	if (!s || s['.type'] != 'wifi_schedule') return null;
	return { enabled: s.enabled != '0', days: c.get('zeeli', `wifi_${id}`, 'days') ?? [], off: s.off, on: s.on };
}

function firmwareEntry(nets, devs, s) {
	const n = networkOf(nets, s.network);
	return {
		id: s['.name'],
		owner: 'firmware',
		role: role(s),
		ssid: s.ssid ?? '',
		bands: [bandOf(devs, s)],
		network: n ? n.id : (s.network ?? ''),
		iface: s.network ?? '',
		security: security(s),
		hidden: s.hidden == '1',
		isolate: s.isolate == '1',
		disabled: s.disabled == '1',
		hasKey: length(s.key ?? '') > 0
	};
}

/** One entry per Zeeli network: its interfaces (one per radio) share an id. */
function zeeliEntries(c, nets, devs) {
	const groups = {};
	const order = [];
	for (let s in sections(c, 'wireless', 'wifi-iface')) {
		if (!owned(s)) continue;
		const id = groupOf(s);
		if (!groups[id]) { groups[id] = []; push(order, id); }
		push(groups[id], s);
	}
	return map(order, (id) => {
		const list = groups[id];
		const first = list[0];
		const n = networkOf(nets, first.network);
		return {
			id,
			owner: 'zeeli',
			role: null,
			ssid: first.ssid ?? '',
			bands: sort(map(list, (s) => bandOf(devs, s)), bandOrder),
			sections: map(list, (s) => s['.name']),
			network: n ? n.id : (first.network ?? ''),
			iface: first.network ?? '',
			security: security(first),
			hidden: first.hidden == '1',
			isolate: first.isolate == '1',
			disabled: length(filter(list, (s) => s.disabled != '1')) == 0,
			mlo: first.mld != null,
			scheduledOff: length(filter(list, (s) => s.sched_off == '1')) > 0,
			hasKey: length(first.key ?? '') > 0,
			options: optionsOf(first),
			schedule: scheduleOf(c, id)
		};
	});
}

/** Everything the console draws: networks, per-radio slots and the networks one can join. Never a key. */
function list() {
	const c = cursor();
	const devs = radios(c);
	const nets = lanNetworks(c);
	const networks = [];
	const internal = [];
	for (let s in sections(c, 'wireless', 'wifi-iface')) {
		if (owned(s)) continue;
		const r = role(s);
		if (r == 'station' || r == 'mesh-backhaul') push(internal, { id: s['.name'], role: r, bands: [bandOf(devs, s)], disabled: s.disabled == '1' });
		else push(networks, firmwareEntry(nets, devs, s));
	}
	return {
		networks: [...networks, ...zeeliEntries(c, nets, devs)],
		radios: map(sort(keys(devs)), (d) => ({ device: d, band: devs[d].band, disabled: devs[d].disabled, used: used(c, d), limit: LIMIT })),
		lanNetworks: nets,
		mlo: mloState(c),
		restartNeeded: restartFor() != null,
		restartFor: restartFor() ?? [],
		internal,
		pending: stat(pendingFile()) != null
	};
}

/** The sections of one Zeeli network, or a failure the person can read. */
function findGroup(c, id) {
	if (type(id) != 'string' || !match(id, ID)) return fail('That isn’t a network the agent made.');
	const mine = filter(sections(c, 'wireless', 'wifi-iface'), (s) => owned(s) && groupOf(s) == id);
	if (!length(mine)) return fail('That network doesn’t exist, or it belongs to the router’s own settings.');
	return mine;
}

/** The password of one Zeeli network. The only call that ever returns a key. */
function reveal(id) {
	const c = cursor();
	const mine = findGroup(c, id);
	if (type(mine) == 'object') return mine;
	return { password: mine[0].key ?? '' };
}

// ---- validating ----------------------------------------------------------------------

function checkSsid(ssid) {
	if (type(ssid) != 'string' || length(ssid) < 1 || length(ssid) > 32) return 'The network name must be 1 to 32 bytes.';
	if (match(ssid, /[[:cntrl:]]/)) return 'The network name can’t contain control characters.';
	return null;
}

function checkPassword(pw) {
	if (type(pw) != 'string' || length(pw) < 8 || length(pw) > 63) return 'The password must be 8 to 63 characters.';
	if (match(pw, /[^ -~]/)) return 'The password can only use plain letters, numbers, spaces and punctuation.';
	return null;
}

function checkOptions(o) {
	for (let k in o) {
		if (!(k in OPTION_DEFAULTS)) return `Unknown option: ${k}`;
		const v = o[k];
		if (k == 'maxClients' && v != null && v !== 0 && (type(v) != 'int' || v < 1 || v > 128)) return 'Max clients must be 1 to 128.';
		if (k == 'dtim' && v != null && v !== 0 && (type(v) != 'int' || v < 1 || v > 10)) return 'The DTIM period must be 1 to 10.';
		if (type(OPTION_DEFAULTS[k]) == 'bool' && type(v) != 'bool') return `${k} must be on or off.`;
	}
	return null;
}

function checkSchedule(s) {
	if (type(s.days) != 'array' || !length(s.days)) return 'Pick at least one day for the schedule.';
	for (let d in s.days) if (!(d in DAYS)) return `Not a day: ${d}`;
	for (let k in ['off', 'on'])
		if (type(s[k]) != 'string' || !match(s[k], /^([01][0-9]|2[0-3]):[0-5][0-9]$/)) return 'Schedule times look like 22:00.';
	if (s.off == s.on) return 'The schedule turns the network off and on at the same time.';
	return null;
}

function findDevice(devs, band) {
	for (let d in sort(keys(devs))) if (devs[d].band == band) return devs[d];
	return null;
}

/** Checks one band of a network against the radio: switched on, a free slot, no clashing name. */
function checkBand(c, devs, spec, own, b) {
	const dev = findDevice(devs, b);
	if (!dev) return `This router has no ${BAND_NAME[b]} radio.`;
	if (dev.disabled) return `The ${BAND_NAME[b]} radio is switched off.`;
	let have = used(c, dev.device);
	const mine = {};
	for (let s in own) {
		mine[s['.name']] = true;
		if (s.device == dev.device) have--;
	}
	if (have >= LIMIT) return `The ${BAND_NAME[b]} radio is full: it holds ${LIMIT} networks.`;
	for (let s in sections(c, 'wireless', 'wifi-iface'))
		if (s.device == dev.device && isAp(s) && s.ssid == spec.ssid && !mine[s['.name']])
			return `Another network on ${BAND_NAME[b]} is already called “${spec.ssid}”.`;
	return null;
}

/** What a multi-link network adds: WPA3 on every link, two or more bands the firmware allows, and a free MLD. */
function checkMlo(c, spec) {
	if (spec.security != 'sae') return 'Multi-link networks need WPA3.';
	if (length(spec.bands) < 2) return 'Multi-link needs at least two bands.';
	const state = mloState(c);
	if (!state.supported) return state.reason;
	for (let b in spec.bands) if (!(b in state.bands)) return `The router’s firmware doesn’t offer multi-link on ${BAND_NAME[b]}.`;
	return null;
}

/** Checks a complete description of a Zeeli network. `own` are the sections it already has. */
function checkSpec(c, spec, own) {
	let e = checkSsid(spec.ssid) ?? checkPassword(spec.password);
	if (e) return fail(e);
	if (!(spec.security in SECURITY)) return fail('Security must be WPA3, WPA2/WPA3 or WPA2.');
	if (type(spec.bands) != 'array' || !length(spec.bands)) return fail('Pick at least one band.');
	for (let b in spec.bands) if (!(b in BANDS)) return fail(`Not a band: ${b}`);
	if (length(spec.bands) != length(uniq(spec.bands))) return fail('Each band can only be listed once.');
	e = spec.mlo ? checkMlo(c, spec) : null;
	if (e) return fail(e);
	if ('6g' in spec.bands && spec.security != 'sae') return fail('6 GHz needs WPA3. Choose WPA3, or leave 6 GHz out.');
	if (type(spec.hidden) != 'bool' || type(spec.isolate) != 'bool') return fail('Hidden and isolate must be on or off.');
	e = checkOptions(spec.options);
	if (e) return fail(e);
	const net = networkOf(lanNetworks(c), spec.iface);
	if (!net) return fail('That network doesn’t exist on the router.');
	if (net.disabled) return fail(`The ${net.id} network is switched off. Turn it on first.`);
	const devs = radios(c);
	for (let b in spec.bands) {
		e = checkBand(c, devs, spec, own, b);
		if (e) return fail(e);
	}
	return null;
}

// ---- writing -------------------------------------------------------------------------

/** What this driver wants for each security choice: the form GL stores, which `wifi` expands the short names to anyway. */
function securityOptions(sec, band) {
	if (sec == 'sae') return { encryption: 'ccmp', sae: '1', no_beacon_rsnxe: '0', ...(band == '6g' ? { sae_pwe: '1' } : {}) };
	if (sec == 'sae-mixed') return { encryption: 'psk2+ccmp', sae: '1', no_beacon_rsnxe: '0' };
	return { encryption: 'psk2+ccmp', sae: '0', no_beacon_rsnxe: '1' };
}

function ifnameFor(c, dev) {
	const taken = {};
	for (let s in sections(c, 'wireless', 'wifi-iface')) if (s.ifname) taken[s.ifname] = true;
	// the firmware numbers its own slots wlan<radio><n>, n up to about 6; ours start well after
	for (let n = 30; n < 99; n++) {
		const name = `wlan${dev.index}${n}`;
		if (!taken[name] && stat(`/sys/class/net/${name}`) == null) return name;
	}
	return null;
}

/** 6 GHz BSSIDs are a multiple-BSSID set: GL gives every 6 GHz AP the same first five bytes and counts up the last. */
function macFor(c, dev) {
	const macs = {};
	let base = null, top = -1;
	for (let s in sections(c, 'wireless', 'wifi-iface')) {
		if (!s.macaddr) continue;
		macs[lc(s.macaddr)] = true;
		if (s.device != dev.device || dev.band != '6g') continue;
		const m = match(s.macaddr, /^(([0-9A-Fa-f]{2}:){5})([0-9A-Fa-f]{2})$/);
		if (!m || (base != null && lc(m[1]) != lc(base))) continue;
		base = m[1];
		if (hex(m[3]) > top) top = hex(m[3]);
	}
	if (base != null) return top < 0xfe ? uc(`${base}${hex2(top + 1)}`) : null;
	for (let i = 0; i < 5; i++) {
		const mac = randomMac();
		if (!macs[lc(mac)]) return mac;
	}
	return null;
}

/** A 16-bit mobility domain from the network id, the same on every radio so a device can roam between them. */
function mobilityDomain(id) {
	let h = 0;
	for (let i = 0; i < length(id); i++) h = (h * 31 + ord(id, i)) & 0xffff;
	return sprintf('%04x', h);
}

function writeOptions(c, name, o, id, mac) {
	const set = (k, v) => c.set('wireless', name, k, `${v}`);
	if (o.rrm) set('ieee80211k', '1');
	if (o.bssTransition) set('bss_transition', '1');
	if (o.maxClients) set('maxsta', o.maxClients);
	if (o.dtim) set('dtim_period', o.dtim);
	if (o.multicastToUnicast) { set('mcastenhance', '2'); set('multicast_to_unicast', '1'); }
	if (!o.fastRoaming) return;
	// fast transition over the air; the PSK is derived on the AP, so one router needs no R0KH/R1KH key list
	const holder = lc(replace(mac, ':', ''));
	set('ieee80211r', '1');
	set('mobility_domain', mobilityDomain(id));
	set('nasid', holder);
	set('r1_key_holder', holder);
	set('ft_psk_generate_local', '1');
	set('ft_over_ds', '0');
}

/**
 * The option set of one AP, copied from the firmware's own enabled main APs (`wifi5g` on the
 * BE9300) minus what is mesh- or GL-panel-only. What each one is for:
 *   device, network, mode, ssid, key, encryption, sae, sae_pwe, no_beacon_rsnxe: the AP and its
 *     security, in the form GL stores them
 *   hidden, isolate: read by hostapd (`ignore_broadcast_ssid`, `ap_isolate`)
 *   ifname: required by the driver scripts, which look a vap up by it
 *   macaddr: GL gives each AP its own random BSSID (6 GHz: a multiple-BSSID set, see macFor)
 *   wds '1': GL sets it on every AP, guest ones included; its repeaters and mesh nodes need it
 *   notify_mgmt_frames '1': GL's clients daemon learns about joins and leaves from it
 *   guest 'zeeli': see the README. GL's own WiFi timer switches the last AP of a band that has
 *     guest 0 or none, so without another value it would switch our network, not the main one
 *   zeeli '1': ours
 *   mld: a multi-link network's MLD (`zeeli_mld<n>`); GL's MLO links carry the same option
 * Left out on purpose: multi_ap, wps_*, init, factory_macaddr, random_bssid, disablecoext
 * (mesh, WPS, MLO and GL first-run state; disablecoext is radio-wide and set by the main AP).
 * `keep` carries what an existing section already has: its ifname, address and on/off state.
 */
function writeSection(c, name, spec, dev, keep) {
	c.set('wireless', name, 'wifi-iface');
	const set = (k, v) => c.set('wireless', name, k, `${v}`);
	for (let k in OPTION_KEYS) if (c.get('wireless', name, k) != null) c.delete('wireless', name, k);
	// every link of an MLD must carry the same security, so a multi-link network never gets sae_pwe
	const sec = securityOptions(spec.security, spec.mld ? '' : dev.band);
	set('device', dev.device);
	set('network', spec.iface);
	set('mode', 'ap');
	set('ssid', spec.ssid);
	set('key', spec.password);
	for (let k in sec) set(k, sec[k]);
	set('hidden', spec.hidden ? '1' : '0');
	set('isolate', spec.isolate ? '1' : '0');
	set('ifname', keep.ifname);
	set('macaddr', keep.macaddr);
	set('wds', '1');
	set('notify_mgmt_frames', '1');
	set('guest', 'zeeli');
	set('zeeli', '1');
	if (spec.mld) set('mld', spec.mld);
	set('disabled', keep.disabled ?? '0');
	writeOptions(c, name, spec.options, spec.id, keep.macaddr);
}

/** An MLD address nothing else on the router uses. */
function mldMacFor(c) {
	const macs = {};
	for (let cfg in ['wireless', 'mlo'])
		for (let kind in ['wifi-iface', 'wifi-mld'])
			for (let s in sections(c, cfg, kind)) for (let k in ['macaddr', 'mld_macaddr']) if (s[k]) macs[lc(s[k])] = true;
	for (let i = 0; i < 5; i++) {
		const mac = randomMac();
		if (!macs[lc(mac)]) return mac;
	}
	return null;
}

/** The MLD behind a multi-link network: what the driver scripts bring up before its links. */
function writeMld(c, spec, mac) {
	c.set('wireless', spec.mld, 'wifi-mld');
	c.set('wireless', spec.mld, 'mld_ssid', spec.ssid);
	c.set('wireless', spec.mld, 'mld_macaddr', mac);
	c.set('wireless', spec.mld, 'zeeli', '1');
}

function writeSchedule(c, id, s) {
	const name = `wifi_${id}`;
	c.set('zeeli', name, 'wifi_schedule');
	c.set('zeeli', name, 'enabled', s.enabled == false ? '0' : '1');
	c.set('zeeli', name, 'days', s.days);
	c.set('zeeli', name, 'off', s.off);
	c.set('zeeli', name, 'on', s.on);
}

function finish(c, extra) {
	c.commit('wireless');
	c.commit('zeeli');
	markPending(true);
	return { pending: true, ...extra };
}

function withDefaults(o) {
	return { ...OPTION_DEFAULTS, ...(o ?? {}) };
}

/** Add one interface of a network to a radio, with its own name and address. */
function addBand(c, devs, spec, b, disabled) {
	const dev = findDevice(devs, b);
	const ifname = ifnameFor(c, dev);
	const macaddr = macFor(c, dev);
	if (!ifname || !macaddr) return fail(`There’s no free interface name or address left on the ${BAND_NAME[b]} radio.`);
	const name = `zeeli_${spec.id}_${b}`;
	writeSection(c, name, spec, dev, { ifname, macaddr, disabled });
	return name;
}

/** Make a network: one AP per band, all with the same name, key and settings. */
function create(args) {
	const c = cursor();
	ensureConfig();
	const net = resolveNetwork(c, args.network);
	if (net == null) return fail('That network doesn’t exist on the router.');
	const sched = type(args.schedule) == 'object' && length(keys(args.schedule)) ? args.schedule : null;
	const e = sched ? checkSchedule(sched) : null;
	if (e) return fail(e);
	if (args.mlo != null && type(args.mlo) != 'bool') return fail('Multi-link must be on or off.');
	const mlo = args.mlo == true;
	if (mlo && sched) return fail(MLO_LOCKED);
	// the scripts treat any name with "mld" in it as an MLD, so an id never spells it
	let id = randomToken(6);
	while (index(id, 'mld') >= 0) id = randomToken(6);
	const spec = {
		id,
		mlo,
		ssid: args.ssid,
		password: args.password,
		bands: args.bands,
		iface: net.iface,
		security: args.security ?? (mlo ? 'sae' : 'sae-mixed'),
		hidden: args.hidden ?? false,
		isolate: args.isolate ?? false,
		options: withDefaults(args.options)
	};
	const bad = checkSpec(c, spec, []);
	if (bad) return bad;
	const devs = radios(c);
	const made = [];
	if (mlo) {
		const mac = mldMacFor(c);
		spec.mld = freeMld(c);
		if (!mac) return fail('There’s no free multi-link address left.');
		writeMld(c, spec, mac);
	}
	for (let b in spec.bands) {
		const name = addBand(c, devs, spec, b, '0');
		if (type(name) == 'object') return name;
		push(made, name);
	}
	if (sched) writeSchedule(c, spec.id, sched);
	return finish(c, { id: spec.id, sections: made });
}

/** Bring a network's interfaces in line with `spec`: drop bands it lost, add bands it gained, rewrite the rest. */
function rewrite(c, spec, own) {
	const devs = radios(c);
	const byBand = {};
	for (let s in own) byBand[bandOf(devs, s)] = s;
	for (let b in keys(byBand)) {
		if (b in spec.bands) continue;
		queueTeardown([byBand[b].ifname]);
		c.delete('wireless', byBand[b]['.name']);
	}
	for (let b in spec.bands) {
		const old = byBand[b];
		if (!old) {
			// a new band follows the others' on/off state
			const name = addBand(c, devs, spec, b, own[0].disabled);
			if (type(name) == 'object') return name;
			continue;
		}
		writeSection(c, old['.name'], spec, findDevice(devs, b), { ifname: old.ifname, macaddr: old.macaddr, disabled: old.disabled });
	}
	return finish(c, { id: spec.id });
}

/** The values a Zeeli network has now, read back from its first interface. */
function currentSpec(c, id, own) {
	const devs = radios(c);
	const first = own[0];
	return {
		id,
		ssid: first.ssid,
		password: first.key,
		bands: sort(map(own, (s) => bandOf(devs, s)), bandOrder),
		iface: first.network,
		security: security(first),
		hidden: first.hidden == '1',
		isolate: first.isolate == '1',
		options: optionsOf(first)
	};
}

/** Change a Zeeli network. Anything left out stays as it is; so does the password unless one is given. */
function update(args) {
	const c = cursor();
	const own = findGroup(c, args.id);
	if (type(own) == 'object') return own;
	if (own[0].mld != null) return fail(MLO_LOCKED);
	const spec = currentSpec(c, args.id, own);
	if (args.network != null) {
		const net = resolveNetwork(c, args.network);
		if (net == null) return fail('That network doesn’t exist on the router.');
		spec.iface = net.iface;
	}
	for (let k in ['ssid', 'password', 'bands', 'security', 'hidden', 'isolate']) if (args[k] != null) spec[k] = args[k];
	spec.options = { ...withDefaults(spec.options), ...(args.options ?? {}) };
	const bad = checkSpec(c, spec, own);
	if (bad) return bad;
	return rewrite(c, spec, own);
}

function remove(id) {
	const c = cursor();
	const own = findGroup(c, id);
	if (type(own) == 'object') return own;
	const mld = own[0].mld;
	// a multi-link network is never torn down while running: see restartFile
	if (mld == null) queueTeardown(map(own, (s) => s.ifname));
	for (let s in own) c.delete('wireless', s['.name']);
	if (mld && match(mld, MLD_NAME) && c.get('wireless', mld, 'zeeli') == '1') c.delete('wireless', mld);
	if (c.get('zeeli', `wifi_${id}`) != null) c.delete('zeeli', `wifi_${id}`);
	if (mld == null) return finish(c, {});
	c.commit('wireless');
	c.commit('zeeli');
	markRestart(own[0].ssid);
	return { restartNeeded: true };
}

/** The person's switch. It also clears a schedule's hold, so the switch stays where it was put. */
function setEnabled(id, enabled) {
	const c = cursor();
	const own = findGroup(c, id);
	if (type(own) == 'object') return own;
	if (type(enabled) != 'bool') return fail('Turn the network on or off.');
	if (own[0].mld != null && !enabled) return fail(MLO_LOCKED);
	for (let s in own) {
		c.set('wireless', s['.name'], 'disabled', enabled ? '0' : '1');
		if (s.sched_off != null) c.delete('wireless', s['.name'], 'sched_off');
	}
	return finish(c, {});
}

/**
 * How long a reload may hold rpcd. `wifi reload` is `ubus call network reload`: it sources the
 * driver scripts (0.24 s on the BE9300, measured with `wifi status`, which does the same) and asks
 * netifd, which brings the changed vaps up after the call has returned. So it returns in about a
 * second; this is a ceiling for a busy router, not an expectation. Past it the call is killed, the
 * changes stay saved and `pending` stays true.
 */
const RELOAD_SECONDS = 25;

/** Reload WiFi so committed changes reach the radios. */
function apply() {
	if (restartFor() != null) return fail('A multi-link network was deleted, and the router has to restart to finish removing it. Reloading WiFi before then could crash it. Restart the router first.');
	const r = runOrLog(['timeout', `${RELOAD_SECONDS}`, '/sbin/wifi', 'reload']);
	if (r.code == 124) return fail('WiFi is still reloading. Your changes are saved; apply again in a minute if devices haven’t reconnected.');
	if (r.code != 0) return fail(trim(r.stdout) || 'The router couldn’t reload WiFi.');
	teardown(cursor());
	markPending(false);
	return { applied: true };
}

// ---- schedules -----------------------------------------------------------------------

/** Is `ts` inside the off window? Windows start on the listed days and may run past midnight. */
function offAt(s, ts) {
	const minutes = (t) => int(substr(t, 0, 2)) * 60 + int(substr(t, 3, 2));
	const off = minutes(s.off), on = minutes(s.on);
	for (let back = 0; back <= 1; back++) {
		const t = localtime(ts - back * 86400);
		if (!(DAYS[t.wday] in s.days)) continue;
		const now = t.hour * 60 + t.min;
		if (off < on && back == 0 && now >= off && now < on) return true;
		if (off > on && ((back == 0 && now >= off) || (back == 1 && now < on))) return true;
	}
	return false;
}

function holding(c, id) {
	for (let s in sections(c, 'wireless', 'wifi-iface'))
		if (owned(s) && groupOf(s) == id && s.sched_off == '1') return true;
	return false;
}

/** Switch a network's interfaces off for its schedule (marking them), or let go of the ones it marked. */
function setHold(c, id, off) {
	let changed = false;
	for (let s in sections(c, 'wireless', 'wifi-iface')) {
		if (!owned(s) || groupOf(s) != id) continue;
		if (off && s.disabled != '1') {
			c.set('wireless', s['.name'], 'disabled', '1');
			c.set('wireless', s['.name'], 'sched_off', '1');
			changed = true;
		} else if (!off && s.sched_off == '1') {
			c.set('wireless', s['.name'], 'disabled', '0');
			c.delete('wireless', s['.name'], 'sched_off');
			changed = true;
		}
	}
	return changed;
}

/**
 * Enforce schedules. It acts on edges only: when a network's wanted state changes it switches the
 * interfaces, marking each one it turned off (`sched_off`) so it never turns on what a person
 * switched off. In between, a person can still flip the switch. After a reboot the first call
 * enforces "off" again. Returns whether anything changed; the caller applies it.
 */
function tick(args) {
	const c = cursor();
	const ts = args?.time ?? time();
	const file = `${paths.state}/wifi-schedule.json`;
	let last = {};
	try { last = json(readfile(file) ?? '{}') ?? {}; } catch (e) { last = {}; }
	const next = {};
	const ids = {};
	// a multi-link network is never switched by a schedule: switching its links off would destroy the MLD
	for (let s in sections(c, 'wireless', 'wifi-iface')) if (owned(s) && s.mld == null) ids[groupOf(s)] = true;
	let changed = false;
	for (let id in keys(ids)) {
		const sched = scheduleOf(c, id);
		const want = sched && sched.enabled && offAt(sched, ts) ? 'off' : 'on';
		next[id] = want;
		if (want == last[id] || (want == 'on' && last[id] == null && !holding(c, id))) continue;
		if (setHold(c, id, want == 'off')) changed = true;
	}
	if (changed) {
		c.commit('wireless');
		markPending(true);
	}
	mkdir(paths.state);
	writefile(file, `${sprintf('%J', next)}\n`);
	return { changed };
}

function setSchedule(id, s) {
	const c = cursor();
	const own = findGroup(c, id);
	if (type(own) == 'object') return own;
	if (own[0].mld != null) return fail(MLO_LOCKED);
	const e = checkSchedule(s);
	if (e) return fail(e);
	ensureConfig();
	writeSchedule(c, id, s);
	c.commit('zeeli');
	return { schedule: scheduleOf(c, id) };
}

/** Remove a schedule, and let go of a network it was holding off. */
function clearSchedule(id) {
	const c = cursor();
	const own = findGroup(c, id);
	if (type(own) == 'object') return own;
	if (own[0].mld != null) return fail(MLO_LOCKED);
	if (c.get('zeeli', `wifi_${id}`) != null) {
		c.delete('zeeli', `wifi_${id}`);
		c.commit('zeeli');
	}
	return { pending: tick().changed };
}

// this ucode needs exports listed rather than marked inline
export { list, reveal, create, update, remove, setEnabled, apply, setSchedule, clearSchedule, tick, offAt, LIMIT };
