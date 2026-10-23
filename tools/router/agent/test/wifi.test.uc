// zeeli.wifi against the BE9300 fixture: what lands in /etc/config/wireless, what is refused,
// and that the firmware's own sections are never touched.
'use strict';

import { eq, ok, test, plugin, done } from 'assert';
import { cursor, paths } from 'zeeli.common';
import { tick, offAt } from 'zeeli.wifi';
import { readfile, unlink } from 'fs';

const wifi = plugin('wifi')['zeeli.wifi'];
const call = (method, args) => wifi[method].call({ args: args ?? {} });
const valid = { ssid: 'Kids', password: 'correct horse', bands: ['5g'], network: 'guest', security: 'sae-mixed' };

function sections() {
	const out = {};
	cursor().foreach('wireless', 'wifi-iface', (s) => { out[s['.name']] = s; });
	return out;
}

function firmware() {
	const all = sections();
	const out = {};
	for (let k in all) if (!match(k, /^zeeli_/)) out[k] = all[k];
	return sprintf('%J', out);
}

/** Every test starts from the fixture: no networks of ours, no schedules, nothing pending. */
function fresh() {
	const c = cursor();
	for (let k in sections()) if (match(k, /^zeeli_/)) c.delete('wireless', k);
	c.foreach('wireless', 'wifi-mld', (s) => { if (match(s['.name'], /^zeeli_/)) c.delete('wireless', s['.name']); });
	c.commit('wireless');
	c.foreach('zeeli', 'wifi_schedule', (s) => { c.delete('zeeli', s['.name']); });
	c.commit('zeeli');
	for (let f in ['wifi-pending', 'wifi-schedule.json', 'wifi-apply.log', 'wifi-teardown']) unlink(`${paths.state}/${f}`);
}

const t = (name, fn) => test(name, () => { fresh(); fn(); });

function entry(id) {
	return filter(call('list').networks, (n) => n.id == id)[0];
}

function made(args) {
	const r = call('create', { ...valid, ...(args ?? {}) });
	ok(!r.error, `create failed: ${r.error}`);
	return r;
}

function repeat(text, n) {
	let out = '';
	for (let i = 0; i < n; i++) out += text;
	return out;
}

function mondayAt(hour, min) {
	return timelocal({ year: 2026, mon: 10, mday: 19, hour, min, sec: 0, isdst: -1 });
}

t('list shows the router’s own networks with roles, and never a key', () => {
	const r = call('list');
	const roles = {};
	for (let n in r.networks) roles[n.id] = n.role;
	eq(roles.wifi5g, 'main');
	eq(roles.guest2g, 'guest');
	eq(roles.iot5g, 'iot');
	eq(roles.wlanmld2g, 'mlo');
	eq(roles.wlanmldguest6g, 'mlo-guest');
	eq(roles.bbss5g, null, 'mesh backhaul is not a network');
	eq(sort(map(r.internal, (i) => `${i.id}:${i.role}`)), ['bbss5g:mesh-backhaul', 'bsta5g:mesh-backhaul', 'sta:station']);
	ok(index(sprintf('%J', r), 'fixture-password') < 0, 'a key leaked into list');
	const w = entry('wifi5g');
	eq([w.owner, w.hasKey, w.security, w.network, w.bands], ['firmware', true, 'sae-mixed', 'main', ['5g']]);
	eq(entry('wifi2g').security, 'psk2');
	eq(entry('wifi6g').security, 'sae');
});

t('list counts each radio’s slots against 17 and lists the networks one can join', () => {
	const r = call('list');
	eq(map(r.radios, (d) => [d.device, d.band, d.used, d.limit]), [['wifi0', '2g', 5, 17], ['wifi1', '5g', 7, 17], ['wifi2', '6g', 4, 17]]);
	eq(map(r.lanNetworks, (n) => `${n.id}:${n.iface}:${n.device}:${n.disabled}`), ['main:lan:br-lan:false', 'guest:guest:br-guest:false', 'iot:iot:br-iot:true']);
	eq(r.pending, false);
});

t('create writes one AP in the firmware’s own shape and leaves its sections alone', () => {
	const before = firmware();
	const r = made({ ssid: 'Kids' });
	eq(length(r.sections), 1);
	const s = sections()[`zeeli_${r.id}_5g`];
	eq([s.device, s.network, s.mode, s.ssid, s.key, s.encryption, s.sae, s.no_beacon_rsnxe], ['wifi1', 'guest', 'ap', 'Kids', 'correct horse', 'psk2+ccmp', '1', '0']);
	eq([s.hidden, s.isolate, s.disabled, s.zeeli, s.wds, s.notify_mgmt_frames, s.guest], ['0', '0', '0', '1', '1', '1', 'zeeli']);
	ok(match(s.ifname, /^wlan130$/), `ifname ${s.ifname}`);
	ok(match(s.macaddr, /^[0-9A-F][26AE](:[0-9A-F]{2}){5}$/), `macaddr ${s.macaddr}`);
	eq([s.ieee80211k, s.bss_transition, s.ieee80211r, s.maxsta], ['1', '1', null, null]);
	eq(firmware(), before);
	eq(call('list').pending, true);
});

t('the same name on several bands makes one AP per radio with its own address and interface', () => {
	const r = made({ ssid: 'Everything', bands: ['2g', '5g'], security: 'psk2' });
	eq(sort(r.sections), [`zeeli_${r.id}_2g`, `zeeli_${r.id}_5g`]);
	const all = sections();
	const a = all[`zeeli_${r.id}_2g`], b = all[`zeeli_${r.id}_5g`];
	eq([a.device, b.device, a.ssid, b.ssid, a.key, b.key], ['wifi0', 'wifi1', 'Everything', 'Everything', 'correct horse', 'correct horse']);
	ok(a.macaddr != b.macaddr && a.ifname != b.ifname);
	eq([a.encryption, a.sae, a.no_beacon_rsnxe], ['psk2+ccmp', '0', '1']);
	const e = entry(r.id);
	eq([e.owner, e.bands, e.security, e.network, e.role, e.hasKey], ['zeeli', ['2g', '5g'], 'psk2', 'guest', null, true]);
});

t('6 GHz takes WPA3 only and joins the radio’s multiple-BSSID set', () => {
	const e = call('create', { ...valid, bands: ['5g', '6g'] });
	eq(e.error, '6 GHz needs WPA3. Choose WPA3, or leave 6 GHz out.');
	const r = made({ ssid: 'Fast', bands: ['6g'], security: 'sae' });
	const s = sections()[`zeeli_${r.id}_6g`];
	eq([s.encryption, s.sae, s.sae_pwe, s.no_beacon_rsnxe], ['ccmp', '1', '1', '0']);
	eq(s.macaddr, '02:00:00:58:A2:2E', 'next address in the set');
	const again = made({ ssid: 'Fast2', bands: ['6g'], security: 'sae' });
	eq(sections()[`zeeli_${again.id}_6g`].macaddr, '02:00:00:58:A2:2F');
});

t('refused: bad names, passwords, bands, security, networks', () => {
	const refuse = (patch, message) => eq(call('create', { ...valid, ...patch }).error, message);
	refuse({ ssid: '' }, 'The network name must be 1 to 32 bytes.');
	refuse({ ssid: 'é' + repeat('ab', 16) + 'é' }, 'The network name must be 1 to 32 bytes.');
	refuse({ ssid: 'bad\nname' }, 'The network name can’t contain control characters.');
	refuse({ password: 'short' }, 'The password must be 8 to 63 characters.');
	refuse({ password: repeat('a', 64) }, 'The password must be 8 to 63 characters.');
	refuse({ password: 'café au lait' }, 'The password can only use plain letters, numbers, spaces and punctuation.');
	refuse({ bands: [] }, 'Pick at least one band.');
	refuse({ bands: ['7g'] }, 'Not a band: 7g');
	refuse({ bands: ['5g', '5g'] }, 'Each band can only be listed once.');
	refuse({ security: 'none' }, 'Security must be WPA3, WPA2/WPA3 or WPA2.');
	refuse({ network: 'nowhere' }, 'That network doesn’t exist on the router.');
	refuse({ network: 'wan' }, 'That network doesn’t exist on the router.');
	refuse({ network: 'iot' }, 'The iot network is switched off. Turn it on first.');
	refuse({ options: { turbo: true } }, 'Unknown option: turbo');
	refuse({ options: { maxClients: 500 } }, 'Max clients must be 1 to 128.');
	refuse({ options: { dtim: 11 } }, 'The DTIM period must be 1 to 10.');
	refuse({ options: { rrm: 'yes' } }, 'rrm must be on or off.');
});

t('any printable character is a valid password and is stored and read back as typed', () => {
	// libuci quotes it, `append` and the heredoc that write hostapd.conf never evaluate it
	const hostile = '$(id)`id`\\n&|/"\';#%1 ';
	const r = made({ password: hostile });
	eq(sections()[`zeeli_${r.id}_5g`].key, hostile);
	eq(call('reveal', { id: r.id }).password, hostile);
	ok(match(readfile(`${paths.confdir}/wireless`), /option key '\$\(id\)`id`\\n&\|\/"'\\'';#%1 '/), 'quoted for uci');
});

t('refused: a name another network on that radio already has', () => {
	eq(call('create', { ...valid, ssid: 'Zeeli-5G' }).error, 'Another network on 5 GHz is already called “Zeeli-5G”.');
	made({ ssid: 'Twice', bands: ['2g'] });
	eq(call('create', { ...valid, ssid: 'Twice', bands: ['2g'] }).error, 'Another network on 2.4 GHz is already called “Twice”.');
	made({ ssid: 'Twice', bands: ['5g'] });
});

t('refused: a radio with no free slot, and no change made', () => {
	const c = cursor();
	const free = () => 17 - filter(call('list').radios, (d) => d.device == 'wifi2')[0].used;
	const fillers = [];
	while (free() > 0) {
		const name = `filler${length(fillers)}`;
		c.set('wireless', name, 'wifi-iface');
		c.set('wireless', name, 'device', 'wifi2');
		c.set('wireless', name, 'mode', 'ap');
		c.commit('wireless');
		push(fillers, name);
	}
	const before = firmware();
	eq(call('create', { ...valid, ssid: 'No room', bands: ['6g'], security: 'sae' }).error, 'The 6 GHz radio is full: it holds 17 networks.');
	eq(firmware(), before);
	for (let name in fillers) c.delete('wireless', name);
	c.commit('wireless');
	ok(!call('create', { ...valid, ssid: 'Room again', bands: ['6g'], security: 'sae' }).error);
});

t('update changes a network in place and keeps its address, interface and password', () => {
	const r = made({ ssid: 'Before' });
	const was = sections()[`zeeli_${r.id}_5g`];
	const u = call('update', { id: r.id, ssid: 'After', hidden: true, isolate: true, network: 'main' });
	ok(!u.error, u.error);
	const s = sections()[`zeeli_${r.id}_5g`];
	eq([s.ssid, s.key, s.hidden, s.isolate, s.network, s.ifname, s.macaddr], ['After', 'correct horse', '1', '1', 'lan', was.ifname, was.macaddr]);
	eq(call('update', { id: r.id, password: 'a new password' }).pending, true);
	eq(sections()[`zeeli_${r.id}_5g`].key, 'a new password');
});

t('update adds and drops bands, and security changes rewrite the encryption', () => {
	const r = made({ ssid: 'Grow' });
	ok(!call('update', { id: r.id, bands: ['2g', '5g'] }).error);
	eq(sort(entry(r.id).sections), [`zeeli_${r.id}_2g`, `zeeli_${r.id}_5g`]);
	ok(!call('update', { id: r.id, bands: ['2g'], security: 'psk2' }).error);
	eq(entry(r.id).sections, [`zeeli_${r.id}_2g`]);
	eq([entry(r.id).security, sections()[`zeeli_${r.id}_2g`].sae], ['psk2', '0']);
	eq(call('update', { id: r.id, bands: ['6g'] }).error, '6 GHz needs WPA3. Choose WPA3, or leave 6 GHz out.');
	eq(entry(r.id).bands, ['2g']);
});

t('update, delete, set_enabled and reveal refuse the router’s own networks', () => {
	const before = firmware();
	const no = 'That network doesn’t exist, or it belongs to the router’s own settings.';
	for (let id in ['wifi5g', 'guest2g', 'abcdef']) {
		eq(call('update', { id, ssid: 'Hijack' }).error, no);
		eq(call('delete', { id }).error, no);
		eq(call('set_enabled', { id, enabled: false }).error, no);
		eq(call('reveal', { id }).error, no);
	}
	for (let id in ['zeeli_wifi5g', 'x', '../wifi5g']) eq(call('delete', { id }).error, 'That isn’t a network the agent made.');
	eq(firmware(), before);
});

t('reveal returns one network’s password and list never does', () => {
	const r = made({ password: 'only for reveal' });
	eq(call('reveal', { id: r.id }), { password: 'only for reveal' });
	ok(index(sprintf('%J', call('list')), 'only for reveal') < 0);
});

t('set_enabled switches every interface of a network; delete removes them all', () => {
	const r = made({ bands: ['2g', '5g'], ssid: 'Switch' });
	call('set_enabled', { id: r.id, enabled: false });
	eq(entry(r.id).disabled, true);
	eq(map(r.sections, (n) => sections()[n].disabled), ['1', '1']);
	call('set_enabled', { id: r.id, enabled: true });
	eq(entry(r.id).disabled, false);
	eq(call('set_enabled', { id: r.id, enabled: 'off' }).error, 'Turn the network on or off.');
	const before = firmware();
	ok(!call('delete', { id: r.id }).error);
	eq(entry(r.id), null);
	eq(firmware(), before);
});

t('options become the UCI keys the driver scripts read', () => {
	const r = made({ ssid: 'Roam', options: { fastRoaming: true, maxClients: 20, multicastToUnicast: true, dtim: 3, rrm: false } });
	const s = sections()[`zeeli_${r.id}_5g`];
	eq([s.ieee80211r, s.ft_psk_generate_local, s.ft_over_ds, s.maxsta, s.mcastenhance, s.multicast_to_unicast, s.dtim_period, s.ieee80211k, s.bss_transition],
		['1', '1', '0', '20', '2', '1', '3', null, '1']);
	ok(match(s.mobility_domain, /^[0-9a-f]{4}$/));
	eq([s.nasid, s.r1_key_holder], [replace(lc(s.macaddr), ':', ''), replace(lc(s.macaddr), ':', '')]);
	eq(entry(r.id).options, { fastRoaming: true, rrm: false, bssTransition: true, maxClients: 20, multicastToUnicast: true, dtim: 3 });
	call('update', { id: r.id, options: { fastRoaming: false, maxClients: 0, multicastToUnicast: false, dtim: 0, rrm: true } });
	const t = sections()[`zeeli_${r.id}_5g`];
	eq([t.ieee80211r, t.mobility_domain, t.nasid, t.maxsta, t.mcastenhance, t.dtim_period, t.ieee80211k], [null, null, null, null, null, null, '1']);
});

t('fast roaming uses one mobility domain on every band of a network', () => {
	const r = made({ ssid: 'Roam2', bands: ['2g', '5g'], options: { fastRoaming: true } });
	const all = sections();
	eq(all[`zeeli_${r.id}_2g`].mobility_domain, all[`zeeli_${r.id}_5g`].mobility_domain);
	ok(all[`zeeli_${r.id}_2g`].nasid != all[`zeeli_${r.id}_5g`].nasid);
});

t('apply reloads WiFi once and clears the pending flag', () => {
	made({ ssid: 'Pending' });
	eq(call('list').pending, true);
	eq(call('apply'), { applied: true });
	eq(readfile(`${paths.state}/wifi-apply.log`), 'timeout 25 /sbin/wifi reload\n');
	eq(call('list').pending, false);
});

t('deleting a network or dropping a band takes its interfaces off the air on apply', () => {
	const r = made({ ssid: 'Gone', bands: ['2g', '5g'] });
	call('apply');
	unlink(`${paths.state}/wifi-apply.log`);
	const all = sections();
	const if2 = all[`zeeli_${r.id}_2g`].ifname, if5 = all[`zeeli_${r.id}_5g`].ifname;
	ok(!call('update', { id: r.id, bands: ['5g'] }).error, 'dropping 2.4 GHz');
	call('apply');
	eq(readfile(`${paths.state}/wifi-apply.log`), `timeout 25 /sbin/wifi reload\nhostapd_cli -p /var/run/hostapd -i global raw REMOVE ${if2}\nifconfig ${if2} down\nwlanconfig ${if2} destroy\n`);
	unlink(`${paths.state}/wifi-apply.log`);
	call('delete', { id: r.id });
	call('apply');
	ok(match(readfile(`${paths.state}/wifi-apply.log`), regexp(`wlanconfig ${if5} destroy`)), 'the 5 GHz interface goes on delete');
	unlink(`${paths.state}/wifi-apply.log`);
	call('apply');
	eq(readfile(`${paths.state}/wifi-apply.log`), 'timeout 25 /sbin/wifi reload\n', 'nothing is torn down twice');
});

t('GL’s WiFi timer still picks the firmware’s main AP on each band', () => {
	made({ ssid: 'Timer2g', bands: ['2g'] });
	made({ ssid: 'Timer5g', bands: ['5g'] });
	// the selection in /usr/bin/gl_timer_control_wifi: the last AP of the band that is not
	// iot2g/iot5g, not multi_ap 1, and has guest 0 (or none) and no mld
	const pick = (device) => {
		let found = null;
		cursor().foreach('wireless', 'wifi-iface', (s) => {
			if (s.mode != 'ap' || s['.name'] in ['iot2g', 'iot5g'] || s.multi_ap == '1') return;
			if (s.device == device && (s.guest ?? '0') == '0' && !s.mld) found = s['.name'];
		});
		return found;
	};
	eq([pick('wifi0'), pick('wifi1')], ['wifi2g', 'wifi5g']);
});

t('schedules are checked before they are stored', () => {
	const r = made({ ssid: 'Sched' });
	const bad = (patch, message) => eq(call('set_schedule', { id: r.id, enabled: true, days: ['mon'], off: '22:00', on: '07:00', ...patch }).error, message);
	bad({ days: [] }, 'Pick at least one day for the schedule.');
	bad({ days: ['monday'] }, 'Not a day: monday');
	bad({ off: '24:00' }, 'Schedule times look like 22:00.');
	bad({ on: '7:00' }, 'Schedule times look like 22:00.');
	bad({ on: '22:00' }, 'The schedule turns the network off and on at the same time.');
	eq(call('set_schedule', { id: 'wifi5g', days: ['mon'], off: '22:00', on: '07:00' }).error, 'That network doesn’t exist, or it belongs to the router’s own settings.');
	const ok1 = call('set_schedule', { id: r.id, enabled: true, days: ['mon', 'tue'], off: '22:00', on: '07:00' });
	eq(ok1.schedule, { enabled: true, days: ['mon', 'tue'], off: '22:00', on: '07:00' });
	eq(entry(r.id).schedule.days, ['mon', 'tue']);
	ok(!call('clear_schedule', { id: r.id }).error);
	eq(entry(r.id).schedule, null);
});

t('a schedule window starts on the listed day and may run past midnight', () => {
	const night = { days: ['mon'], off: '22:00', on: '07:00' };
	eq([offAt(night, mondayAt(21, 59)), offAt(night, mondayAt(22, 0)), offAt(night, mondayAt(23, 59))], [false, true, true]);
	eq([offAt(night, mondayAt(23, 59) + 60), offAt(night, mondayAt(23, 59) + 7 * 3600 - 60), offAt(night, mondayAt(23, 59) + 7 * 3600 + 60)], [true, true, false]);
	eq(offAt(night, mondayAt(9, 0) + 86400), false, 'Tuesday daytime');
	eq(offAt(night, mondayAt(23, 0) + 7 * 86400 - 86400 * 1), false, 'Sunday night is not listed');
	const day = { days: ['mon'], off: '09:00', on: '17:00' };
	eq([offAt(day, mondayAt(8, 59)), offAt(day, mondayAt(9, 0)), offAt(day, mondayAt(16, 59)), offAt(day, mondayAt(17, 0))], [false, true, true, false]);
});

t('the scheduler switches a network off and on at the window’s edges and nothing else', () => {
	const r = made({ ssid: 'Night', bands: ['2g', '5g'] });
	call('set_schedule', { id: r.id, enabled: true, days: ['mon'], off: '22:00', on: '07:00' });
	const state = (n) => map(r.sections, (s) => [sections()[s].disabled, sections()[s].sched_off]);
	const before = firmware();
	eq(tick({ time: mondayAt(12, 0) }).changed, false);
	eq(state(), [['0', null], ['0', null]]);
	eq(tick({ time: mondayAt(22, 0) }).changed, true);
	eq(state(), [['1', '1'], ['1', '1']]);
	eq(entry(r.id).scheduledOff, true);
	eq(tick({ time: mondayAt(22, 1) }).changed, false, 'nothing to do in between');
	eq(tick({ time: mondayAt(23, 0) + 8 * 3600 + 60 }).changed, true);
	eq(state(), [['0', null], ['0', null]]);
	eq(firmware(), before);
});

t('the scheduler never turns on what a person turned off, and a person can override a window', () => {
	const r = made({ ssid: 'Mine', bands: ['5g'] });
	call('set_schedule', { id: r.id, enabled: true, days: ['mon'], off: '22:00', on: '07:00' });
	call('set_enabled', { id: r.id, enabled: false });
	tick({ time: mondayAt(12, 0) });
	tick({ time: mondayAt(22, 0) });
	eq(sections()[r.sections[0]].sched_off, null, 'already off: not ours to release');
	tick({ time: mondayAt(23, 0) + 8 * 3600 + 60 });
	eq(sections()[r.sections[0]].disabled, '1', 'still off');
	call('set_enabled', { id: r.id, enabled: true });
	const next = timelocal({ year: 2026, mon: 10, mday: 26, hour: 22, min: 0, sec: 0, isdst: -1 });
	tick({ time: next });
	eq(sections()[r.sections[0]].disabled, '1', 'next window starts');
	call('set_enabled', { id: r.id, enabled: true });
	eq(tick({ time: next + 60 }).changed, false, 'the override holds until the window ends');
	eq(sections()[r.sections[0]].disabled, '0');
});

t('after a reboot the scheduler enforces the window again, and a removed schedule lets go', () => {
	const r = made({ ssid: 'Reboot', bands: ['5g'] });
	call('set_schedule', { id: r.id, enabled: true, days: ['mon'], off: '22:00', on: '07:00' });
	tick({ time: mondayAt(12, 0) });
	unlink(`${paths.state}/wifi-schedule.json`);
	eq(tick({ time: mondayAt(23, 30) }).changed, true);
	eq(sections()[r.sections[0]].disabled, '1');
	unlink(`${paths.state}/wifi-schedule.json`);
	eq(tick({ time: mondayAt(23, 40) }).changed, false, 'already held');
	eq(call('clear_schedule', { id: r.id }).pending, true);
	eq([sections()[r.sections[0]].disabled, sections()[r.sections[0]].sched_off], ['0', null]);
});

t('a network made with a schedule stores it in /etc/config/zeeli', () => {
	const r = made({ ssid: 'WithSched', schedule: { days: ['sat', 'sun'], off: '23:30', on: '08:00' } });
	const c = cursor();
	eq(c.get('zeeli', `wifi_${r.id}`), 'wifi_schedule');
	eq([c.get('zeeli', `wifi_${r.id}`, 'off'), c.get('zeeli', `wifi_${r.id}`, 'on'), c.get('zeeli', `wifi_${r.id}`, 'days')], ['23:30', '08:00', ['sat', 'sun']]);
	eq(call('create', { ...valid, ssid: 'BadSched', schedule: { days: [], off: '23:30', on: '08:00' } }).error, 'Pick at least one day for the schedule.');
	call('delete', { id: r.id });
	eq(cursor().get('zeeli', `wifi_${r.id}`), null);
});

// ---- multi-link (MLO) networks ----------------------------------------------------------

const mlo = { ssid: 'Wi-Fi 7', password: 'correct horse', bands: ['5g', '6g'], network: 'guest', mlo: true };

/** Like `made`, but with no default security: a multi-link network starts at WPA3 on its own. */
function mk(args) {
	const r = call('create', { ...mlo, ...(args ?? {}) });
	ok(!r.error, `create failed: ${r.error}`);
	return r;
}

function mlds() {
	const out = {};
	cursor().foreach('wireless', 'wifi-mld', (s) => { out[s['.name']] = s; });
	return out;
}

function mloConfig() {
	return sprintf('%J', cursor().get_all('mlo', 'mld0')) + sprintf('%J', cursor().get_all('mlo', 'mld1')) + sprintf('%J', cursor().get_all('mlo', 'global'));
}

t('list says whether another multi-link network can be made, and which bands it may use', () => {
	eq(call('list').mlo, { supported: true, bands: ['2g', '5g', '6g'], reason: null });
	const c = cursor();
	c.set('mlo', 'global', 'support_bands', ['5g', '6g']);
	c.commit('mlo');
	eq(call('list').mlo.bands, ['5g', '6g']);
	c.delete('mlo', 'global');
	c.commit('mlo');
	eq(call('list').mlo, { supported: false, bands: [], reason: 'This router’s firmware has no multi-link (Wi-Fi 7 MLO) support.' });
	c.set('mlo', 'global', 'mlo');
	c.set('mlo', 'global', 'support_bands', ['5g']);
	c.commit('mlo');
	eq(call('list').mlo.reason, 'Multi-link needs a router with at least two bands that support it.');
	c.set('mlo', 'global', 'support_bands', ['2g', '5g', '6g']);
	c.commit('mlo');
});

t('a multi-link network is one MLD with a link on each band, in the shape GL’s own MLO uses', () => {
	const fw = firmware(), before = mloConfig(), gl = sprintf('%J', [mlds().mld0, mlds().mld1]);
	const r = mk(mlo);
	eq(sort(r.sections), [`zeeli_${r.id}_5g`, `zeeli_${r.id}_6g`]);
	const m = mlds().zeeli_mld2;
	eq([m['.type'], m.mld_ssid, m.zeeli], ['wifi-mld', 'Wi-Fi 7', '1']);
	ok(match(m.mld_macaddr, /^[0-9A-F][26AE](:[0-9A-F]{2}){5}$/), `mld_macaddr ${m.mld_macaddr}`);
	for (let b in ['5g', '6g']) {
		const s = sections()[`zeeli_${r.id}_${b}`];
		eq([s.mld, s.encryption, s.sae, s.no_beacon_rsnxe, s.sae_pwe, s.zeeli, s.network, s.disabled], ['zeeli_mld2', 'ccmp', '1', '0', null, '1', 'guest', '0'], b);
	}
	eq(map(['5g', '6g'], (b) => sections()[`zeeli_${r.id}_${b}`].ifname), ['wlan130', 'wlan230']);
	const e = entry(r.id);
	eq([e.mlo, e.bands, e.security, e.network], [true, ['5g', '6g'], 'sae', 'guest']);
	eq(entry(r.id).hasKey, true);
	ok(index(sprintf('%J', call('list')), 'correct horse') < 0, 'a key leaked into list');
	eq(firmware(), fw, 'the firmware’s wireless sections are untouched');
	eq(sprintf('%J', [mlds().mld0, mlds().mld1]), gl, 'GL’s own MLDs are untouched');
	eq(mloConfig(), before, '/etc/config/mlo belongs to GL’s two slots and is not written');
	eq(call('list').pending, true);
});

t('security defaults to WPA3, and each multi-link network takes the next free MLD', () => {
	const a = mk({ ...mlo, ssid: 'First', bands: ['2g', '5g', '6g'] });
	const b = mk({ ...mlo, ssid: 'Second', network: 'main' });
	eq(sort(keys(mlds())), ['mld0', 'mld1', 'zeeli_mld2', 'zeeli_mld3']);
	eq(sections()[`zeeli_${b.id}_5g`].mld, 'zeeli_mld3');
	ok(mlds().zeeli_mld2.mld_macaddr != mlds().zeeli_mld3.mld_macaddr, 'each MLD has its own address');
	eq(entry(a.id).bands, ['2g', '5g', '6g']);
	call('delete', { id: a.id });
	const c = mk({ ...mlo, ssid: 'Third', network: 'main' });
	eq(sections()[`zeeli_${c.id}_5g`].mld, 'zeeli_mld2', 'a freed MLD is reused');
});

t('refused: a multi-link network on one band, without WPA3, off the firmware’s bands, or with no MLD left', () => {
	const fw = firmware(), before = sprintf('%J', mlds());
	const no = (patch, message) => eq(call('create', { ...mlo, ...patch }).error, message);
	no({ bands: ['5g'] }, 'Multi-link needs at least two bands.');
	no({ security: 'sae-mixed' }, 'Multi-link networks need WPA3.');
	no({ security: 'psk2' }, 'Multi-link networks need WPA3.');
	no({ mlo: 'yes' }, 'Multi-link must be on or off.');
	const c = cursor();
	c.set('mlo', 'global', 'support_bands', ['5g', '6g']);
	c.commit('mlo');
	no({ bands: ['2g', '5g'] }, 'The router’s firmware doesn’t offer multi-link on 2.4 GHz.');
	c.set('mlo', 'global', 'support_bands', ['2g', '5g', '6g']);
	c.commit('mlo');
	for (let n = 2; n < 16; n++) c.set('wireless', `zeeli_mld${n}`, 'wifi-mld');
	c.commit('wireless');
	no({}, 'This router holds 16 multi-link networks, and they’re all in use.');
	for (let n = 2; n < 16; n++) c.delete('wireless', `zeeli_mld${n}`);
	c.commit('wireless');
	eq(firmware(), fw);
	eq(sprintf('%J', mlds()), before);
	eq(call('list').pending, false, 'nothing was written');
});

t('a multi-link network still follows the per-band rules for names and slots', () => {
	eq(call('create', { ...mlo, ssid: 'Zeeli-5G' }).error, 'Another network on 5 GHz is already called “Zeeli-5G”.');
	eq(call('create', { ...mlo, network: 'iot' }).error, 'The iot network is switched off. Turn it on first.');
	eq(call('create', { ...mlo, password: 'short' }).error, 'The password must be 8 to 63 characters.');
	eq(length(mlds()), 2, 'a refused network leaves no MLD behind');
});

t('update renames, rekeys and hides a multi-link network in place, but never moves or reshapes it', () => {
	const r = mk(mlo);
	const mac = mlds().zeeli_mld2.mld_macaddr;
	ok(!call('update', { id: r.id, ssid: 'Wi-Fi 7 Home', password: 'another one', hidden: true, options: { maxClients: 20 } }).error, 'update');
	const m = mlds().zeeli_mld2;
	eq([m.mld_ssid, m.mld_macaddr], ['Wi-Fi 7 Home', mac]);
	for (let b in ['5g', '6g']) {
		const s = sections()[`zeeli_${r.id}_${b}`];
		eq([s.ssid, s.key, s.hidden, s.maxsta, s.mld, s.sae_pwe], ['Wi-Fi 7 Home', 'another one', '1', '20', 'zeeli_mld2', null], b);
	}
	eq(call('update', { id: r.id, bands: ['5g'] }).error, 'A multi-link network can’t change its bands. Delete it and make it again with the bands you want.');
	eq(call('update', { id: r.id, bands: ['2g', '5g', '6g'] }).error, 'A multi-link network can’t change its bands. Delete it and make it again with the bands you want.');
	eq(call('update', { id: r.id, bands: ['6g', '5g'] }).error, null, 'the same bands in another order are no change');
	eq(call('update', { id: r.id, network: 'main' }).error, 'A multi-link network can’t move to another network. Delete it and make it again there.');
	eq(call('update', { id: r.id, network: 'guest' }).error, null);
	eq(call('update', { id: r.id, security: 'sae-mixed' }).error, 'Multi-link networks need WPA3.');
	eq(entry(r.id).network, 'guest');
});

t('set_enabled switches every link of a multi-link network and leaves the MLD', () => {
	const r = mk(mlo);
	call('set_enabled', { id: r.id, enabled: false });
	eq(map(['5g', '6g'], (b) => sections()[`zeeli_${r.id}_${b}`].disabled), ['1', '1']);
	eq(entry(r.id).disabled, true);
	eq(sort(keys(mlds())), ['mld0', 'mld1', 'zeeli_mld2']);
});

t('deleting a multi-link network removes its MLD and links, and apply takes them off the air the way GL does', () => {
	const fw = firmware(), before = mloConfig(), gl = sprintf('%J', [mlds().mld0, mlds().mld1]);
	const r = mk(mlo);
	call('apply');
	unlink(`${paths.state}/wifi-apply.log`);
	ok(!call('delete', { id: r.id }).error, 'delete');
	eq(sort(keys(mlds())), ['mld0', 'mld1']);
	eq(length(filter(keys(sections()), (k) => match(k, /^zeeli_/))), 0);
	eq(firmware(), fw);
	eq(sprintf('%J', [mlds().mld0, mlds().mld1]), gl);
	eq(mloConfig(), before);
	call('apply');
	eq(readfile(`${paths.state}/wifi-apply.log`), join('\n', [
		'timeout 25 /sbin/wifi reload',
		'iw wlan130 del',
		'iw wlan230 del',
		'hostapd_cli -p /var/run/hostapd -i global raw REMOVE wlan130',
		'hostapd_cli -p /var/run/hostapd -i global raw REMOVE wlan230',
		'ip link set dev zeeli_mld2 nomaster',
		'iw zeeli_mld2 del',
		''
	]));
	unlink(`${paths.state}/wifi-apply.log`);
	call('apply');
	eq(readfile(`${paths.state}/wifi-apply.log`), 'timeout 25 /sbin/wifi reload\n', 'nothing is torn down twice');
});

t('a deleted multi-link network is not torn down while a new one has taken its interface names', () => {
	const r = mk(mlo);
	call('delete', { id: r.id });
	mk({ ...mlo, ssid: 'Again' });
	unlink(`${paths.state}/wifi-apply.log`);
	call('apply');
	eq(readfile(`${paths.state}/wifi-apply.log`), 'timeout 25 /sbin/wifi reload\n');
});

t('the rpc object declares every argument it reads', () => {
	eq(sort(keys(wifi)), ['apply', 'clear_schedule', 'create', 'delete', 'list', 'reveal', 'set_enabled', 'set_schedule', 'tick', 'update']);
	eq(sort(keys(wifi.create.args)), ['bands', 'hidden', 'isolate', 'mlo', 'network', 'options', 'password', 'schedule', 'security', 'ssid']);
});

done();
