// zeeli.firewall: zones, forwardings and traffic rules in /etc/config/firewall.
//
// Every write is confirm-or-roll-back (zeeli.rollback): snapshot, write, reload the firewall,
// and answer with a token the console must confirm within 30 seconds.
//
// What it leaves alone: sections the agent owns (named zeeli_*, or with `option zeeli '1'`,
// like the policy engine's fw4 includes) are hidden, and sections the firmware's services made
// (named, rather than anonymous: GL’s Samba and NAS rules, the Tailscale zone) are listed but
// read-only. Rule ids are UCI names, which for anonymous sections follow position, so the write
// methods also check the rule’s name and refuse when the list has changed under the console.
'use strict';

import { cursor, fail, services } from 'zeeli.common';
import { begin, discard } from 'zeeli.rollback';

const POLICY = ['ACCEPT', 'REJECT', 'DROP'];
const PROTO = ['tcp udp', 'tcp', 'udp', 'icmp', 'all'];
const FAMILY = ['', 'ipv4', 'ipv6'];
const NET = /^[A-Za-z0-9_]{1,32}$/;
const PORTS = /^[0-9]{1,5}(-[0-9]{1,5})?( [0-9]{1,5}(-[0-9]{1,5})?)*$/;

/** The agent’s own sections, which the console never sees. */
function agentOwned(s) {
	return s.zeeli == '1' || match(s['.name'], /^zeeli_/) != null || match(`${s.name ?? ''}`, /^zeeli_/) != null;
}

/** 'service' sections are named, so something other than a person made them. */
function owner(s) {
	if (!s['.anonymous']) return 'service';
	return match(`${s.name ?? ''}`, /^Allow-/) ? 'default' : 'custom';
}

const text = (v) => type(v) == 'array' ? join(' ', v) : v == null ? '' : `${v}`;
const words = (v) => type(v) == 'array' ? v : v == null ? [] : filter(split(`${v}`, ' '), (w) => w != '');

/** All sections of `kind` in file order, minus the agent’s. */
function sectionsOf(all, kind) {
	return filter(map(keys(all), (k) => all[k]), (s) => s['.type'] == kind && !agentOwned(s));
}

function zoneNames(all) {
	return map(sectionsOf(all, 'zone'), (z) => z.name);
}

/* ---------- reads ---------- */

function zoneRow(z) {
	return {
		name: z.name,
		input: z.input ?? 'ACCEPT',
		output: z.output ?? 'ACCEPT',
		forward: z.forward ?? 'ACCEPT',
		masquerade: z.masq == '1',
		mssClamp: z.mtu_fix == '1',
		networks: words(z.network),
		owner: owner(z),
		editable: owner(z) != 'service',
	};
}

function zones() {
	return { zones: map(sectionsOf(cursor().get_all('firewall') ?? {}, 'zone'), zoneRow) };
}

/** Every network interface and the zone it is in, for choosing what a zone covers. */
function networks() {
	const c = cursor();
	const zonesNow = sectionsOf(c.get_all('firewall') ?? {}, 'zone');
	const found = [];
	c.foreach('network', 'interface', (s) => {
		const name = s['.name'];
		if (name != 'loopback') push(found, { name, zone: filter(zonesNow, (z) => index(words(z.network), name) >= 0)[0]?.name });
	});
	return { networks: found };
}

function forwardings() {
	const all = cursor().get_all('firewall') ?? {};
	return {
		forwardings: map(sectionsOf(all, 'forwarding'), (f) => ({
			id: f['.name'],
			src: f.src ?? '',
			dest: f.dest ?? '',
			enabled: f.enabled != '0',
			owner: owner(f),
			editable: owner(f) != 'service',
		})),
	};
}

function ruleRow(r, index) {
	return {
		id: r['.name'],
		index,
		name: r.name ?? (r['.anonymous'] ? 'Unnamed rule' : r['.name']),
		src: r.src ?? '',
		dest: r.dest ?? '',
		proto: text(r.proto) || 'tcp udp',
		destPort: text(r.dest_port),
		srcIp: text(r.src_ip),
		destIp: text(r.dest_ip),
		target: r.target ?? 'ACCEPT',
		family: r.family ?? '',
		enabled: r.enabled != '0',
		owner: owner(r),
		editable: owner(r) != 'service',
	};
}

function rules() {
	const all = cursor().get_all('firewall') ?? {};
	return { rules: map(sectionsOf(all, 'rule'), ruleRow) };
}

/* ---------- checks ---------- */

function isCount(v, max) {
	return type(v) == 'int' && v >= 0 && v <= max;
}

/** An IPv4 or IPv6 address or network, such as 192.168.8.5, 10.0.0.0/8 or fd00::/8. */
function validAddress(s) {
	const m = match(s, /^([0-9.]+|[0-9a-fA-F:]+)(\/([0-9]{1,3}))?$/);
	if (!m) return false;
	if (index(m[1], ':') >= 0) return length(split(m[1], ':')) >= 3 && (m[3] == null || int(m[3]) <= 128);
	const octets = split(m[1], '.');
	return length(octets) == 4 && length(filter(octets, (o) => match(o, /^[0-9]{1,3}$/) && int(o) <= 255)) == 4 && (m[3] == null || int(m[3]) <= 32);
}

function validPorts(s) {
	if (!match(s, PORTS)) return false;
	for (let p in split(s, ' ')) for (let n in split(p, '-')) if (int(n) < 1 || int(n) > 65535) return false;
	return true;
}

/**
 * Check the fields of a rule that were given (null means “not given”) against the zones that
 * exist. Returns { values, clear } for UCI, or { error }.
 */
function ruleValues(a, all, base) {
	const values = {};
	const clear = [];
	const zonesNow = zoneNames(all);
	if (a.name != null) {
		if (type(a.name) != 'string' || length(trim(a.name)) < 1 || length(a.name) > 64 || match(a.name, /[[:cntrl:]]/))
			return fail('Give the rule a name of up to 64 characters.');
		values.name = trim(a.name);
	}
	if (a.src != null) {
		if (a.src != '*' && index(zonesNow, a.src) < 0) return fail(`There’s no zone called ${a.src}.`);
		values.src = a.src;
	}
	if (a.dest != null) {
		if (a.dest != '' && a.dest != '*' && index(zonesNow, a.dest) < 0) return fail(`There’s no zone called ${a.dest}.`);
		if (a.dest == '') push(clear, 'dest');
		else values.dest = a.dest;
	}
	if (a.proto != null) {
		if (index(PROTO, a.proto) < 0) return fail('The protocol must be TCP, UDP, both, ICMP or any.');
		values.proto = a.proto;
	}
	if (a.target != null) {
		if (index(POLICY, a.target) < 0) return fail('The action must be allow, reject or drop.');
		values.target = a.target;
	}
	if (a.family != null) {
		if (index(FAMILY, a.family) < 0) return fail('The IP version must be IPv4, IPv6 or both.');
		if (a.family == '') push(clear, 'family');
		else values.family = a.family;
	}
	if (a.enabled != null) {
		if (type(a.enabled) != 'bool') return fail('Turn the rule on or off.');
		values.enabled = a.enabled ? '1' : '0';
	}
	const checked = [
		{ arg: 'destPort', opt: 'dest_port', ok: validPorts, msg: 'Ports must be 1 to 65535: 443, 8000-8010 or 80 443.' },
		{ arg: 'srcIp', opt: 'src_ip', ok: validAddress, msg: 'The from address must be an IP address or network.' },
		{ arg: 'destIp', opt: 'dest_ip', ok: validAddress, msg: 'The to address must be an IP address or network.' },
	];
	for (let f in checked) {
		const v = a[f.arg];
		if (v == null) continue;
		if (v == '') push(clear, f.opt);
		else if (type(v) != 'string' || !f.ok(v)) return fail(f.msg);
		else values[f.opt] = v;
	}
	const proto = values.proto ?? text(base?.proto) ?? 'tcp udp';
	const port = values.dest_port ?? (index(clear, 'dest_port') >= 0 ? '' : text(base?.dest_port));
	if (port != '' && index(['tcp udp', 'tcp', 'udp'], proto == '' ? 'tcp udp' : proto) < 0) return fail('Ports only apply to TCP or UDP.');
	return { values, clear };
}

/** A rule the console may change: it exists, isn’t the firmware’s or the agent’s, and still has the name the console saw. */
function ruleSection(all, id, name) {
	const s = type(id) == 'string' ? all[id] : null;
	if (!s || s['.type'] != 'rule' || agentOwned(s)) return fail('That rule is gone. Reload the list.');
	if (owner(s) == 'service') return fail('Rules made by router services are changed from that service.');
	if (name != null && `${s.name ?? ''}` != name) return fail('The firewall changed since you loaded it. Reload the list.');
	return s;
}

/* ---------- writes ---------- */

/**
 * Stage a change with `stage(cursor, all)`, which returns { error }, { noop: true } when there is
 * nothing to change, or a result; then snapshot, commit, reload the firewall and hand back the
 * confirm token alongside the result.
 */
function write(what, stage) {
	const c = cursor();
	const all = c.get_all('firewall') ?? {};
	const result = stage(c, all);
	if (result.error || result.noop) {
		c.revert('firewall');
		return result;
	}
	const arm = begin('firewall', ['firewall'], what);
	if (arm.error) {
		c.revert('firewall');
		return arm;
	}
	c.save('firewall');
	if (!c.commit('firewall')) {
		discard(arm.token);
		return fail(`The router wouldn’t save the change: ${c.error() ?? 'unknown error'}`);
	}
	services.reload('firewall');
	return { ...result, token: arm.token, seconds: arm.seconds, expires: arm.expires };
}

function setOption(c, sid, opt, v) {
	if (v == null) c.delete('firewall', sid, opt);
	else c.set('firewall', sid, opt, v);
}

function zone_update(a) {
	return write('changing a firewall zone', (c, all) => {
		const z = filter(sectionsOf(all, 'zone'), (s) => s.name == a.name)[0];
		if (!z) return fail(`There’s no zone called ${a.name}.`);
		if (owner(z) == 'service') return fail('Zones made by router services are changed from that service.');
		const sid = z['.name'];
		for (let opt in ['input', 'output', 'forward'])
			if (a[opt] != null) {
				if (index(POLICY, a[opt]) < 0) return fail('A zone’s traffic must be allowed, rejected or dropped.');
				c.set('firewall', sid, opt, a[opt]);
			}
		if (a.masquerade != null) setOption(c, sid, 'masq', a.masquerade ? '1' : null);
		if (a.mssClamp != null) setOption(c, sid, 'mtu_fix', a.mssClamp ? '1' : null);
		if (a.networks != null) {
			const nets = uniq(a.networks);
			for (let n in nets) {
				if (!match(n, NET) || c.get('network', n) != 'interface') return fail(`There’s no network called ${n}.`);
				for (let other in sectionsOf(all, 'zone'))
					if (other.name != a.name && index(words(other.network), n) >= 0)
						return fail(`${n} is already in the ${other.name} zone. Take it out of there first.`);
			}
			setOption(c, sid, 'network', length(nets) ? nets : null);
		}
		return {};
	});
}

function forwarding_add(a) {
	return write('adding a zone forwarding', (c, all) => {
		const names = zoneNames(all);
		if (index(names, a.src) < 0 || index(names, a.dest) < 0) return fail('Pick two zones that exist.');
		if (a.src == a.dest) return fail('A forwarding connects two different zones.');
		if (length(filter(sectionsOf(all, 'forwarding'), (f) => f.src == a.src && f.dest == a.dest))) return fail('Those zones are already connected.');
		const sid = c.add('firewall', 'forwarding');
		c.set('firewall', sid, 'src', a.src);
		c.set('firewall', sid, 'dest', a.dest);
		return { id: sid };
	});
}

function forwarding_remove(a) {
	return write('removing a zone forwarding', (c, all) => {
		const f = type(a.id) == 'string' ? all[a.id] : null;
		if (!f || f['.type'] != 'forwarding' || agentOwned(f)) return fail('That forwarding is gone. Reload the list.');
		if (owner(f) == 'service') return fail('Forwardings made by router services are changed from that service.');
		c.delete('firewall', a.id);
		return {};
	});
}

function apply(c, sid, v) {
	for (let opt, value in v.values) c.set('firewall', sid, opt, value);
	for (let opt in v.clear) c.delete('firewall', sid, opt);
}

function rule_add(a) {
	return write('adding a firewall rule', (c, all) => {
		if (a.name == null) return fail('Give the rule a name of up to 64 characters.');
		// a new rule has every field, so missing ones take the usual defaults
		const given = {
			name: a.name,
			dest: a.dest,
			destPort: a.destPort,
			srcIp: a.srcIp,
			destIp: a.destIp,
			family: a.family,
			proto: a.proto ?? 'tcp udp',
			src: a.src ?? '*',
			target: a.target ?? 'ACCEPT',
			enabled: a.enabled ?? true,
		};
		const v = ruleValues(given, all, null);
		if (v.error) return v;
		const sid = c.add('firewall', 'rule');
		apply(c, sid, v);
		return { id: sid };
	});
}

function rule_update(a) {
	return write('changing a firewall rule', (c, all) => {
		const s = ruleSection(all, a.id, a.current);
		if (s.error) return s;
		const v = ruleValues(a, all, s);
		if (v.error) return v;
		apply(c, s['.name'], v);
		return {};
	});
}

function rule_enable(a) {
	if (type(a.enabled) != 'bool') return fail('Turn the rule on or off.');
	return write(`turning a firewall rule ${a.enabled ? 'on' : 'off'}`, (c, all) => {
		const s = ruleSection(all, a.id, a.current);
		if (s.error) return s;
		c.set('firewall', s['.name'], 'enabled', a.enabled ? '1' : '0');
		return {};
	});
}

function rule_delete(a) {
	return write('deleting a firewall rule', (c, all) => {
		const s = ruleSection(all, a.id, a.current);
		if (s.error) return s;
		c.delete('firewall', s['.name']);
		return {};
	});
}

/**
 * Move a rule to position `to` (0 is first) in the list the console shows. The agent’s own
 * rules are not in that list, so the rule is placed next to the visible rule it follows or
 * precedes and the agent’s rules keep their places.
 */
function rule_move(a) {
	if (!isCount(a.to, 9999)) return fail('Pick where the rule goes.');
	return write('moving a firewall rule', (c, all) => {
		const s = ruleSection(all, a.id, a.current);
		if (s.error) return s;
		const visible = sectionsOf(all, 'rule');
		const rest = filter(visible, (r) => r['.name'] != a.id);
		const to = a.to < length(rest) ? a.to : length(rest);
		if (to == index(map(visible, (r) => r['.name']), a.id)) return { noop: true, moved: false };
		// the final position among all sections, counting the moved rule out of its old place
		const own = s['.index'];
		let at;
		if (to == 0) at = own > rest[0]['.index'] ? rest[0]['.index'] : rest[0]['.index'] - 1;
		else at = own > rest[to - 1]['.index'] ? rest[to - 1]['.index'] + 1 : rest[to - 1]['.index'];
		c.reorder('firewall', a.id, at);
		return { moved: true };
	});
}

// this ucode needs exports listed rather than marked inline
export { zones, networks, forwardings, rules, zone_update, forwarding_add, forwarding_remove, rule_add, rule_update, rule_enable, rule_delete, rule_move };
