// zeeli.stats: history for devices, networks and uplinks, events and alerts. The collector
// service (bin/zeeli-collector) records; this reads. All the checking is in lib/zeeli/stats.uc.
//
// Numbers from the console travel as strings ('50'), because rpcd checks an argument's type
// against the example below and the firmware's bridge may send a whole number as a float.
'use strict';

import * as stats from 'zeeli.stats';

return {
	'zeeli.stats': {
		/** One thing's history: kind wan|network|client|system|health, its id, range 24h|30d|12m. */
		series: {
			args: { kind: 'wan', id: 'wan', range: '24h' },
			call: (request) => stats.series(request.args),
		},

		/** The busiest devices, networks and uplinks for a range, as of the collector's last summary. */
		top: {
			args: { range: '24h', kind: 'client', limit: '10' },
			call: (request) => stats.top(request.args),
		},

		/** What happened, newest first: since (epoch seconds), limit, which kinds, and optionally one device (MAC) or uplink. */
		events: {
			args: { since: '0', limit: '100', kinds: [], subject: 'AA:BB:CC:DD:EE:FF' },
			call: (request) => stats.events(request.args),
		},

		/**
		 * Unread alerts. `ack` lists alert numbers to acknowledge, `all` acknowledges every one,
		 * and `kinds` becomes the set of kinds that raise alerts when `save` is true.
		 */
		alerts: {
			args: { ack: [], all: false, save: false, kinds: [] },
			call: (request) => stats.alerts(request.args),
		},

		/** The address pinged for internet health, and the temperature that raises an alert. Changes only with `save`. */
		settings: {
			args: { save: false, target: '1.1.1.1', tempHigh: '85' },
			call: (request) => stats.settings(request.args),
		},

		/** Is the collector running, when it last sampled, how much it stores. */
		status: {
			call: () => stats.status(),
		},
	},
};
