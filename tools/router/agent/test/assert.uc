// A tiny test runner for agent tests: `test(name, fn)` and `eq(actual, expected)`.
'use strict';

let failed = 0;

function eq(actual, expected, what) {
	const a = sprintf('%J', actual), e = sprintf('%J', expected);
	if (a != e) die(`${what ?? 'value'}: expected ${e}, got ${a}`);
}

function ok(value, what) {
	if (!value) die(`${what ?? 'value'} is not true`);
}

function test(name, fn) {
	try {
		fn();
		print(`ok   ${name}\n`);
	} catch (e) {
		failed++;
		print(`FAIL ${name}: ${e.message}\n`);
	}
}

/** Load an rpcd plugin file and return its object, e.g. plugin('system')['zeeli.system']. */
function plugin(area) {
	return loadfile(`${getenv('ZEELI_AGENT')}/rpcd/zeeli-${area}.uc`)();
}

function done() {
	exit(failed ? 1 : 0);
}

// this ucode needs exports listed rather than marked inline
export { eq, ok, test, plugin, done };
