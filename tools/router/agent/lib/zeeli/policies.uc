// zeeli.policies: one rule in plain words. Who (devices, groups, networks), what (the internet,
// some sites, another network, everything), when (always or a schedule) and the action (block,
// allow, limit speed, or route through a VPN tunnel or an uplink), with an optional end time for
// "pause for an hour".
//
//   { id, name, enabled, order,
//     who:    [{ type: 'client' | 'group' | 'network', id }],
//     what:   { kind: 'internet' | 'everything' } | { kind: 'sites', sites: [domain] } | { kind: 'network', network },
//     when:   { kind: 'always' } | { kind: 'schedule', days: [1..7 Monday..Sunday], from: 'HH:MM', to: 'HH:MM' },
//     until:  seconds since epoch, or null,
//     action: { kind: 'block' | 'allow' } | { kind: 'limit', down, up },   limits in Mbps, 0 for none
//           | { kind: 'route', target: 'vpn:<GL tunnel id>' | 'uplink:<interface>', fallback: 'block' | 'normal' },
//             what a route policy covers is the internet or sites; `fallback` is what happens to the
//             traffic while the target is down: 'block' (the default) cuts it off, 'normal' lets it
//             take the normal route
//     tag:    who made it, e.g. 'family:3' }
//
// Policies apply from the top of the list down and the first match decides, so an "allow" above
// a "block" is an exception to it. See zeeli.policyapply for how they reach the firewall.
'use strict';

import { fail, valid } from 'zeeli.common';
import * as nft from 'zeeli.nftpolicy';
import { mutate, resolveTargets, status as applyStatus, sys, targetConfig } from 'zeeli.policyapply';
import * as store from 'zeeli.store';

const WHAT = ['internet', 'everything', 'sites', 'network'];
const ACTIONS = ['block', 'allow', 'limit', 'route'];
const MAX_MBPS = 10000;
const MAX_PAUSE_MINUTES = 7 * 24 * 60;

const isObject = (v) => type(v) == 'object';
const sameList = (a, b) => sprintf('%J', a) == sprintf('%J', b);

/** A policy as the console sees it: only the fields that mean something for its kind. */
function show(p, active) {
	const out = {
		id: p.id,
		name: p.name,
		enabled: p.enabled,
		order: p.order,
		who: p.who,
		what: { kind: p.what.kind },
		when: { kind: p.when.kind },
		until: p.until,
		action: { kind: p.action.kind },
		tag: p.tag,
		active,
	};
	if (p.what.kind == 'sites') out.what.sites = p.what.sites;
	if (p.what.kind == 'network') out.what.network = p.what.network;
	if (p.when.kind == 'schedule') {
		out.when.days = p.when.days;
		out.when.from = p.when.from;
		out.when.to = p.when.to;
	}
	if (p.action.kind == 'limit') {
		out.action.down = p.action.down ?? 0;
		out.action.up = p.action.up ?? 0;
	}
	if (p.action.kind == 'route') {
		out.action.target = p.action.target;
		out.action.fallback = p.action.fallback;
	}
	return out;
}

/** Who a policy applies to; every entry has to exist. Returns { who } or { error }. */
function checkWho(raw, groups, zones, uplinks) {
	if (type(raw) != 'array' || !length(raw)) return fail('Choose who the policy is for.');
	if (length(raw) > store.LIMITS.who) return fail(`A policy can name up to ${store.LIMITS.who} devices, groups or networks.`);
	const who = [];
	for (let w in raw) {
		if (!isObject(w) || type(w.id) != 'string') return fail('Each entry in “who” needs a type and an id.');
		let id = w.id;
		if (w.type == 'client') {
			if (!valid.mac(id)) return fail(`“${id}” isn’t a MAC address.`);
			id = uc(id);
		} else if (w.type == 'group') {
			if (!length(filter(groups, (g) => g.id == id))) return fail('One of the groups in this policy doesn’t exist.');
		} else if (w.type == 'network') {
			if (index(zones, id) < 0) return fail(`The firewall has no network called ${id}.`);
			if (index(uplinks, id) >= 0) return fail(`“${id}” is an uplink, not a network of your own, so a policy for it would cut off everyone behind it.`);
		} else {
			return fail(`“${w.type}” isn’t something a policy can be for.`);
		}
		if (!length(filter(who, (x) => x.type == w.type && x.id == id))) push(who, { type: w.type, id });
	}
	return { who };
}

function checkSites(raw) {
	if (type(raw) != 'array' || !length(raw)) return fail('Add at least one site.');
	if (length(raw) > store.LIMITS.sites) return fail(`A policy can name up to ${store.LIMITS.sites} sites.`);
	const sites = [];
	for (let d in raw) {
		const s = type(d) == 'string' ? lc(trim(d)) : null;
		if (!store.isDomain(s)) return fail(`“${d}” isn’t a site. Use just the domain, like tiktok.com. Subdomains are included.`);
		if (index(sites, s) < 0) push(sites, s);
	}
	return { sites };
}

function checkWhat(raw, zones) {
	if (!isObject(raw) || index(WHAT, raw.kind) < 0) return fail('Choose what the policy covers.');
	if (raw.kind == 'sites') {
		const r = checkSites(raw.sites);
		return r.error ? r : { what: { kind: 'sites', sites: r.sites } };
	}
	if (raw.kind == 'network') {
		if (index(zones, raw.network) < 0) return fail(`The firewall has no network called ${raw.network}.`);
		return { what: { kind: 'network', network: raw.network } };
	}
	return { what: { kind: raw.kind } };
}

function checkWhen(raw) {
	if (!isObject(raw) || (raw.kind != 'always' && raw.kind != 'schedule')) return fail('Choose when the policy applies.');
	if (raw.kind == 'always') return { when: { kind: 'always' } };
	if (type(raw.days) != 'array' || !length(raw.days)) return fail('Choose at least one day for the schedule.');
	const days = [];
	for (let d in raw.days) {
		if (type(d) != 'int' || d < 1 || d > 7) return fail('Days run from 1 (Monday) to 7 (Sunday).');
		if (index(days, d) < 0) push(days, d);
	}
	if (nft.toMinutes(raw.from) == null || nft.toMinutes(raw.to) == null) return fail('Times look like 22:00.');
	return { when: { kind: 'schedule', days: sort(days), from: raw.from, to: raw.to } };
}

/** A route policy: through what, and what happens while that is down. `isNew` is false for a target the policy already had. */
function checkRoute(raw, what, c, isNew) {
	if (what.kind != 'internet' && what.kind != 'sites') return fail('Routing covers the internet or chosen sites, not everything or another network.');
	if (!store.isRouteTarget(raw.target)) return fail('Choose a VPN tunnel or an internet connection to route through.');
	const fallback = raw.fallback ?? 'block';
	if (fallback != 'block' && fallback != 'normal') return fail('While the target is down, the traffic is either blocked or takes the normal route.');
	if (isNew && !length(filter(targetConfig(c), (t) => t.id == raw.target))) return fail('The router has no such VPN tunnel or internet connection.');
	return { action: { kind: 'route', target: raw.target, fallback } };
}

function checkAction(raw, what, who, c, isNew) {
	if (!isObject(raw) || index(ACTIONS, raw.kind) < 0) return fail('Choose what the policy does.');
	if (raw.kind == 'route') return checkRoute(raw, what, c, isNew);
	if (raw.kind != 'limit') return { action: { kind: raw.kind } };
	for (let key in ['down', 'up']) {
		const v = raw[key] ?? 0;
		if (!store.isNumber(v) || v < 0 || v > MAX_MBPS) return fail(`A speed limit is between 0 and ${MAX_MBPS} Mbps.`);
	}
	const down = raw.down ?? 0, up = raw.up ?? 0;
	if (!(down > 0) && !(up > 0)) return fail('Enter a download or an upload limit.');
	if (what.kind != 'internet' && what.kind != 'everything') return fail('A speed limit covers all of a device’s traffic, not one site or network.');
	if (length(filter(who, (w) => w.type == 'network'))) return fail('A speed limit is set per device, so it can’t be for a whole network.');
	return { action: { kind: 'limit', down, up } };
}

/** How many different targets, with their fallbacks, the route policies other than `except` use, plus this action's. */
function routeSlots(policies, except, action) {
	const keys = [];
	for (let p in policies) if (p.action.kind == 'route' && p.id != except) push(keys, `${p.action.target}/${p.action.fallback}`);
	if (action.kind == 'route') push(keys, `${action.target}/${action.fallback}`);
	return length(uniq(keys));
}

/**
 * Check a policy as the console sent it, filling gaps from `base` (the stored policy on an
 * update). Returns { policy } or { error }.
 */
function build(c, args, base) {
	const groups = store.readGroups(c), zones = store.zoneNames(c);
	const raw = (key, fallback) => args[key] ?? fallback;

	const nameError = store.checkName(raw('name', base.name), 'policy');
	if (nameError) return fail(nameError);
	const who = checkWho(raw('who', base.who), groups, zones, store.uplinkZones(c));
	if (who.error) return who;
	const what = checkWhat(raw('what', base.what), zones);
	if (what.error) return what;
	const when = checkWhen(raw('when', base.when));
	if (when.error) return when;
	// a target that has since gone is only refused when the policy is pointed at it, so the rest of the policy stays editable
	const newTarget = isObject(args.action) && args.action.target != base.action.target;
	const action = checkAction(raw('action', base.action), what.what, who.who, c, newTarget);
	if (action.error) return action;
	const slots = routeSlots(store.readPolicies(c), base.id, action.action);
	if (slots > store.LIMITS.routes) return fail(`Policies can route through up to ${store.LIMITS.routes} different targets (counting what happens while one is down).`);

	let until = base.until;
	if (args.until != null) {
		if (!store.isNumber(args.until) || args.until < 0) return fail('That end time isn’t valid.');
		until = args.until == 0 ? null : int(args.until);
		if (until != null && until != base.until && until <= sys.now()) return fail('That time has already passed.');
	}
	const tag = raw('tag', base.tag);
	if (type(tag) != 'string' || !match(tag, /^[A-Za-z0-9:_. -]{0,64}$/)) return fail('That label isn’t valid.');

	return {
		policy: {
			id: base.id,
			name: trim(raw('name', base.name)),
			enabled: type(args.enabled) == 'bool' ? args.enabled : base.enabled,
			order: base.order,
			who: who.who,
			what: what.what,
			when: when.when,
			until,
			action: action.action,
			tag,
		},
	};
}

const blank = { name: '', enabled: true, order: 0, who: [], what: {}, when: {}, until: null, action: {}, tag: '' };

function nextOrder(policies) {
	let top = 0;
	for (let p in policies) if (p.order > top) top = p.order;
	return top + 10;
}

function live(c) {
	const now = sys.now();
	return filter(store.readPolicies(c), (p) => p.until == null || p.until > now);
}

/** What `list` tells the console about the current moment. */
function list() {
	const c = store.open();
	const s = applyStatus(c);
	return { policies: map(live(c), (p) => show(p, index(s.active, p.id) >= 0)), now: s.now, warnings: s.warnings };
}

/**
 * What a route policy can send traffic through, for the console to offer: GL's VPN tunnels by
 * name and the internet uplinks, each with whether it is up now. `name` is what a sentence says
 * ("UK VPN"), `label` what a list says ("UK VPN (WireGuard)").
 */
function routeTargets() {
	const c = store.open();
	const found = resolveTargets(c, null);
	return { targets: map(filter(targetConfig(c), (t) => found[t.id]), (t) => ({ id: t.id, kind: t.kind, name: t.name, label: t.label, up: found[t.id].up })) };
}

function status() {
	return applyStatus(store.open());
}

function create(args) {
	return mutate((c) => {
		const policies = store.readPolicies(c);
		if (length(policies) >= store.LIMITS.policies) return fail(`You can have up to ${store.LIMITS.policies} policies.`);
		const id = store.newId(c, 'zeeli_p_');
		if (!id) return fail('The router couldn’t make an id for the policy. Try again.');
		const r = build(c, args, { ...blank, id, order: nextOrder(policies) });
		if (r.error) return r;
		store.writePolicy(c, r.policy);
		return { policy: show(r.policy, false) };
	});
}

function update(args) {
	return mutate((c) => {
		const base = filter(store.readPolicies(c), (p) => p.id == args.id)[0];
		if (!base) return fail('That policy doesn’t exist.');
		const r = build(c, args, base);
		if (r.error) return r;
		store.writePolicy(c, r.policy);
		return { policy: show(r.policy, false) };
	});
}

function remove(args) {
	return mutate((c) => {
		if (!filter(store.readPolicies(c), (p) => p.id == args.id)[0]) return fail('That policy doesn’t exist.');
		store.removePolicy(c, args.id);
		return {};
	});
}

/** Put the policies in this order; any not named keep their relative order after the ones that are. */
function reorder(args) {
	return mutate((c) => {
		const policies = store.readPolicies(c);
		const ids = args.ids;
		if (type(ids) != 'array') return fail('Send the policies in the order you want.');
		const byId = {};
		for (let p in policies) byId[p.id] = p;
		const seen = {};
		for (let id in ids) {
			if (!byId[id] || seen[id]) return fail('That order names a policy twice or one that doesn’t exist.');
			seen[id] = true;
		}
		const sorted = [...map(ids, (id) => byId[id]), ...filter(policies, (p) => !seen[p.id])];
		for (let i = 0; i < length(sorted); i++) store.writePolicy(c, { ...sorted[i], order: (i + 1) * 10 });
		return {};
	});
}

/**
 * Block devices for a while, ending on its own. A pause with a `tag` replaces an earlier one
 * with the same tag, so pausing a profile again restarts its timer.
 */
function pause(args) {
	const minutes = args.minutes;
	if (type(minutes) != 'int' || minutes < 1 || minutes > MAX_PAUSE_MINUTES) return fail('A pause lasts from 1 minute to 7 days.');
	return mutate((c) => {
		const policies = store.readPolicies(c);
		if (args.tag) for (let p in policies) if (p.tag == args.tag) store.removePolicy(c, p.id);
		const kept = filter(policies, (p) => !args.tag || p.tag != args.tag);
		if (length(kept) >= store.LIMITS.policies) return fail(`You can have up to ${store.LIMITS.policies} policies.`);
		const id = store.newId(c, 'zeeli_p_');
		if (!id) return fail('The router couldn’t make an id for the pause. Try again.');
		const r = build(
			c,
			{
				name: args.name ?? 'Paused',
				who: args.who,
				what: { kind: args.what ?? 'internet' },
				when: { kind: 'always' },
				action: { kind: 'block' },
				until: sys.now() + minutes * 60,
				tag: args.tag ?? '',
			},
			{ ...blank, id, order: nextOrder(kept) }
		);
		if (r.error) return r;
		store.writePolicy(c, r.policy);
		return { policy: show(r.policy, true) };
	});
}

/** Reconcile now, e.g. after the firewall was changed elsewhere. */
function apply() {
	return mutate(() => ({}));
}

// this ucode needs exports listed rather than marked inline
export { list, status, create, update, remove, reorder, pause, apply, routeTargets };
