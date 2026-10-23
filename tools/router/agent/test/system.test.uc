'use strict';

import { eq, ok, test, plugin, done } from 'assert';

const system = plugin('system')['zeeli.system'];

test('version reads the installed VERSION file', () => {
	eq(system.version.call({ args: {} }), { version: 'test' });
});

test('update refuses anything that is not a release tag', () => {
	eq(system.update.call({ args: { tag: 'v1;reboot' } }), { error: 'Not a release: v1;reboot' });
	eq(system.update.call({ args: { tag: null } }), { error: 'Not a release: null' });
	ok(system.update.call({ args: {} }).error, 'missing tag is refused');
});

done();
