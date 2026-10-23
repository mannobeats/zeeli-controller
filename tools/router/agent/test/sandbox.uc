// Helpers for tests that write UCI: put the sandbox back the way the fixtures have it, fix the
// clock, and read back what the agent did.
'use strict';

import { readfile, unlink, writefile } from 'fs';
import { cursor, paths } from 'zeeli.common';
import { includePath, sys } from 'zeeli.policyapply';

/** Thursday 22 October 2026, 12:00 UTC, which the tests treat as the router's local time. */
const NOON = 1792627200 + 12 * 3600;
const realReload = sys.reload;

function reset() {
	const fixtures = `${getenv('ZEELI_AGENT')}/test/fixtures/be9300`;
	writefile(`${paths.confdir}/zeeli`, '');
	for (let file in ['dhcp', 'firewall', 'network']) writefile(`${paths.confdir}/${file}`, readfile(`${fixtures}/${file}`));
	unlink(`${paths.confdir}/qos`);
	unlink(includePath());
	unlink(`${paths.state}/policies.json`);
	sys.calls = [];
	sys.reload = realReload;
	sys.answer = (argv) => ({ code: 0, stdout: '' });
	sys.now = () => NOON;
	sys.breakdown = gmtime;
	sys.neighbours = () => ({});
	sys.zoneDevices = () => ({ lan: ['br-lan'], guest: ['br-guest'], iot: ['br-iot'], wan: ['eth0', 'sta1'] });
}

/** An option of a section in /etc/config/zeeli (or another package), straight from disk. */
const uci = (section, option, config) => cursor().get(config ?? 'zeeli', section, option);
const sections = (type, config) => {
	const found = [];
	cursor().foreach(config ?? 'zeeli', type, (s) => push(found, s));
	return found;
};

/** Commands the agent ran, as strings, optionally only those starting with `first`. */
const ran = (first) => map(filter(sys.calls, (c) => !first || c[0] == first), (c) => join(' ', c));
const included = () => readfile(includePath());
const mac = (i) => sprintf('02:00:00:00:%02x:%02x', i / 256, i % 256);

// this ucode needs exports listed rather than marked inline
export { NOON, reset, uci, sections, ran, included, mac };
