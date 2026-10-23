// zeeli.firewall: zones, forwardings and rules, with confirm-or-roll-back.
//
// Every write answers { token, seconds }; the console must call confirm(token) within that
// time or the agent puts the firewall back as it was (see lib/zeeli/rollback.uc).
'use strict';

import { fail, serve } from 'zeeli.common';
import * as fw from 'zeeli.firewall';
import * as rollback from 'zeeli.rollback';

// `id` is the rule’s UCI name and `current` the name the console saw, so a stale list is refused
const RULE = { id: 'id', current: 'name' };
const FIELDS = {
	name: 'name',
	src: 'zone',
	dest: 'zone',
	proto: 'proto',
	destPort: 'ports',
	srcIp: 'ip',
	destIp: 'ip',
	target: 'ACCEPT',
	family: 'ipv4',
	enabled: true,
};

return serve({
	'zeeli.firewall': {
		zones: { call: function() { return fw.zones(); } },
		networks: { call: function() { return fw.networks(); } },
		forwardings: { call: function() { return fw.forwardings(); } },
		rules: { call: function() { return fw.rules(); } },

		zone_update: {
			args: { name: 'zone', input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT', masquerade: true, mssClamp: true, networks: [] },
			call: function(request) {
				return type(request.args.name) == 'string' ? fw.zone_update(request.args) : fail('Pick a zone.');
			}
		},
		forwarding_add: {
			args: { src: 'zone', dest: 'zone' },
			call: function(request) {
				return fw.forwarding_add(request.args);
			}
		},
		forwarding_remove: {
			args: { id: 'id' },
			call: function(request) {
				return fw.forwarding_remove(request.args);
			}
		},
		rule_add: {
			args: FIELDS,
			call: function(request) {
				return fw.rule_add(request.args);
			}
		},
		rule_update: {
			args: { ...RULE, ...FIELDS },
			call: function(request) {
				return fw.rule_update(request.args);
			}
		},
		rule_enable: {
			args: { ...RULE, enabled: true },
			call: function(request) {
				return fw.rule_enable(request.args);
			}
		},
		rule_delete: {
			args: RULE,
			call: function(request) {
				return fw.rule_delete(request.args);
			}
		},
		/** Put a rule at position `to` (0 is first) in the list `rules` returns. */
		rule_move: {
			args: { ...RULE, to: 0 },
			call: function(request) {
				return fw.rule_move(request.args);
			}
		},

		/** The console reached the router after a change: keep it. */
		confirm: {
			args: { token: 'token' },
			call: function(request) {
				return rollback.confirm(request.args.token);
			}
		},
		/** Undo a change now, without waiting for the timer. */
		revert: {
			args: { token: 'token' },
			call: function(request) {
				return rollback.expire(request.args.token);
			}
		},
		/** Whether a change is still waiting, was kept, or was undone. */
		status: {
			args: { token: 'token' },
			call: function(request) {
				return rollback.status(request.args.token);
			}
		}
	}
});
