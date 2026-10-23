// zeeli.policies: who, what, when and action, applied to the firewall, dnsmasq and the
// per-device speed limits. Calls go straight to lib/zeeli/policies.uc.
'use strict';

import * as policies from 'zeeli.policies';

const policyArgs = { name: 'name', enabled: true, who: [], what: {}, when: {}, until: 0, action: {}, tag: 'tag' };

return {
	'zeeli.policies': {
		list: {
			call: function() {
				return policies.list();
			}
		},

		/** What the router is doing about policies: the include, what runs now, limits and warnings. */
		status: {
			call: function() {
				return policies.status();
			}
		},

		create: {
			args: policyArgs,
			call: function(request) {
				return policies.create(request.args);
			}
		},

		/** Send only what changes. `until: 0` removes an end time. */
		update: {
			args: { id: 'id', ...policyArgs },
			call: function(request) {
				return policies.update(request.args);
			}
		},

		delete: {
			args: { id: 'id' },
			call: function(request) {
				return policies.remove(request.args);
			}
		},

		reorder: {
			args: { ids: [] },
			call: function(request) {
				return policies.reorder(request.args);
			}
		},

		/** Block `who` for `minutes`; it ends on its own, with the console closed. */
		pause: {
			args: { who: [], minutes: 60, name: 'name', what: 'internet', tag: 'tag' },
			call: function(request) {
				return policies.pause(request.args);
			}
		},

		apply: {
			call: function() {
				return policies.apply();
			}
		}
	}
};
