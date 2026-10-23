// zeeli.groups: named sets of devices ("Kids", "Mum’s devices") that policies refer to.
// A group is { id, name, kind: 'person' | 'devices', members: [MAC] }.
'use strict';

import { fail } from 'zeeli.common';
import { mutate } from 'zeeli.policyapply';
import * as store from 'zeeli.store';

const KINDS = ['person', 'devices'];

const same = (a, b) => lc(a) == lc(b);

function find(c, id) {
	if (!store.isId(id)) return null;
	return filter(store.readGroups(c), (g) => g.id == id)[0] ?? null;
}

/** Why this group can't be saved, or null. `others` are the groups it must not collide with. */
function problem(g, others) {
	const bad = store.checkName(g.name, 'group');
	if (bad) return bad;
	if (index(KINDS, g.kind) < 0) return 'A group is for a person or for a set of devices.';
	if (length(g.members) > store.LIMITS.members) return `A group can hold up to ${store.LIMITS.members} devices.`;
	if (length(filter(others, (o) => same(o.name, g.name)))) return `There is already a group called ${g.name}.`;
	return null;
}

function list() {
	return { groups: store.readGroups(store.open()) };
}

function create(args) {
	return mutate((c) => {
		const groups = store.readGroups(c);
		if (length(groups) >= store.LIMITS.groups) return fail(`You can have up to ${store.LIMITS.groups} groups.`);
		const members = store.checkMacs(args.members ?? []);
		if (members.error) return members;
		const g = { id: store.newId(c, 'zeeli_g_'), name: trim(args.name ?? ''), kind: args.kind ?? 'devices', members: members.macs };
		if (!g.id) return fail('The router couldn’t make an id for the group. Try again.');
		const bad = problem(g, groups);
		if (bad) return fail(bad);
		store.writeGroup(c, g);
		return { group: g };
	});
}

function update(args) {
	return mutate((c) => {
		const old = find(c, args.id);
		if (!old) return fail('That group doesn’t exist.');
		const g = { ...old };
		if (args.name != null) g.name = trim(args.name);
		if (args.kind != null) g.kind = args.kind;
		if (args.members != null) {
			const members = store.checkMacs(args.members);
			if (members.error) return members;
			g.members = members.macs;
		}
		const bad = problem(g, filter(store.readGroups(c), (o) => o.id != g.id));
		if (bad) return fail(bad);
		store.writeGroup(c, g);
		return { group: g };
	});
}

/** Add or remove devices. Adding something already in the group, or removing something that isn't, is fine. */
function setMembers(args, adding) {
	return mutate((c) => {
		const g = find(c, args.id);
		if (!g) return fail('That group doesn’t exist.');
		const macs = store.checkMacs(args.macs);
		if (macs.error) return macs;
		g.members = adding ? uniq([...g.members, ...macs.macs]) : filter(g.members, (m) => index(macs.macs, m) < 0);
		if (length(g.members) > store.LIMITS.members) return fail(`A group can hold up to ${store.LIMITS.members} devices.`);
		store.writeGroup(c, g);
		return { group: g };
	});
}

/**
 * Delete a group and take it out of every policy. A policy left with nobody in it is switched
 * off, so it shows as off rather than silently doing nothing.
 */
function remove(args) {
	return mutate((c) => {
		if (!find(c, args.id)) return fail('That group doesn’t exist.');
		let affected = 0;
		for (let p in store.readPolicies(c)) {
			const who = filter(p.who, (w) => !(w.type == 'group' && w.id == args.id));
			if (length(who) == length(p.who)) continue;
			store.writePolicy(c, { ...p, who, enabled: p.enabled && length(who) > 0 });
			affected++;
		}
		store.removeGroup(c, args.id);
		return { affected };
	});
}

// this ucode needs exports listed rather than marked inline
export { list, create, update, remove, setMembers };
