// zeeli.wifi: WiFi networks of our own on any radio, attached to any LAN network, with
// schedules. Thin: it reads the declared arguments and calls zeeli.wifi (lib/zeeli/wifi.uc).
'use strict';

import { list, reveal, create, update, remove, setEnabled, apply, setSchedule, clearSchedule, tick } from 'zeeli.wifi';

return {
	'zeeli.wifi': {
		/** Every AP: the router's own slots and ours, per-radio slot use, the networks one can join. No keys. */
		list: {
			call: function() {
				return list();
			}
		},

		/** The password of one network the agent made. */
		reveal: {
			args: { id: 'id' },
			call: function(request) {
				return reveal(request.args.id);
			}
		},

		create: {
			args: { ssid: 'name', password: 'secret', bands: [], network: 'kids', security: 'sae', hidden: false, isolate: false, options: {}, schedule: {} },
			call: function(request) {
				return create(request.args);
			}
		},

		update: {
			args: { id: 'id', ssid: 'name', password: 'secret', bands: [], network: 'kids', security: 'sae', hidden: false, isolate: false, options: {} },
			call: function(request) {
				return update(request.args);
			}
		},

		'delete': {
			args: { id: 'id' },
			call: function(request) {
				return remove(request.args.id);
			}
		},

		set_enabled: {
			args: { id: 'id', enabled: true },
			call: function(request) {
				return setEnabled(request.args.id, request.args.enabled);
			}
		},

		/** Reload WiFi so every change since the last apply reaches the radios. */
		apply: {
			call: function() {
				return apply();
			}
		},

		set_schedule: {
			args: { id: 'id', enabled: true, days: [], off: '22:00', on: '07:00' },
			call: function(request) {
				const a = request.args;
				return setSchedule(a.id, { enabled: a.enabled ?? true, days: a.days, off: a.off, on: a.on });
			}
		},

		clear_schedule: {
			args: { id: 'id' },
			call: function(request) {
				return clearSchedule(request.args.id);
			}
		},

		/** Enforce schedules now. The zeeli-wifi-schedule service calls this every minute. */
		tick: {
			call: function() {
				return tick();
			}
		}
	}
};
