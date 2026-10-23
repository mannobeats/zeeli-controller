// zeeli.nftpolicy: Zeeli policies and groups as nftables text. Pure: no UCI, no clock, no
// commands, so every case can be tested with golden output.
//
// The text is an fw4 include (UCI `config include`, type nftables, position table-prepend),
// which fw4 pastes inside `table inet fw4 { … }`. It holds:
//   - one named set of MAC addresses per group in use, and one per policy for its clients
//   - for a "sites" policy, two sets of addresses (IPv4 and IPv6) that dnsmasq fills
//   - one chain per policy, holding that policy's rules while it applies and nothing while it
//     doesn't, so a schedule or an expiry only ever changes chain bodies
//   - `zeeli_forward`, a base chain at priority -1 that jumps to the policy chains in order
//   - `zeeli_rev`, a chain nothing jumps to, whose one rule carries a hash of the rest of the file
//     in its comment, so the agent can read back from the live ruleset which file fw4 really loaded
//   - for "sites" policies, a chain that sends the covered devices' DNS to dnsmasq (see below),
//     hooked from `zeeli_dns`, a NAT base chain that runs before GL's own DNS redirects
// A zone's devices are written out ("br-lan"), not as fw4's `$<zone>_devices` defines: a define for
// a zone that has since gone would stop fw4 loading anything at all, while an interface name that
// doesn't exist is only a rule that never matches. The agent rewrites the file when devices change.
'use strict';

const BLOCK_PRIORITY = -1;
/** One before fw4's and GL's dstnat chains (-100), so a device's DNS is sent to dnsmasq before GL sends it to AdGuard Home. */
const DNS_PRIORITY = -101;
const SITE_SET_SIZE = 4096;
const SITE_TIMEOUT = 3600;

/** Minutes since midnight for "HH:MM", or null. */
function toMinutes(s) {
	const m = type(s) == 'string' ? match(s, /^([01][0-9]|2[0-3]):([0-5][0-9])$/) : null;
	return m ? int(m[1], 10) * 60 + int(m[2], 10) : null;
}

/** The clock `compile` wants, from a timestamp and a function like `localtime`. wday is 1 Monday to 7 Sunday. */
function clock(ts, breakdown) {
	const t = breakdown(ts);
	return { ts, wday: t.wday == 0 ? 7 : t.wday, minutes: t.hour * 60 + t.min };
}

/**
 * Is a schedule running? A window that goes past midnight belongs to the day it starts on:
 * Friday 22:00 to 07:00 runs until Saturday morning. Equal times mean the whole day.
 */
function inWindow(when, now) {
	if (when?.kind != 'schedule') return true;
	const from = toMinutes(when.from), to = toMinutes(when.to);
	const today = now.wday, yesterday = today == 1 ? 7 : today - 1;
	const on = (d) => index(when.days, d) >= 0;
	if (from == to) return on(today);
	if (from < to) return on(today) && now.minutes >= from && now.minutes < to;
	return (on(today) && now.minutes >= from) || (on(yesterday) && now.minutes < to);
}

/** Does the policy apply right now: switched on, not expired, inside its schedule. */
function isActive(policy, now) {
	if (!policy.enabled) return false;
	if (policy.until != null && now.ts >= policy.until) return false;
	return inWindow(policy.when, now);
}

const lower = (macs) => uniq(map(macs, (m) => lc(m)));

/** FNV-1a over the bytes, as 8 hex digits. Not a security hash: it tells two versions of the file apart. */
function revisionOf(text) {
	let h = 2166136261;
	for (let i = 0; i < length(text); i++) h = ((h ^ ord(text, i)) * 16777619) & 0xffffffff;
	return sprintf('%08x', h);
}

/** The revision a file or `nft list chain inet fw4 zeeli_rev` carries, or null. */
function revisionIn(text) {
	const m = match(text ?? '', /zeeli-rev:([0-9a-f]{8})/);
	return m ? m[1] : null;
}

const revisionRule = (rev) => `counter comment "zeeli-rev:${rev}"`;

/** `{ "eth0", "sta1" }` for a list of devices. */
const literal = (devs) => `{ ${join(', ', map(devs, (d) => `"${d}"`))} }`;

/** `elements = { … }` for a set, or nothing when it has none. */
function elements(items) {
	if (!length(items)) return '';
	return `\t\telements = {\n${join('', map(items, (e) => `\t\t\t${e},\n`))}\t\t}\n`;
}

/** Source matches for each "who" of a policy, and the MACs it covers. */
function sources(policy, groupsById, zones, uplinks, out, used) {
	const matches = [], macs = [], clients = [];
	for (let w in policy.who) {
		if (w.type == 'group') {
			const g = groupsById[w.id];
			if (!g) continue;
			push(matches, `ether saddr @zeeli_g_${g.id}`);
			push(macs, ...g.members);
			if (used) used[g.id] = g;
		} else if (w.type == 'client') {
			push(clients, w.id);
		} else if (w.type == 'network') {
			if (index(uplinks, w.id) >= 0)
				push(out.warnings, `${policy.name}: “${w.id}” is an uplink, not a network of your own, so that part is skipped.`);
			else if (length(zones[w.id])) push(matches, `iifname ${literal(zones[w.id])}`);
			else push(out.warnings, `${policy.name}: the network “${w.id}” isn’t in the firewall, so that part is skipped.`);
		}
	}
	if (length(clients)) {
		push(matches, `ether saddr @zeeli_c_${policy.id}`);
		push(macs, ...clients);
	}
	return { matches, macs: lower(macs), clients: lower(clients) };
}

/** Destination matches for "what". An empty string matches any destination. */
function destinations(policy, zones, internetZones, out) {
	const what = policy.what;
	if (what.kind == 'everything') return [''];
	if (what.kind == 'internet') return map(filter(internetZones, (z) => length(zones[z])), (z) => `oifname ${literal(zones[z])}`);
	if (what.kind == 'sites') return [`ip daddr @zeeli_s4_${policy.id}`, `ip6 daddr @zeeli_s6_${policy.id}`];
	if (what.kind == 'network') {
		if (length(zones[what.network])) return [`oifname ${literal(zones[what.network])}`];
		push(out.warnings, `${policy.name}: the network “${what.network}” isn’t in the firewall, so this policy does nothing.`);
	}
	return [];
}

/**
 * Send these sources' DNS to dnsmasq (port 53 on the router). dnsmasq fills the site sets from
 * the answers it forwards. With AdGuard Home on, GL otherwise sends devices' DNS straight to
 * AdGuard (port 3053) and dnsmasq never sees it; dnsmasq's own upstream is AdGuard, so the
 * filtering still happens.
 */
function redirects(srcs) {
	const lines = [];
	for (let s in srcs) push(lines, `${s} udp dport 53 redirect to :53`, `${s} tcp dport 53 redirect to :53`);
	return lines;
}

/**
 * Rule lines for a policy that applies now: every source against every destination. Only the
 * original direction of a connection is matched, so the blocked side can't start connections
 * but still answers the ones the other side opened ("IoT can't reach LAN" is not "IoT can't
 * reply to LAN").
 */
function rulesFor(policy, srcs, dsts) {
	const verdict = policy.action.kind == 'allow' ? 'accept' : 'drop';
	const lines = [];
	for (let s in srcs)
		for (let d in dsts) push(lines, join(' ', filter([s, d, 'ct direction original', 'counter', verdict], (x) => x != '')));
	return lines;
}

/**
 * Work out everything the router has to do for these policies at this moment.
 *   input.groups     [{ id, members: [MAC] }]
 *   input.policies   normalised policies (see zeeli.policies), any order
 *   input.zones      { zone name: [devices] } for the firewall zones, as fw4 resolved them
 *   input.internet   names of the zones that count as "the internet"
 *   input.now        { ts, wday, minutes } from `clock`
 * Returns the sets and chains to declare, the speed limits that apply, who is blocked, the
 * domains to hand to dnsmasq, and warnings for parts that were skipped.
 */
function compile(input) {
	const groupsById = {};
	for (let g in input.groups) groupsById[g.id] = g;

	const out = { sets: [], chains: [], dns: [], limits: [], blocked: [], sites: {}, active: [], warnings: [] };
	const claimed = {}, used = {};
	// switched-off policies keep their (empty) chain, so switching one on is a live change
	const policies = sort([...input.policies], (a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

	for (let p in policies) {
		const on = isActive(p, input.now);
		const src = sources(p, groupsById, input.zones, input.internet, out, p.action.kind == 'limit' ? null : used);
		if (on) push(out.active, p.id);

		if (p.action.kind == 'limit') {
			if (!on) continue;
			if (length(filter(p.who, (w) => w.type == 'network')))
				push(out.warnings, `${p.name}: speed limits work per device, so a whole network can’t be limited.`);
			for (let mac in src.macs) {
				if (claimed[mac]) continue;
				claimed[mac] = true;
				push(out.limits, { mac, down: p.action.down ?? 0, up: p.action.up ?? 0, policy: p.id });
			}
			continue;
		}

		const dsts = destinations(p, input.zones, input.internet, out);
		if (length(src.clients)) push(out.sets, { name: `zeeli_c_${p.id}`, kind: 'mac', items: src.clients });
		if (p.what.kind == 'sites') {
			push(out.sets, { name: `zeeli_s4_${p.id}`, kind: 'ip4' }, { name: `zeeli_s6_${p.id}`, kind: 'ip6' });
			out.sites[p.id] = p.what.sites;
			push(out.dns, { name: `zeeli_d_${p.id}`, rules: on ? redirects(src.matches) : [] });
		}
		push(out.chains, { name: `zeeli_p_${p.id}`, rules: on ? rulesFor(p, src.matches, dsts) : [] });
		if (on && p.action.kind == 'block') push(out.blocked, ...src.macs);
	}

	const groupSets = map(sort(keys(used)), (id) => ({ name: `zeeli_g_${id}`, kind: 'mac', items: lower(used[id].members) }));
	out.sets = [...groupSets, ...out.sets];
	out.blocked = lower(out.blocked);
	return out;
}

function renderSet(s) {
	if (s.kind == 'mac') return `\tset ${s.name} {\n\t\ttype ether_addr\n${elements(s.items)}\t}\n`;
	const type = s.kind == 'ip4' ? 'ipv4_addr' : 'ipv6_addr';
	return `\tset ${s.name} {\n\t\ttype ${type}\n\t\tsize ${SITE_SET_SIZE}\n\t\ttimeout ${SITE_TIMEOUT}s\n\t\tflags timeout\n\t}\n`;
}

/** The include file's content before its revision chain is added. */
function renderBody(c) {
	const parts = ['# Written by the Zeeli agent from your policies. Changes made here are overwritten.\n\n'];
	for (let s in c.sets) push(parts, renderSet(s), '\n');
	for (let ch in [...c.chains, ...c.dns])
		push(parts, `\tchain ${ch.name} {\n`, ...map(ch.rules, (r) => `\t\t${r}\n`), '\t}\n\n');
	if (length(c.dns)) {
		push(parts, `\tchain zeeli_dns {\n\t\ttype nat hook prerouting priority ${DNS_PRIORITY}; policy accept;\n`);
		for (let ch in c.dns) push(parts, `\t\tjump ${ch.name}\n`);
		push(parts, '\t}\n\n');
	}
	push(parts, `\tchain zeeli_forward {\n\t\ttype filter hook forward priority ${BLOCK_PRIORITY}; policy accept;\n`);
	for (let ch in c.chains) push(parts, `\t\tjump ${ch.name}\n`);
	push(parts, '\t}\n');
	return join('', parts);
}

/** The include file for a compiled set of policies. */
function render(c) {
	const body = renderBody(c);
	return `${body}\n\tchain zeeli_rev {\n\t\t${revisionRule(revisionOf(body))}\n\t}\n`;
}

/** The sets and chains the file declares, by name: what `nft list table inet fw4` should hold of ours, and no more. */
function ownedNames(c) {
	return {
		chains: ['zeeli_forward', 'zeeli_rev', ...(length(c.dns) ? ['zeeli_dns'] : []), ...map([...c.chains, ...c.dns], (ch) => ch.name)],
		sets: map(c.sets, (s) => s.name),
	};
}

/**
 * The file without the rules inside policy chains. Two files with the same structure differ
 * only by what a schedule, an expiry or a change of devices switches on and off, which can
 * change on a running firewall; any other difference needs a firewall reload.
 */
function structureOf(text) {
	const keep = [];
	let inside = false;
	for (let line in split(text, '\n')) {
		if (match(line, /^\tchain (zeeli_[pd]_[0-9a-f]+|zeeli_rev) \{$/)) inside = true;
		else if (inside && line == '\t}') inside = false;
		else if (inside) continue;
		push(keep, line);
	}
	return join('\n', keep);
}

/** nft commands that swap in the current rules of every policy chain on a running firewall. */
function liveCommands(c) {
	const lines = [];
	for (let ch in [...c.chains, ...c.dns]) {
		push(lines, `flush chain inet fw4 ${ch.name}\n`);
		for (let r in ch.rules) push(lines, `add rule inet fw4 ${ch.name} ${r}\n`);
	}
	push(lines, `flush chain inet fw4 zeeli_rev\nadd rule inet fw4 zeeli_rev ${revisionRule(revisionOf(renderBody(c)))}\n`);
	return join('', lines);
}

/** The include as a file `nft -c -f` can check on its own, in a scratch table. */
const checkable = (text) => `table inet zeeli_check {\n${text}}\n`;

// this ucode needs exports listed rather than marked inline
export { toMinutes, clock, inWindow, isActive, compile, render, structureOf, liveCommands, checkable, revisionIn, ownedNames };
