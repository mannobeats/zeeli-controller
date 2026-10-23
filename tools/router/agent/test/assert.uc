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
	const objects = loadfile(`${getenv('ZEELI_AGENT')}/rpcd/zeeli-${area}.uc`)();
	// replies travel as a JSON string (see serve in zeeli.common); tests read the value inside
	for (let name in keys(objects))
		for (let method in keys(objects[name])) {
			const m = objects[name][method];
			const wire = m.call;
			m.call = function(request) {
				const r = wire(request);
				return type(r?.json) == 'string' ? json(r.json) : r;
			};
		}
	return objects;
}

function done() {
	exit(failed ? 1 : 0);
}

// this ucode needs exports listed rather than marked inline
export { eq, ok, test, plugin, done };
