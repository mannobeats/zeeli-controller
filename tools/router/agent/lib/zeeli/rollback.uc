// Confirm or roll back: the safety net for a change that could cut the console off.
//
//   const arm = begin('firewall', ['firewall'], 'changing a firewall rule');   // snapshot + timer
//   …write and reload (and check the reload’s exit code)…
//   flush();                                                                   // see below
//   return { ...result, token: arm.token, seconds: arm.seconds, settle: arm.settle };
//
// The console then calls confirm(token) within `seconds`. A timer the agent starts as a separate
// process (bin/zeeli-rollback-timer) restores the snapshot if no confirm arrives, so a change
// that makes the router unreachable undoes itself without anyone being there to click.
// confirm() and the timer race on one atomic rename, so exactly one of them wins.
//
// Three things keep a confirm honest:
//  - The waiting record lives on flash (/overlay/zeeli/rollback), so a power cycle inside the
//    window can’t keep the change: zeeli-rollback (init, before network and firewall) calls
//    recover() at boot and puts the snapshot back.
//  - fw4 lets established connections through before it looks at zone rules, so a confirm sent
//    over the connection that made the change proves nothing. flush() ends the TCP connections
//    to the router’s own web ports a second after the answer has gone out, and the console waits
//    `settle` seconds before it confirms, so the confirm has to pass the new rules.
//  - The snapshot a waiting change needs is never pruned (see snapshots.uc).
'use strict';

import { lsdir, open, readfile, rename, stat, unlink } from 'fs';
import { fail, paths, run } from 'zeeli.common';
import { RISKY, create, pendingdir, plan, restore } from 'zeeli.snapshots';

/** How long the console has to confirm, in seconds. */
const WINDOW = 30;
/** How long the console waits before it first asks: flush() runs at one second. */
const SETTLE = 2;
const TOKEN = /^[0-9a-f]{16}$/;

/** Tests replace `start` to keep the real timer out of the sandbox. */
const timer = {
	start: function(token, seconds) {
		if (paths.confdir) return;
		run(['/usr/libexec/zeeli/zeeli-rollback-timer', token, `${seconds}`]);
	},
};

/** Ends the connections to the router’s web ports a moment later. Tests replace `flush`. */
const admin = {
	flush: function() {
		if (paths.confdir) return;
		run(['/usr/libexec/zeeli/zeeli-flush-admin']);
	},
};

/** Outcomes are kept in RAM: they only matter to a console that is still looking. */
function dir() {
	return `${paths.state}/rollback`;
}

function write(path, value) {
	const f = open(path, 'w');
	f.write(sprintf('%J', value));
	f.close();
}

function read(path) {
	try {
		return json(readfile(path));
	} catch (e) {
		return null;
	}
}

function token() {
	const f = open('/dev/urandom', 'r');
	const t = hexenc(f.read(8));
	f.close();
	return t;
}

/** Forget old outcomes, so the folder stays small. */
function sweep() {
	for (let n in lsdir(dir()) ?? []) {
		const age = time() - (stat(`${dir()}/${n}`)?.mtime ?? 0);
		if (match(n, /\.done$/) && age > 3600) unlink(`${dir()}/${n}`);
	}
}

/** The change that is waiting for a confirm, or being undone right now. */
function pending() {
	for (let n in lsdir(pendingdir()) ?? []) {
		const m = match(n, /^([0-9a-f]{16})\.pending(\.running)?$/);
		if (m) return { token: m[1], running: m[2] != null, ...(read(`${pendingdir()}/${n}`) ?? {}) };
	}
	return null;
}

/** What happened to a change the console didn’t confirm. */
function outcome(t) {
	const done = read(`${dir()}/${t}.done`);
	if (done?.state) return done;
	return { state: 'unknown', message: 'The router has no record of that change.' };
}

/** Put the snapshot back for a record that has been claimed (renamed to .running), then record how it went. */
function undo(t, info, quiet) {
	const r = restore(info?.snapshot, { only: info?.configs, reload: !quiet });
	const bad = r.error ?? (length(r.failed) ? `${join(', ', map(r.failed, (f) => f.service))} wouldn’t reload` : null);
	const done = bad
		? { state: 'failed', message: `The router couldn’t undo the change automatically: ${bad}` }
		: { state: 'rolledBack', message: `The router undid ${info?.what ?? 'the change'} because it wasn’t confirmed in time.` };
	run(['mkdir', '-p', dir()]);
	write(`${dir()}/${t}.done`, done);
	unlink(`${pendingdir()}/${t}.pending.running`);
	if (!paths.confdir) run(['logger', '-t', 'zeeli', done.message]);
	return done;
}

/**
 * Put the snapshot back, unless the change was confirmed first. The timer calls this when its
 * time is up, and “Undo” calls it straight away.
 */
function expire(t) {
	if (type(t) != 'string' || !match(t, TOKEN)) return fail('That isn’t a change token.');
	const p = `${pendingdir()}/${t}.pending`;
	if (!rename(p, `${p}.running`)) return outcome(t);
	return undo(t, read(`${p}.running`), false);
}

/**
 * At boot, before the network and firewall start: a change that was still waiting when the
 * router went down is put back, as its timer would have. Only the files are restored, since
 * the services read them as they start. Returns the tokens undone.
 */
function recover() {
	const undone = [];
	for (let n in lsdir(pendingdir()) ?? []) {
		const m = match(n, /^([0-9a-f]{16})\.pending(\.running)?$/);
		if (!m) continue;
		const p = `${pendingdir()}/${n}`;
		const info = read(p);
		undo(m[1], info, true);
		unlink(p);
		push(undone, m[1]);
	}
	return undone;
}

/**
 * Take the snapshot of `configs` and start the countdown. Call it after checking the request
 * and before writing anything. Returns { token, seconds, settle, expires, snapshot } or { error }.
 */
function begin(area, configs, what) {
	run(['mkdir', '-p', dir(), pendingdir()]);
	sweep();
	const waiting = pending();
	if (waiting?.running && time() - (stat(`${pendingdir()}/${waiting.token}.pending.running`)?.mtime ?? 0) < 300)
		return fail('A change is being undone. Try again in a moment.');
	// a timer that never ran (killed with the router’s services) is finished off now
	if (waiting && waiting.expires <= time()) {
		if (waiting.running) unlink(`${pendingdir()}/${waiting.token}.pending.running`);
		else expire(waiting.token);
	} else if (waiting) return fail('A change is still waiting to be confirmed. Confirm or undo it first.');

	const snap = create(`Before ${what}`, configs, 'auto');
	if (snap.error) return snap;
	const t = token();
	const expires = time() + WINDOW;
	write(`${pendingdir()}/${t}.pending`, { area, configs, what, snapshot: snap.id, expires });
	timer.start(t, WINDOW);
	return { token: t, seconds: WINDOW, settle: SETTLE, expires, snapshot: snap.id };
}

/** Drop a countdown whose write failed, without touching the settings. */
function discard(t) {
	if (type(t) == 'string' && match(t, TOKEN)) unlink(`${pendingdir()}/${t}.pending`);
}

/**
 * The console reached the router after the change, so keep it. Returns
 * { state: 'confirmed' | 'rolledBack' | 'failed' | 'unknown', message }.
 */
function confirm(t) {
	if (type(t) != 'string' || !match(t, TOKEN)) return fail('That isn’t a change token.');
	if (unlink(`${pendingdir()}/${t}.pending`)) {
		run(['mkdir', '-p', dir()]);
		write(`${dir()}/${t}.done`, { state: 'confirmed', message: 'Change kept.' });
		return { state: 'confirmed', message: 'Change kept.' };
	}
	return outcome(t);
}

/** Where a change stands: waiting, kept, undone, or unknown. */
function status(t) {
	if (type(t) != 'string' || !match(t, TOKEN)) return fail('That isn’t a change token.');
	const p = read(`${pendingdir()}/${t}.pending`);
	return p ? { state: 'pending', seconds: p.expires > time() ? p.expires - time() : 0 } : outcome(t);
}

/** The reload failed or the change turned out wrong: undo it now and say why. */
function abandon(arm, why) {
	expire(arm.token);
	return fail(why);
}

/**
 * Restore a snapshot. When it touches settings whose reload can cut the console off (network,
 * wireless, firewall, dropbear) the restore is a confirmable change like any other: the files
 * it will replace are snapshotted, and it is undone unless confirmed. Returns the restore
 * result, with { token, seconds, settle } when it waits for a confirm, or { error }.
 */
function restoreSnapshot(id) {
	const p = plan(id);
	if (p.error) return p;
	if (!length(filter(p.differ, (f) => index(RISKY, f) >= 0))) return restore(id);
	const arm = begin('backup', p.differ, 'restoring a snapshot');
	if (arm.error) return arm;
	const r = restore(id, { undo: false });
	if (r.error) {
		discard(arm.token);
		return r;
	}
	if (length(r.failed)) return abandon(arm, `${join(', ', map(r.failed, (f) => f.service))} didn’t reload cleanly, so the router put the settings back.`);
	admin.flush();
	return { ...r, undo: arm.snapshot, token: arm.token, seconds: arm.seconds, settle: arm.settle };
}

// this ucode needs exports listed rather than marked inline
export { WINDOW, SETTLE, timer, admin, begin, discard, confirm, status, expire, recover, abandon, restoreSnapshot };
