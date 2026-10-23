// zeeli.system: the agent itself. Its version, and installing console releases.
'use strict';

import { fail, run, serve, valid, version } from 'zeeli.common';

return serve({
	'zeeli.system': {
		version: {
			call: function() {
				return { version: version() };
			}
		},

		/** Install a console release, checked against the release key by zeeli-update. */
		update: {
			args: { tag: 'tag' },
			call: function(request) {
				const tag = request.args.tag;
				if (!valid.tag(tag)) return fail(`Not a release: ${tag}`);
				const r = run(['/usr/libexec/zeeli-update', 'install', tag]);
				if (r.code != 0) return fail(trim(r.stdout) || `The router couldn’t install ${tag}.`);
				return { output: trim(r.stdout) };
			}
		}
	}
});
