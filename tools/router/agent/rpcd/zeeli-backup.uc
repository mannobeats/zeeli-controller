// zeeli.backup: snapshots of /etc/config, and the full backup archive.
'use strict';

import { fail } from 'zeeli.common';
import * as backup from 'zeeli.backup';
import * as rollback from 'zeeli.rollback';
import * as snapshots from 'zeeli.snapshots';

const isId = (s) => type(s) == 'string' && match(s, /^s[0-9]+(-[0-9]+)?$/) != null;

return {
	'zeeli.backup': {
		/** Snapshots, newest first, with how many the router keeps. */
		list: {
			call: function() {
				return { snapshots: snapshots.list(), keep: snapshots.KEEP, autoKeep: snapshots.AUTO_KEEP };
			}
		},
		create: {
			args: { reason: 'reason' },
			call: function(request) {
				const reason = type(request.args.reason) == 'string' ? trim(request.args.reason) : '';
				if (reason == '' || length(reason) > 80 || match(reason, /[[:cntrl:]]/))
					return fail('Say why you’re taking it, in up to 80 characters.');
				return snapshots.create(reason);
			}
		},
		delete: {
			args: { id: 'id' },
			call: function(request) {
				return isId(request.args.id) ? snapshots.remove(request.args.id) : fail('That isn’t a snapshot.');
			}
		},
		/**
		 * Write a snapshot back and reload what can be reloaded; says whether a restart is needed.
		 * When it touches network, wireless, firewall or dropbear the answer carries a token the
		 * console must confirm (below), or the router puts everything back.
		 */
		restore: {
			args: { id: 'id' },
			call: function(request) {
				return isId(request.args.id) ? rollback.restoreSnapshot(request.args.id) : fail('That isn’t a snapshot.');
			}
		},
		confirm: {
			args: { token: 'token' },
			call: function(request) {
				return rollback.confirm(request.args.token);
			}
		},
		revert: {
			args: { token: 'token' },
			call: function(request) {
				return rollback.expire(request.args.token);
			}
		},
		status: {
			args: { token: 'token' },
			call: function(request) {
				return rollback.status(request.args.token);
			}
		},
		/** What changed since a snapshot: files and sections, never values. */
		diff: {
			args: { id: 'id' },
			call: function(request) {
				return isId(request.args.id) ? snapshots.diff(request.args.id) : fail('That isn’t a snapshot.');
			}
		},

		/** Make a backup archive; the console fetches the path it returns through GL’s /download. */
		download: {
			call: function() {
				return backup.download();
			}
		},
		/** The console has the file; delete it. A timer deletes it anyway after five minutes. */
		finish_download: {
			call: function() {
				return backup.finish();
			}
		},
		/** Get ready for a restore: the path the console sends the archive to through GL’s /upload. */
		prepare: {
			call: function() {
				return backup.prepare();
			}
		},
		/** Check the uploaded archive; the token it returns is what restore_file needs. */
		inspect: {
			call: function() {
				return backup.inspect();
			}
		},
		restore_file: {
			args: { token: 'token' },
			call: function(request) {
				const t = request.args.token;
				return type(t) == 'string' && match(t, /^[0-9a-f]{64}$/) ? backup.restore(t) : fail('That isn’t the file you were shown. Choose it again.');
			}
		},
		discard: {
			call: function() {
				return backup.discard();
			}
		}
	}
};
