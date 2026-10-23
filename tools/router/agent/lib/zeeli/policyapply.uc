// zeeli.policyapply: put the policies on the router, and keep them true as time passes.
//
// `reconcile` is the one entry point. It compiles the policies for this moment, then
//   1. checks the result with `nft -c`; if the firewall would refuse it, nothing changes
//   2. writes the fw4 include (and the UCI `include` section that points at it)
//   3. reloads the firewall when the file's structure changed, or swaps the rules of the
//      policy chains on the running firewall when only a schedule or an expiry changed
//   4. hands the domains of "sites" policies to dnsmasq
//   5. sets per-device speed limits through the firmware's own gl_eqos
//   6. ends the connections of devices that just became blocked or got a new route
//   7. keeps the ip rules and routing tables of "route through" policies that use an uplink
// Writes from the console call it straight away; `tick` calls it every 30 seconds so
// schedules and pauses start and end on time with the console closed.
'use strict';

import { mkdir, readfile, rename, rmdir, stat, unlink, writefile } from 'fs';
import { fail, paths, run } from 'zeeli.common';
import * as nft from 'zeeli.nftpolicy';
import * as store from 'zeeli.store';

const INCLUDE_SECTION = 'zeeli_policies';
const APPLIED_SECTION = 'zeeli_applied';
const TICK_SECONDS = 30;
/** After the firewall fails to take a file, wait this long before trying the same file again. */
const RETRY_SECONDS = 600;
/** How long a domain's addresses are trusted before they are looked up again, and the most looked up at once. */
const POKE_REFRESH = 600;
const POKE_MAX = 24;
const POKE_BUDGET_SECONDS = 20;
/** gl_eqos takes KiB/s; people think in Mbps. */
const KIB_PER_MBPS = 1e6 / 8 / 1024;

const sandboxed = () => paths.confdir != null;

/**
 * Who has which address, from /proc/net/arp (IPv4; flags 0x0 means no answer yet) and
 * `ip -6 neigh show`. Keys are lower-case MACs.
 */
function parseNeighbours(arp, neigh6) {
	const found = {};
	const add = (mac, ip) => {
		found[lc(mac)] ??= [];
		push(found[lc(mac)], ip);
	};
	for (let line in split(arp, '\n')) {
		const m = match(line, /^([0-9.]+) +0x[0-9a-f]+ +0x[2-7] +([0-9a-fA-F:]{17})/);
		if (m) add(m[2], m[1]);
	}
	for (let line in split(neigh6, '\n')) {
		const m = match(line, /^([0-9a-f:]+) dev [^ ]+ lladdr ([0-9a-fA-F:]{17})/);
		if (m) add(m[2], m[1]);
	}
	return found;
}

/** zone name -> devices, from the text of fw4's state file. */
function parseZoneDevices(text) {
	const devs = {};
	let state = null;
	try {
		state = json(text);
	} catch (e) {
		return devs;
	}
	for (let z in state?.zones ?? []) devs[z.name] = z.match_devices ?? [];
	return devs;
}

const includePath = () => (sandboxed() ? `${paths.state}/include/policies.nft` : '/etc/zeeli/policies.nft');

/**
 * What a command answers in the test sandbox unless a test says otherwise: it works, and the
 * live ruleset holds whatever file is on disk, as if fw4 had loaded it.
 */
function sandboxAnswer(argv) {
	if (argv[0] == 'nft' && argv[1] == 'list' && argv[5] == 'zeeli_rev') {
		const rev = nft.revisionIn(readfile(includePath()));
		return rev ? { code: 0, stdout: `chain zeeli_rev {\n\t\tcounter comment "zeeli-rev:${rev}"\n\t}\n` } : { code: 1, stdout: 'No such file or directory' };
	}
	return { code: 0, stdout: '' };
}

/**
 * Everything the agent does to the outside world goes through here, so tests can see it and
 * answer for it. In the test sandbox nothing runs: calls are recorded in `sys.calls`.
 */
const sys = {
	calls: [],
	/** Test hook: what a recorded command answers. */
	answer: sandboxAnswer,
	run: function(argv) {
		if (!sandboxed()) return run(argv);
		push(this.calls, argv);
		return this.answer(argv);
	},
	/** Reload a service and return its exit code. */
	reload: function(name) {
		if (!match(name, /^[a-z0-9_-]+$/)) return 1;
		if (sandboxed()) {
			push(this.calls, ['reload', name]);
			return this.answer(['reload', name]).code;
		}
		return run([`/etc/init.d/${name}`, 'reload']).code;
	},
	lockTries: 300,
	now: () => time(),
	/** The router's wall clock; ucode's localtime knows the time zone and daylight saving. Tests use gmtime. */
	breakdown: localtime,
	/** zone name -> devices, from the firewall's own state file (empty when the firewall hasn't run). */
	zoneDevices: function() {
		return sandboxed() ? {} : parseZoneDevices(readfile('/var/run/fw4.state') ?? '');
	},
	/** MAC (lower case) -> IP addresses the router knows for it. */
	neighbours: function() {
		if (sandboxed()) return {};
		return parseNeighbours(readfile('/proc/net/arp') ?? '', run(['ip', '-6', 'neigh', 'show']).stdout);
	},
};

/* ---------- files ---------- */

const statePath = () => `${paths.state}/policies.json`;

function ensureDir(path) {
	const dir = replace(path, /\/[^\/]*$/, '');
	mkdir(dir);
}

/** Write a file so a reader sees the old content or the new, never half of it. */
function writeAtomic(path, data) {
	ensureDir(path);
	const tmp = `${path}.new`;
	if (writefile(tmp, data) == null) return false;
	return rename(tmp, path);
}

function readState() {
	return json(readfile(statePath()) ?? 'null') ?? { blocked: [] };
}

function saveState(state) {
	const text = sprintf('%J', state);
	if (readfile(statePath()) != text) writeAtomic(statePath(), text);
}

const ownPid = () => match(readfile('/proc/self/stat') ?? '', /^([0-9]+) /)?.[1] ?? '0';

/**
 * Only one reconcile at a time: the console's writes and the 30-second tick share a lock. ucode
 * has no flock, so the lock is a directory (mkdir is atomic) holding its owner's pid; a lock whose
 * owner is gone is taken over at once, and one whose owner is alive is never broken, however long
 * it is held. Nothing slow runs while it is held, so waiting is short.
 */
function locked(fn) {
	const dir = `${paths.state}/policies.lock`, pid = `${dir}/pid`;
	ensureDir(dir);
	let held = false;
	for (let tries = 0; tries < sys.lockTries && !held; tries++) {
		if (mkdir(dir)) {
			writefile(pid, ownPid());
			held = true;
			break;
		}
		const owner = trim(readfile(pid) ?? '');
		// no pid yet: its owner is between mkdir and writing it, so give it a few seconds
		const gone = owner == '' ? time() - (stat(dir)?.mtime ?? 0) > 5 : !stat(`/proc/${owner}`);
		if (gone) {
			unlink(pid);
			rmdir(dir);
		} else sleep(100);
	}
	if (!held) return fail('The router is busy applying another change. Try again in a moment.');
	let result;
	try {
		result = fn();
	} catch (e) {
		unlink(pid);
		rmdir(dir);
		die(e.message);
	}
	unlink(pid);
	rmdir(dir);
	return result;
}

/* ---------- route targets: GL's VPN tunnels and the internet uplinks ---------- */

const UPLINK_NAMES = { wan: 'Ethernet 1', secondwan: 'Ethernet 2', wwan: 'Repeater', tethering: 'Tethering' };
const uplinkLabel = (name) => UPLINK_NAMES[name] ?? (match(name, /^modem/) ? 'Cellular' : name);

/** GL marks the traffic of VPN instance wgclient<n> 0x<n>000 and ovpnclient<n> 0x<9+n>000 (route_policy_func.sh). */
function vpnMark(via) {
	const m = match(via, /^(wgclient|ovpnclient)([1-5])$/);
	return m ? (m[1] == 'wgclient' ? 0 : 0x9000) + int(m[2], 10) * 0x1000 : null;
}

/**
 * What a route policy can send traffic through, from the router's settings alone: GL's VPN
 * tunnels (the `rule` sections of route_policy that name a VPN instance in `via`) and the uplinks
 * kmwan manages. A tunnel is named by its GL tunnel id, so deleting and re-adding tunnels in GL
 * can't point a policy at another one.
 */
function targetConfig(c) {
	const found = [];
	c.foreach('route_policy', 'rule', (s) => {
		const mark = vpnMark(s.via ?? '');
		const id = `vpn:${s.tunnel_id}`;
		if (mark == null || !store.isRouteTarget(id) || length(filter(found, (t) => t.id == id))) return;
		const name = substr(trim(s.name ?? ''), 0, 40) || 'VPN tunnel';
		push(found, { id, kind: 'vpn', name, label: `${name} (${match(s.via, /^wg/) ? 'WireGuard' : 'OpenVPN'})`, iface: s.via, mark, enabled: s.enabled != '0' });
	});
	c.foreach('kmwan', 'member', (s) => {
		const id = `uplink:${s.interface}`;
		if (!store.isRouteTarget(id) || s.disabled == '1' || (s.addr_type ?? '4') != '4') return;
		push(found, { id, kind: 'uplink', name: uplinkLabel(s.interface), label: uplinkLabel(s.interface), iface: s.interface, mark: 0, enabled: true });
	});
	return found;
}

function interfaceStatus(name) {
	const r = sys.run(['ubus', 'call', `network.interface.${name}`, 'status']);
	if (r.code != 0) return null;
	try {
		return json(r.stdout);
	} catch (e) {
		return null;
	}
}

const isDevice = (v) => type(v) == 'string' && match(v, /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/) != null;
const isAddress = (v) => type(v) == 'string' && match(v, /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/) != null;

/** The IPv4 default route's gateway in netifd's interface status, or null. */
function gatewayOf(status) {
	for (let r in status?.route ?? []) if (r.target == '0.0.0.0' && r.mask == 0 && isAddress(r.nexthop) && r.nexthop != '0.0.0.0') return r.nexthop;
	return null;
}

/**
 * The targets in `only` (all of them when it is null) with their state: whether the interface is
 * up, its device and gateway. Asks netifd about each one, so ask only about what is needed.
 */
function resolveTargets(c, only) {
	const found = {};
	for (let t in targetConfig(c)) {
		if (only && index(only, t.id) < 0) continue;
		const st = t.enabled ? interfaceStatus(t.iface) : null;
		const dev = st?.l3_device ?? (t.kind == 'vpn' ? t.iface : null);
		found[t.id] = { kind: t.kind, name: t.name, label: t.label, up: st?.up == true, dev: isDevice(dev) ? dev : null, gw: gatewayOf(st), mark: t.mark };
	}
	return found;
}

/* ---------- input ---------- */

/** Zones that count as "the internet": those that masquerade, except the overlay networks. */
function internetZones(c) {
	const names = [];
	c.foreach('firewall', 'zone', (z) => {
		if (z.masq == '1' && store.isZoneName(z.name) && !match(z.name, /^(tailscale|zerotier)/)) push(names, z.name);
	});
	return names;
}

/** The firewall's zones with their devices; a zone fw4 hasn't resolved (or that is off) gets none and so matches nothing. */
function zoneMap(c) {
	const known = sys.zoneDevices();
	const zones = {};
	for (let name in store.zoneNames(c)) zones[name] = known[name] ?? [];
	return zones;
}

function gather(c) {
	const policies = store.readPolicies(c);
	const wanted = map(filter(policies, (p) => p.action.kind == 'route'), (p) => p.action.target);
	return {
		groups: store.readGroups(c),
		policies,
		zones: zoneMap(c),
		internet: internetZones(c),
		now: nft.clock(sys.now(), sys.breakdown),
		targets: resolveTargets(c, wanted),
		ipv6: c.get('glipv6', 'globals', 'enabled') == '1',
	};
}

/* ---------- the firewall ---------- */

function ensureInclude(c) {
	if (c.get('firewall', INCLUDE_SECTION) == 'include' && c.get('firewall', INCLUDE_SECTION, 'path') == includePath()) return;
	c.set('firewall', INCLUDE_SECTION, 'include');
	c.set('firewall', INCLUDE_SECTION, 'zeeli', '1');
	c.set('firewall', INCLUDE_SECTION, 'enabled', '1');
	c.set('firewall', INCLUDE_SECTION, 'type', 'nftables');
	c.set('firewall', INCLUDE_SECTION, 'path', includePath());
	c.set('firewall', INCLUDE_SECTION, 'position', 'table-prepend');
	c.commit('firewall');
}

const firstLine = (text) => trim(split(trim(text), '\n')[0] ?? '');

/** Ask `nft -c` whether the firewall would take the file. Returns null when it would, else nft's complaint. */
function refused(text) {
	const file = `${paths.state}/policies.check.nft`;
	writeAtomic(file, nft.checkable(text));
	const r = sys.run(['nft', '-c', '-f', file]);
	unlink(file);
	return r.code == 0 ? null : firstLine(r.stdout) || 'it gave no reason';
}

/** The revision of the file fw4 actually loaded, read back from the live ruleset (null if our chains aren't there). */
const liveRevision = () => nft.revisionIn(sys.run(['nft', 'list', 'chain', 'inet', 'fw4', 'zeeli_rev']).stdout);

/**
 * fw4 reloads flush its table but keep chains and sets the new file no longer declares, so a
 * policy that went leaves an empty chain and its sets behind. Delete what we own and don't use.
 */
function removeOrphans(result) {
	const own = nft.ownedNames(result);
	const chains = [], sets = [];
	for (let line in split(sys.run(['nft', '-t', 'list', 'table', 'inet', 'fw4']).stdout, '\n')) {
		const chain = match(line, /^\tchain (zeeli_[a-z0-9_]+) \{/), set = match(line, /^\tset (zeeli_[a-z0-9_]+) \{/);
		if (chain && index(own.chains, chain[1]) < 0) push(chains, chain[1]);
		if (set && index(own.sets, set[1]) < 0) push(sets, set[1]);
	}
	if (!length(chains) && !length(sets)) return;
	const file = `${paths.state}/policies.orphans.nft`;
	writeAtomic(file, join('', [...map(chains, (n) => `delete chain inet fw4 ${n}\n`), ...map(sets, (n) => `delete set inet fw4 ${n}\n`)]));
	sys.run(['nft', '-f', file]);
	unlink(file);
}

/** Reload the firewall and say whether it came back with `rev` loaded. */
const reloadedWith = (rev) => (sys.reload('firewall') ?? 0) == 0 && liveRevision() == rev;

/** Does the file declare any policy chains of ours, or can the firewall do without it? */
const hasChains = (result) => length(result.chains) + length(result.routes) > 0;

/**
 * Make the firewall match `text`. Returns 'none', 'live' or 'reload', or { error }. Success is
 * read back from the live ruleset (the file's revision), not assumed from an exit code. If a
 * reload doesn't bring the new file up, the previous file goes back, and the same file isn't
 * tried again for ten minutes, so a file that can't load never becomes a reload loop.
 */
function applyFirewall(c, result, text, state) {
	const path = includePath();
	const old = readfile(path);
	const rev = nft.revisionIn(text);
	const loaded = old != null && liveRevision() == nft.revisionIn(old);
	if (text == old && (loaded || !hasChains(result))) return 'none';
	if (old == null && !hasChains(result)) return 'none';
	if (state.failed?.text == text && sys.now() - state.failed.at < RETRY_SECONDS)
		return fail('The firewall didn’t take these policies a moment ago, so the router is waiting before it tries again.');

	const why = refused(text);
	if (why) return fail(`The firewall wouldn’t take these policies (${why}), so nothing was changed.`);

	if (!writeAtomic(path, text)) return fail('The router couldn’t save the policies’ firewall file.');
	ensureInclude(c);

	if (loaded && nft.structureOf(old) == nft.structureOf(text)) {
		const file = `${paths.state}/policies.live.nft`;
		writeAtomic(file, nft.liveCommands(result));
		const r = sys.run(['nft', '-f', file]);
		unlink(file);
		if (r.code == 0 && liveRevision() == rev) return 'live';
	}
	if (reloadedWith(rev)) {
		removeOrphans(result);
		return 'reload';
	}

	// the reload didn't bring the new file up: put back what worked, so a bad file can't leave the firewall without it
	state.failed = { text, at: sys.now() };
	if (old != null) writeAtomic(path, old);
	else unlink(path);
	sys.reload('firewall');
	return fail('The firewall didn’t load the policies, so they were rolled back. Check the system log for what it said.');
}

/* ---------- sites, through dnsmasq ---------- */

/** dnsmasq's own `ipset` sections, one per family and policy, listing the domains whose answers fill the sets. */
function syncSites(c, result) {
	const want = {};
	for (let id in keys(result.sites))
		for (let fam in ['4', '6'])
			want[`zeeli_site${fam}_${id}`] = { family: fam, set: `zeeli_s${fam}_${id}`, domains: result.sites[id] };

	const have = {};
	c.foreach('dhcp', 'ipset', (s) => {
		if (s.zeeli == '1') have[s['.name']] = s;
	});

	let changed = false;
	for (let name in keys(have)) {
		const w = want[name], s = have[name];
		if (w && sprintf('%J', [w.family, [w.set], w.domains]) == sprintf('%J', [s.family, s.name, s.domain])) continue;
		c.delete('dhcp', name);
		changed = true;
	}
	for (let name in keys(want)) {
		const w = want[name], s = have[name];
		if (s && sprintf('%J', [w.family, [w.set], w.domains]) == sprintf('%J', [s.family, s.name, s.domain])) continue;
		c.set('dhcp', name, 'ipset');
		c.set('dhcp', name, 'zeeli', '1');
		c.set('dhcp', name, 'family', w.family);
		c.set('dhcp', name, 'name', [w.set]);
		c.set('dhcp', name, 'domain', w.domains);
		changed = true;
	}
	if (!changed) return;
	c.commit('dhcp');
	sys.reload('dnsmasq');
}

/**
 * The domains to look up now: those of policies that apply and haven't been looked up in ten
 * minutes (or since the firewall was reloaded, which empties the sets). At most 24 at a time; the
 * rest stay due for the next pass. Marks them looked up, so it is called inside the lock and the
 * lookups themselves (`pokeSites`) run after it is released.
 */
function dueLookups(result, state, reloaded) {
	const t = sys.now();
	const seen = reloaded ? {} : (state.poked ?? {});
	const next = {}, due = [];
	for (let id in sort(keys(result.sites))) {
		if (index(result.active, id) < 0) continue;
		for (let d in result.sites[id]) {
			const key = `${id}:${d}`;
			if (seen[key] != null && t - seen[key] < POKE_REFRESH) next[key] = seen[key];
			else if (length(due) < POKE_MAX) {
				push(due, d);
				next[key] = t;
			}
		}
	}
	state.poked = next;
	return due;
}

/**
 * Look the domains up through dnsmasq so the sets hold their addresses before the covered
 * devices next ask. Each lookup is limited to 3 seconds and the lot to 20, and it runs outside
 * the lock, so slow DNS can't hold up a change or let two applies overlap.
 */
function pokeSites(domains) {
	const start = sys.now();
	for (let d in domains) {
		if (sys.now() - start > POKE_BUDGET_SECONDS) break;
		sys.run(['timeout', '3', 'nslookup', d, '127.0.0.1']);
	}
}

/* ---------- speed limits, through gl_eqos ---------- */

// gl_eqos is given upper-case MACs, as the console gives them to the firmware's own limit call. A
// direction given as 0 gets no class at all in gl_eqos (`[ $dl -gt 0 ]`), so 0 means "no limit" there.
const kib = (mbps) => (mbps > 0 ? max(1, int(mbps * KIB_PER_MBPS + 0.5)) : 0);

function readApplied(c) {
	const have = {};
	for (let entry in c.get('zeeli', APPLIED_SECTION, 'limit') ?? []) {
		const m = match(entry, /^([0-9a-f:]{17})=([0-9]+)=([0-9]+)$/);
		if (m) have[m[1]] = { down: int(m[2], 10), up: int(m[3], 10) };
	}
	return have;
}

function writeApplied(c, have) {
	c.delete('zeeli', APPLIED_SECTION);
	if (!length(keys(have))) return;
	c.set('zeeli', APPLIED_SECTION, 'applied');
	c.set('zeeli', APPLIED_SECTION, 'zeeli', '1');
	c.set('zeeli', APPLIED_SECTION, 'limit', map(sort(keys(have)), (mac) => `${mac}=${have[mac].down}=${have[mac].up}`));
}

/** Does the firmware already limit this device (a limit someone set by hand)? It names the queue after the MAC without colons, in whatever case the console sent. */
const limitedByHand = (c, mac) => c.get('qos', replace(lc(mac), ':', '')) == 'queue' || c.get('qos', replace(uc(mac), ':', '')) == 'queue';

/**
 * Make the firmware's per-device limits match the active limit policies. Only limits this
 * agent set are ever changed or removed. Returns warnings.
 */
function syncLimits(c, result) {
	const warnings = [];
	const have = readApplied(c);
	const want = {};
	for (let l in result.limits) want[l.mac] = { down: kib(l.down), up: kib(l.up) };

	let touched = false;
	for (let mac in keys(have)) {
		const w = want[mac];
		if (w && w.down == have[mac].down && w.up == have[mac].up) continue;
		sys.run(['/usr/bin/gl_eqos', 'del', uc(mac)]);
		delete have[mac];
		touched = true;
	}
	for (let mac in keys(want)) {
		if (have[mac]) continue;
		if (limitedByHand(c, mac)) {
			push(warnings, `${uc(mac)} already has a speed limit set on its own, so the policy leaves it alone.`);
			continue;
		}
		// gl_eqos adds classes to a base queue it only builds when QoS starts
		if (!length(trim(sys.run(['tc', 'class', 'show', 'dev', 'br-lan']).stdout))) {
			// this is what the firmware does for any per-device limit: it caps each bridge at 2.5 Gbit, sends every
			// packet through an ifb queue, and restarts bridger once. Say so, since it can lower top speed.
			sys.run(['/usr/bin/gl_eqos', 'start', '312500', '312500']);
			push(warnings, 'Speed limits turned on the router’s traffic shaping, which sends all traffic through a software queue and can lower top speed on very fast links.');
		}
		sys.run(['/usr/bin/gl_eqos', 'add', uc(mac), `${want[mac].down}`, `${want[mac].up}`]);
		have[mac] = want[mac];
		touched = true;
	}
	if (touched) writeApplied(c, have);
	return warnings;
}

/* ---------- ending connections ---------- */

/**
 * A block only stops new packets at the firewall; connections that hardware acceleration
 * already handles never reach it. Deleting a device's conntrack entries makes the
 * acceleration engine (ECM) drop its flows too, so a block takes effect at once.
 */
function endConnections(macs) {
	const known = sys.neighbours();
	for (let mac in macs)
		for (let ip in known[mac] ?? []) {
			const family = index(ip, ':') >= 0 ? ['-f', 'ipv6'] : [];
			sys.run(['conntrack', '-D', ...family, '-s', ip]);
			sys.run(['conntrack', '-D', ...family, '-r', ip]);
		}
}

/* ---------- routing through an uplink: ip rules and tables ---------- */

// Slot n (1 to 15, see zeeli.nftpolicy) gets table 7700+n and two ip rules for its mark: one at
// preference 5800+n that lets the routes the main table has for a destination other than "anywhere"
// win (so the LAN, other networks and the uplinks' own subnets stay reachable), and one at 5820+n
// that sends the rest to the slot's table. Both sit between Tailscale's rules (5210 to 5270) and GL's
// VPN rules (6000). If the table has no route (the uplink is down) the lookup finds nothing and the
// packet falls through to the main table; the drop rule in the firewall file handles "block".
const SUPPRESS_PREF = 5800;
const LOOKUP_PREF = 5820;
const SLOT_MASK = '0x0f000000';

const markHex = (n) => sprintf('0x%08x', n);

function wantedRules(uplinks) {
	const rules = [];
	for (let u in uplinks) {
		push(rules, { pref: SUPPRESS_PREF + u.slot, mark: u.mark, table: 'main', suppress: true });
		push(rules, { pref: LOOKUP_PREF + u.slot, mark: u.mark, table: `${u.table}`, suppress: false });
	}
	return rules;
}

const ruleKey = (r) => `${r.pref} ${r.mark} ${r.table} ${r.suppress ? 's' : ''}`;

/** Our ip rules as the kernel has them, from `ip -4 rule show`. */
function currentRules() {
	const found = [];
	for (let line in split(sys.run(['ip', '-4', 'rule', 'show']).stdout, '\n')) {
		const m = match(line, /^(58[0-3][0-9]):\s+from all fwmark 0x([0-9a-f]+)\/0xf000000 lookup (\S+)( suppress_prefixlength 0)?/);
		if (m) push(found, { pref: int(m[1], 10), mark: int(m[2], 16), table: m[3], suppress: m[4] != null });
	}
	return found;
}

/**
 * Make the kernel's rules and the slots' tables match `result.uplinks`. Idempotent, so every
 * pass can run it: that is also how the tables come back after the uplink's gateway changes or
 * GL reloads the network. Returns warnings.
 */
function syncRoutes(result, state) {
	const warnings = [];
	const want = wantedRules(result.uplinks);
	if (!length(want) && !length(state.rules ?? []) && !length(state.tables ?? [])) return warnings;

	const have = currentRules();
	const wantKeys = map(want, ruleKey), haveKeys = map(have, ruleKey);
	for (let r in have) if (index(wantKeys, ruleKey(r)) < 0) sys.run(['ip', '-4', 'rule', 'del', 'pref', `${r.pref}`]);
	for (let r in want) {
		if (index(haveKeys, ruleKey(r)) >= 0) continue;
		const add = sys.run(['ip', '-4', 'rule', 'add', 'pref', `${r.pref}`, 'fwmark', `${markHex(r.mark)}/${SLOT_MASK}`, 'lookup', r.table, ...(r.suppress ? ['suppress_prefixlength', '0'] : [])]);
		if (add.code != 0) push(warnings, 'The router wouldn’t add a routing rule for a route-through policy.');
	}

	for (let u in result.uplinks) {
		const via = isAddress(u.gw) ? ['via', u.gw] : [];
		const r = sys.run(['ip', '-4', 'route', 'replace', 'default', ...via, 'dev', u.dev, 'table', `${u.table}`]);
		if (r.code != 0) push(warnings, `The router couldn’t route through ${u.target}.`);
	}
	const tables = map(result.uplinks, (u) => u.table);
	for (let t in state.tables ?? []) if (index(tables, t) < 0) sys.run(['ip', '-4', 'route', 'flush', 'table', `${t}`]);
	state.rules = wantKeys;
	state.tables = tables;
	return warnings;
}

/* ---------- the whole job ---------- */

/**
 * Bring the router in line with the policies in `c` (a cursor that may hold changes not yet
 * committed). Returns { applied, warnings, limits, blocked, active } or { error }.
 */
function reconcile(c) {
	const result = nft.compile(gather(c));
	const text = nft.render(result);
	const state = readState();

	const applied = applyFirewall(c, result, text, state);
	if (type(applied) == 'object') {
		saveState(state);
		return applied;
	}
	delete state.failed;
	const routing = syncRoutes(result, state);
	syncSites(c, result);
	const due = dueLookups(result, state, applied == 'reload');
	const warnings = [...result.warnings, ...routing, ...syncLimits(c, result)];

	const fresh = filter(result.blocked, (mac) => index(state.blocked, mac) < 0);
	// a device whose route changed keeps its old connections otherwise, now with the wrong source address
	const was = state.routed ?? {};
	const rerouted = filter(uniq([...keys(was), ...keys(result.routed)]), (mac) => was[mac] != result.routed[mac]);
	if (length(fresh) || length(rerouted)) endConnections(uniq([...fresh, ...rerouted]));
	state.blocked = result.blocked;
	state.routed = result.routed;
	saveState(state);

	return { applied, warnings, limits: result.limits, blocked: result.blocked, active: result.active, due };
}

/**
 * Change groups or policies and apply them in one step: `change` edits the cursor, and the
 * edit is kept only if the router accepted the result. Returns what `change` returned plus
 * `applied` and `warnings`, or { error }.
 */
function mutate(change) {
	let due = [];
	const out = locked(() => {
		const c = store.open();
		const done = change(c);
		if (done?.error) {
			c.revert('zeeli');
			return done;
		}
		const r = reconcile(c);
		if (r.error) {
			c.revert('zeeli');
			c.revert('firewall');
			c.revert('dhcp');
			return r;
		}
		store.commit(c);
		due = r.due;
		return { ...done, applied: r.applied, warnings: r.warnings };
	});
	pokeSites(due);
	return out;
}

/** Remove policies whose time has passed. Returns how many went. */
function dropExpired(c) {
	const now = sys.now();
	let gone = 0;
	for (let p in store.readPolicies(c))
		if (p.until != null && p.until <= now) {
			store.removePolicy(c, p.id);
			gone++;
		}
	return gone;
}

/**
 * One pass of the 30-second loop. An expired policy stops applying at once (its chain is
 * emptied on the running firewall); only then is it deleted, which tidies the firewall file
 * and reloads it.
 */
function tick() {
	let due = [];
	const r = locked(() => {
		const c = store.open();
		let r = reconcile(c);
		due = r.due ?? [];
		if (!r.error && dropExpired(c)) {
			r = reconcile(c);
			due = [...due, ...(r.due ?? [])];
		}
		if (r.error) c.revert('zeeli');
		else store.commit(c);
		return r;
	});
	pokeSites(due);
	return r;
}

/** The loop the `zeeli-policies` service runs. */
function serve() {
	let said = null;
	while (true) {
		let trouble = null;
		try {
			trouble = tick().error;
		} catch (e) {
			trouble = e.message;
		}
		// each problem once, not every 30 seconds
		if (trouble && trouble != said) warn(`zeeli-policies: ${trouble}\n`);
		said = trouble;
		sleep(TICK_SECONDS * 1000);
	}
}

/** What the router is doing about policies, for the status call. */
function status(c) {
	const result = nft.compile(gather(c));
	const old = readfile(includePath());
	return {
		included: c.get('firewall', INCLUDE_SECTION) == 'include',
		file: old != null,
		inSync: old == nft.render(result),
		loaded: old != null && liveRevision() == nft.revisionIn(old),
		active: result.active,
		limits: result.limits,
		appliedLimits: map(keys(readApplied(c)), (m) => uc(m)),
		warnings: result.warnings,
		now: sys.now(),
	};
}

// this ucode needs exports listed rather than marked inline
export { sys, reconcile, mutate, tick, serve, status, includePath, parseNeighbours, parseZoneDevices, sandboxAnswer };
export { targetConfig, resolveTargets };
