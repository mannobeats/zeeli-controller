// zeeli.names: local names for devices (<name>.lan) and the devices a person has set up.
'use strict';

import { serve } from 'zeeli.common';

import * as names from 'zeeli.names';

return serve({
	'zeeli.names': {
		list: {
			call: function() {
				return names.list();
			}
		},

		/** The whole list of named devices, each { mac, name, ip }. */
		sync: {
			args: { devices: [] },
			call: function(request) {
				return names.sync(request.args);
			}
		},

		set_enabled: {
			args: { enabled: true },
			call: function(request) {
				return names.setEnabled(request.args);
			}
		},

		dismiss: {
			args: { macs: [], dismissed: true },
			call: function(request) {
				return names.dismiss(request.args);
			}
		}
	}
});
