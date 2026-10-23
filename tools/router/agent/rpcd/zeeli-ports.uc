// zeeli.ports: per-port link state and devices, and port profiles.
'use strict';

import * as ports from 'zeeli.ports';

return {
	'zeeli.ports': {
		/** Each physical port’s link, speed, duplex and the devices seen behind it. */
		status: {
			call: function() {
				return ports.status();
			}
		},
		profiles: {
			call: function() {
				return ports.profiles();
			}
		},
		/** Create a profile, or change the one with `id`. Applying it is GL’s cable.set_port_config. */
		profile_save: {
			args: { id: 'id', name: 'name', untagged: 'untagged', tagged: [] },
			call: function(request) {
				return ports.profile_save(request.args);
			}
		},
		profile_delete: {
			args: { id: 'id' },
			call: function(request) {
				return ports.profile_delete(request.args);
			}
		}
	}
};
