// zeeli.groups: named sets of devices for policies. Calls go straight to lib/zeeli/groups.uc.
'use strict';

import { serve } from 'zeeli.common';

import * as groups from 'zeeli.groups';

return serve({
	'zeeli.groups': {
		list: {
			call: function() {
				return groups.list();
			}
		},

		create: {
			args: { name: 'name', kind: 'devices', members: [] },
			call: function(request) {
				return groups.create(request.args);
			}
		},

		/** Send only what changes. */
		update: {
			args: { id: 'id', name: 'name', kind: 'devices', members: [] },
			call: function(request) {
				return groups.update(request.args);
			}
		},

		delete: {
			args: { id: 'id' },
			call: function(request) {
				return groups.remove(request.args);
			}
		},

		add_members: {
			args: { id: 'id', macs: [] },
			call: function(request) {
				return groups.setMembers(request.args, true);
			}
		},

		remove_members: {
			args: { id: 'id', macs: [] },
			call: function(request) {
				return groups.setMembers(request.args, false);
			}
		}
	}
});
