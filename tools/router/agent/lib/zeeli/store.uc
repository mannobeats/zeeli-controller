// zeeli.store: groups and policies in /etc/config/zeeli, and the rules for what may be in them.
// Section types `group` and `policy`, named zeeli_g_<id> and zeeli_p_<id>, each marked with
// `option zeeli '1'`. Nothing here touches the firewall; see zeeli.policyapply for that.
'use strict';

import { open as fsopen, readfile } from 'fs';
import { cursor, paths, valid } from 'zeeli.common';

const LIMITS = { groups: 64, members: 256, policies: 128, who: 32, sites: 50, name: 40 };
const CONFIG = 'zeeli';

/** A cursor on /etc/config/zeeli, creating the file first: UCI refuses to write a package that doesn't exist. */
function open() {
	const f = fsopen(`${paths.confdir ?? '/etc/config'}/${CONFIG}`, 'a');
	if (f) f.close();
	return cursor();
}

const asList = (v) => (type(v) == 'array' ? v : v == null ? [] : [v]);
const asNumber = (v) => (v == null || v == '' ? null : +v);

/** Six random hex digits not used by a section of this type yet. */
function newId(c, prefix) {
	for (let tries = 0; tries < 20; tries++) {
		const bytes = readfile('/dev/urandom', 3) ?? '';
		const id = join('', map([0, 1, 2], (i) => sprintf('%02x', ord(bytes, i) ?? tries)));
		if (!c.get(CONFIG, `${prefix}${id}`)) return id;
	}
	return null;
}

/* ---------- reading ---------- */

function readGroups(c) {
	const groups = [];
	c.foreach(CONFIG, 'group', (s) => {
		if (!match(s['.name'], /^zeeli_g_[0-9a-f]{6}$/)) return;
		push(groups, {
			id: substr(s['.name'], 8),
			name: s.name ?? '',
			kind: s.kind == 'person' ? 'person' : 'devices',
			members: map(asList(s.member), (m) => uc(m)),
		});
	});
	return groups;
}

function parseWho(entry) {
	const at = index(entry, ':');
	return at < 0 ? null : { type: substr(entry, 0, at), id: substr(entry, at + 1) };
}

function readPolicies(c) {
	const policies = [];
	c.foreach(CONFIG, 'policy', (s) => {
		if (!match(s['.name'], /^zeeli_p_[0-9a-f]{6}$/)) return;
		push(policies, {
			id: substr(s['.name'], 8),
			name: s.name ?? '',
			enabled: s.enabled != '0',
			order: int(s.order ?? 0, 10),
			who: filter(map(asList(s.who), parseWho), (w) => w != null),
			what: { kind: s.what ?? 'internet', sites: asList(s.site), network: s.what_network ?? null },
			when: { kind: s.when ?? 'always', days: map(asList(s.day), (d) => int(d, 10)), from: s.from ?? null, to: s.to ?? null },
			until: s.until ? int(s.until, 10) : null,
			action: { kind: s.action ?? 'block', down: asNumber(s.down), up: asNumber(s.up) },
			tag: s.tag ?? '',
		});
	});
	return sort(policies, (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

/* ---------- writing ---------- */

function writeGroup(c, g) {
	const sec = `zeeli_g_${g.id}`;
	c.delete(CONFIG, sec);
	c.set(CONFIG, sec, 'group');
	c.set(CONFIG, sec, 'zeeli', '1');
	c.set(CONFIG, sec, 'name', g.name);
	c.set(CONFIG, sec, 'kind', g.kind);
	if (length(g.members)) c.set(CONFIG, sec, 'member', g.members);
}

function writePolicy(c, p) {
	const sec = `zeeli_p_${p.id}`;
	c.delete(CONFIG, sec);
	c.set(CONFIG, sec, 'policy');
	c.set(CONFIG, sec, 'zeeli', '1');
	c.set(CONFIG, sec, 'name', p.name);
	c.set(CONFIG, sec, 'enabled', p.enabled ? '1' : '0');
	c.set(CONFIG, sec, 'order', `${p.order}`);
	c.set(CONFIG, sec, 'who', map(p.who, (w) => `${w.type}:${w.id}`));
	c.set(CONFIG, sec, 'what', p.what.kind);
	if (p.what.kind == 'sites') c.set(CONFIG, sec, 'site', p.what.sites);
	if (p.what.kind == 'network') c.set(CONFIG, sec, 'what_network', p.what.network);
	c.set(CONFIG, sec, 'when', p.when.kind);
	if (p.when.kind == 'schedule') {
		c.set(CONFIG, sec, 'day', map(p.when.days, (d) => `${d}`));
		c.set(CONFIG, sec, 'from', p.when.from);
		c.set(CONFIG, sec, 'to', p.when.to);
	}
	if (p.until != null) c.set(CONFIG, sec, 'until', `${p.until}`);
	c.set(CONFIG, sec, 'action', p.action.kind);
	if (p.action.kind == 'limit') {
		c.set(CONFIG, sec, 'down', sprintf('%g', p.action.down ?? 0));
		c.set(CONFIG, sec, 'up', sprintf('%g', p.action.up ?? 0));
	}
	if (p.tag) c.set(CONFIG, sec, 'tag', p.tag);
}

const removeGroup = (c, id) => c.delete(CONFIG, `zeeli_g_${id}`);
const removePolicy = (c, id) => c.delete(CONFIG, `zeeli_p_${id}`);
const commit = (c) => c.commit(CONFIG);

/* ---------- checking what the console sends ---------- */

const isNumber = (v) => type(v) == 'int' || type(v) == 'double';
const isId = (v) => type(v) == 'string' && match(v, /^[0-9a-f]{6}$/) != null;

/** A name people see: 1 to 40 characters, no control characters, no leading or trailing space. */
function checkName(v, what) {
	if (type(v) != 'string') return `Give the ${what} a name.`;
	const s = trim(v);
	if (!length(s)) return `Give the ${what} a name.`;
	if (length(s) > LIMITS.name * 2 || match(s, /[[:cntrl:]]/)) return `A ${what} name can have letters, numbers and punctuation, up to ${LIMITS.name} characters.`;
	return null;
}

/** A device list: a real array of MAC addresses, within the limit, upper case and without repeats. */
function checkMacs(v) {
	if (type(v) != 'array') return { error: 'Members must be a list of MAC addresses.' };
	for (let m in v) if (!valid.mac(m)) return { error: `“${m}” isn’t a MAC address.` };
	return { macs: uniq(map(v, (m) => uc(m))) };
}

/** A site, as a bare lower-case domain: no scheme, path, port or wildcard. Subdomains are always included. */
const isDomain = (d) =>
	type(d) == 'string' &&
	length(d) <= 253 &&
	match(d, /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/) != null;

/** A firewall zone name, which is also the network's id in policies. */
const isZoneName = (v) => type(v) == 'string' && match(v, /^[A-Za-z][A-Za-z0-9_]{0,31}$/) != null;

/** The firewall zones that exist, by name. */
function zoneNames(c) {
	const names = [];
	c.foreach('firewall', 'zone', (z) => {
		if (isZoneName(z.name)) push(names, z.name);
	});
	return names;
}

// this ucode needs exports listed rather than marked inline
export { LIMITS, open, newId, readGroups, readPolicies, writeGroup, writePolicy, removeGroup, removePolicy, commit };
export { isNumber, isId, checkName, checkMacs, isDomain, isZoneName, zoneNames };
