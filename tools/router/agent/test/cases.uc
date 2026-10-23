// Policies and groups the compiler tests (and their golden files) are built from. The
// clock is explicit, so results don't depend on the machine's time zone.
'use strict';

import { clock } from 'zeeli.nftpolicy';

/** The GL-BE9300's zones and the devices fw4 gives them, as `nft -c` needs them. */
const ZONE_DEVICES = { lan: ['br-lan'], guest: ['br-guest'], iot: ['br-iot'], wan: ['eth0', 'sta1'] };
const ZONES = keys(ZONE_DEVICES);

const MAYA = '02:5e:e1:10:14:c8', LEO = '02:5e:e1:17:2b:c1', TABLET = '02:5e:e1:24:33:d0', TV = '02:5e:e1:31:90:f4';

/** Thursday 22 October 2026 at hh:mm, UTC; `compile` is told it is local time. */
const at = (hh, mm) => clock(1792627200 + hh * 3600 + mm * 60, gmtime);

const kids = { id: 'a1b2c3', members: [MAYA, LEO, TABLET] };

const policy = (id, order, fields) => ({
	id, name: `policy ${id}`, enabled: true, order, who: [], what: { kind: 'internet' }, when: { kind: 'always' },
	until: null, action: { kind: 'block' }, tag: '', ...fields,
});
const group = (id) => ({ type: 'group', id });
const client = (id) => ({ type: 'client', id });
const network = (id) => ({ type: 'network', id });
const everyNight = { kind: 'schedule', days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '07:00' };

const bedtime = policy('000001', 10, { who: [group('a1b2c3')], when: everyNight });
const tiktok = policy('000002', 20, { who: [group('a1b2c3'), client(TV)], what: { kind: 'sites', sites: ['tiktok.com', 'tiktokv.com'] } });
const guestToLan = policy('000003', 30, { who: [network('guest')], what: { kind: 'network', network: 'lan' } });
const exception = policy('000004', 5, { who: [client(LEO)], action: { kind: 'allow' } });
const pause = policy('000005', 40, { who: [client(TV)], what: { kind: 'everything' }, until: 1792627200 + 23 * 3600 + 3600 });

const base = { groups: [kids], zones: ZONES, internet: ['wan'] };

/** name -> { input }; each becomes test/golden/<name>.nft */
const CASES = {
	'group-schedule-night': { ...base, policies: [bedtime], now: at(23, 0) },
	'group-schedule-day': { ...base, policies: [bedtime], now: at(12, 0) },
	'sites': { ...base, policies: [tiktok], now: at(12, 0) },
	'network-to-network': { ...base, policies: [guestToLan, policy('000006', 35, { who: [client(TABLET)], what: { kind: 'network', network: 'iot' } })], now: at(12, 0) },
	'allow-exception': { ...base, policies: [exception, bedtime], now: at(23, 0) },
	'pause-running': { ...base, policies: [pause], now: at(23, 30) },
	'pause-expired': { ...base, policies: [pause], now: at(24, 5) },
};

// this ucode needs exports listed rather than marked inline
export { ZONE_DEVICES, ZONES, CASES, at, policy, group, client, network, kids, base, everyNight, MAYA, LEO, TABLET, TV };
