// Helpers every agent area shares. Installed as /usr/share/ucode/zeeli/common.uc and
// imported with `import { … } from 'zeeli.common';`.
'use strict';

import { cursor as uci_cursor } from 'uci';
import { popen, readfile } from 'fs';

/** Where the agent keeps its own settings and version. Tests point these at a sandbox. */
const paths = {
	confdir: getenv('ZEELI_CONFDIR') ?? null,
	savedir: getenv('ZEELI_SAVEDIR') ?? null,
	share: getenv('ZEELI_SHARE') ?? '/usr/share/zeeli',
	/** Runtime state that doesn't belong in UCI (history, caches). Tests use a sandbox. */
	state: getenv('ZEELI_STATE') ?? '/var/lib/zeeli',
};

/** A UCI cursor on the router's settings, or on the test sandbox. */
function cursor() {
	return paths.confdir ? uci_cursor(paths.confdir, paths.savedir) : uci_cursor();
}

/** A failed call: the console shows `message` to the person as written. */
function fail(message) {
	return { error: message };
}

/** Quote one argument for /bin/sh. */
function shellquote(s) {
	return `'${replace(`${s}`, "'", "'\\''")}'`;
}

/** Run a command (an array of words, never a string) and return { code, stdout }. */
function run(argv) {
	const p = popen(join(' ', map(argv, shellquote)) + ' 2>&1', 'r');
	if (!p) return { code: -1, stdout: '' };
	const stdout = p.read('all') ?? '';
	const code = p.close();
	return { code, stdout };
}

/** Services the agent reloads after a change; tests replace this to record calls instead. */
const services = {
	reload: function(name) {
		if (!match(name, /^[a-z0-9_-]+$/)) return;
		if (paths.confdir) return;
		run([`/etc/init.d/${name}`, 'reload']);
	},
};

/** The agent's version, from the package it was installed from. */
function version() {
	return trim(readfile(`${paths.share}/VERSION`) ?? 'unknown');
}

/** Validators for arguments that come from the console. */
const valid = {
	name: (s) => type(s) == 'string' && match(s, /^[a-z][a-z0-9_]*$/) != null,
	tag: (s) => type(s) == 'string' && match(s, /^v[0-9]+\.[0-9]+\.[0-9]+$/) != null,
	mac: (s) => type(s) == 'string' && match(s, /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/) != null,
};

/**
 * Wrap an rpcd plugin's objects so every reply travels as one JSON string. GL's /rpc reaches
 * the agent through gl-ngx-session's ubus proxy, which re-encodes replies with Lua's cjson: a
 * list holding a null (a chart's empty minute) becomes a sparse table, cjson throws, and the
 * whole session service restarts, signing everyone out. A string passes through untouched.
 * Failures stay a plain { error } so the bridge can report them.
 */
function serve(objects) {
	for (let name in keys(objects))
		for (let method in keys(objects[name])) {
			const m = objects[name][method];
			const inner = m.call;
			m.call = function(request) {
				const r = inner(request);
				if (type(r) == 'object' && type(r.error) == 'string') return { error: r.error };
				return { json: sprintf('%J', r ?? {}) };
			};
		}
	return objects;
}

// this ucode needs exports listed rather than marked inline
export { serve, paths, cursor, fail, shellquote, run, services, version, valid };
