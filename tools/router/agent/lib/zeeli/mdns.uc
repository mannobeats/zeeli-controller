// zeeli.mdns: the avahi reflector that lets AirPlay, Chromecast and printers be found across networks.
//
// avahi-daemon is already on the router (GL uses it to publish the router's name), with the
// reflector off. Turning this on edits two things in /etc/avahi/avahi-daemon.conf and restarts it:
//   [server]    allow-interfaces=<bridges>   (marked with `# zeeli`, so it can be taken out again)
//   [reflector] enable-reflector=yes|no
// The firewall allowance for UDP 5353 is written by zeeli.firewall; this file only does avahi.
'use strict';

import { paths, run } from 'zeeli.common';
import { readfile, stat, writefile } from 'fs';

const MARK = '# zeeli';

/** Replaced by tests, which have no avahi to ask or restart. */
const avahi = {
	installed: function() {
		return paths.confdir ? true : stat('/usr/sbin/avahi-daemon') != null;
	},
	restart: function() {
		if (!paths.confdir) run(['/etc/init.d/avahi-daemon', 'restart']);
	},
};

const isHeader = (l) => match(trim(l), /^\[.*\]$/) != null;

/** Set `key=value` inside `section` (null value: remove it); add the section when it is missing. */
function put(lines, section, key, value, marked) {
	let at = index(map(lines, (l) => trim(l)), `[${section}]`);
	if (at < 0) {
		if (value == null) return lines;
		push(lines, '', `[${section}]`);
		at = length(lines) - 1;
	}
	let end = at + 1;
	while (end < length(lines) && !isHeader(lines[end])) end++;
	const out = slice(lines, 0, at + 1);
	for (let i = at + 1; i < end; i++) {
		if (!match(trim(lines[i]), regexp(`^${key}[ \t]*=`))) push(out, lines[i]);
		// our marker sits on the line before; it goes with the setting
		else if (trim(out[length(out) - 1]) == MARK) pop(out);
	}
	if (value != null) splice(out, at + 1, 0, ...(marked ? [MARK, `${key}=${value}`] : [`${key}=${value}`]));
	return [...out, ...slice(lines, end)];
}

/** The config text with the reflector on for these devices, or off when `devices` is null. */
function reflecting(text, devices) {
	let lines = split(text, '\n');
	if (lines[length(lines) - 1] == '') pop(lines);
	lines = put(lines, 'server', 'allow-interfaces', devices ? join(',', devices) : null, true);
	lines = put(lines, 'reflector', 'enable-reflector', devices ? 'yes' : 'no', false);
	return join('\n', lines) + '\n';
}

/** What the file says now: is the reflector on, and for which devices (those we set). */
function status() {
	const text = readfile(paths.avahi) ?? '';
	const m = match(text, /# zeeli\nallow-interfaces=([^\n]*)/);
	return {
		installed: avahi.installed(),
		reflecting: match(text, /(^|\n)enable-reflector[ \t]*=[ \t]*yes/) != null,
		devices: m ? split(trim(m[1]), ',') : [],
	};
}

/** Write the file (devices, or null to turn off) and restart avahi if it changed; false when the file can't be read or written. */
function configure(devices) {
	const text = readfile(paths.avahi);
	if (text == null) return false;
	const next = reflecting(text, devices);
	if (next == text) return true;
	if (!writefile(paths.avahi, next)) return false;
	avahi.restart();
	return true;
}

export { avahi, reflecting, status, configure };
