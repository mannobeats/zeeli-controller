// Confirm or roll back: the safety net for a change that could cut the console off.
//
//   const arm = begin('firewall', ['firewall'], 'changing a firewall rule');   // snapshot + timer
//   …write and reload…
//   return { ...result, token: arm.token, seconds: arm.seconds };
//
// The console then calls confirm(token) within `seconds`. A timer the agent starts as a separate
// process (bin/zeeli-rollback-timer) restores the snapshot if no confirm arrives, so a change
// that makes the router unreachable undoes itself without anyone being there to click.
// confirm() and the timer race on one atomic rename, so exactly one of them wins.
'use strict';

import { lsdir, open, readfile, rename, stat, unlink } from 'fs';
import { fail, paths, run } from 'zeeli.common';
import { create, restore } from 'zeeli.snapshots';

/** How long the console has to confirm, in seconds. */
const WINDOW = 30;
const TOKEN = /^[0-9a-f]{16}$/;

/** Tests replace `start` to keep the real timer out of the sandbox. */
const timer = {
	start: function(token, seconds) {
		if (paths.confdir) return;
		run(['/usr/libexec/zeeli/zeeli-rollback-timer', token, `${seconds}`]);
	},
};

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

/** The change that is waiting for a confirm, if any. */
function pending() {
	for (let n in lsdir(dir()) ?? []) {
		const m = match(n, /^([0-9a-f]{16})\.pending$/);
		if (m) return { token: m[1], ...(read(`${dir()}/${n}`) ?? {}) };
	}
	return null;
}

/** What happened to a change the console didn’t confirm. */
function outcome(t) {
	const done = read(`${dir()}/${t}.done`);
	if (done?.state) return done;
	return { state: 'unknown', message: 'The router has no record of that change.' };
}

/**
 * Put the snapshot back, unless the change was confirmed first. The timer calls this when its
 * time is up, and “Undo” calls it straight away.
 */
function expire(t) {
	if (type(t) != 'string' || !match(t, TOKEN)) return fail('That isn’t a change token.');
	const p = `${dir()}/${t}.pending`;
	if (!rename(p, `${p}.running`)) return outcome(t);
	const info = read(`${p}.running`);
	const r = restore(info?.snapshot, info?.configs);
	const done = r.error
		? { state: 'failed', message: `The router couldn’t undo the change automatically: ${r.error}` }
		: { state: 'rolledBack', message: `The router undid ${info?.what ?? 'the change'} because it wasn’t confirmed in time.` };
	write(`${dir()}/${t}.done`, done);
	unlink(`${p}.running`);
	if (!paths.confdir) run(['logger', '-t', 'zeeli', done.message]);
	return done;
}

/**
 * Take the snapshot of `configs` and start the countdown. Call it after checking the request
 * and before writing anything. Returns { token, seconds, expires, snapshot } or { error }.
 */
function begin(area, configs, what) {
	run(['mkdir', '-p', dir()]);
	sweep();
	const waiting = pending();
	// a timer that never ran (killed with the router’s services) is finished off now
	if (waiting && waiting.expires <= time()) expire(waiting.token);
	else if (waiting) return fail('A change is still waiting to be confirmed. Confirm or undo it first.');

	const snap = create(`Before ${what}`, configs);
	if (snap.error) return snap;
	const t = token();
	const expires = time() + WINDOW;
	write(`${dir()}/${t}.pending`, { area, configs, what, snapshot: snap.id, expires });
	timer.start(t, WINDOW);
	return { token: t, seconds: WINDOW, expires, snapshot: snap.id };
}

/** Drop a countdown whose write failed, without touching the settings. */
function discard(t) {
	if (type(t) == 'string' && match(t, TOKEN)) unlink(`${dir()}/${t}.pending`);
}

/**
 * The console reached the router after the change, so keep it. Returns
 * { state: 'confirmed' | 'rolledBack' | 'failed' | 'unknown', message }.
 */
function confirm(t) {
	if (type(t) != 'string' || !match(t, TOKEN)) return fail('That isn’t a change token.');
	if (unlink(`${dir()}/${t}.pending`)) {
		write(`${dir()}/${t}.done`, { state: 'confirmed', message: 'Change kept.' });
		return { state: 'confirmed', message: 'Change kept.' };
	}
	return outcome(t);
}

/** Where a change stands: waiting, kept, undone, or unknown. */
function status(t) {
	if (type(t) != 'string' || !match(t, TOKEN)) return fail('That isn’t a change token.');
	const p = read(`${dir()}/${t}.pending`);
	return p ? { state: 'pending', seconds: p.expires > time() ? p.expires - time() : 0 } : outcome(t);
}

// this ucode needs exports listed rather than marked inline
export { WINDOW, timer, begin, discard, confirm, status, expire };
