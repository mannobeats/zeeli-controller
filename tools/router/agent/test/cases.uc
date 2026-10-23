// Policies and groups the compiler tests (and their golden files) are built from. The
// clock is explicit, so results don't depend on the machine's time zone.
'use strict';

import { clock } from 'zeeli.nftpolicy';

/** The GL-BE9300's zones and the devices fw4 gives them. */
const ZONES = { lan: ['br-lan'], guest: ['br-guest'], iot: ['br-iot'], wan: ['eth0', 'sta1'] };

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

/** A router with a WireGuard tunnel (GL's wgclient1, mark 0x1000) and a second Ethernet uplink; both up. */
const TARGETS = {
	'vpn:10101': { kind: 'vpn', label: 'UK VPN (WireGuard)', up: true, dev: 'wgclient1', gw: null, mark: 0x1000 },
	'uplink:secondwan': { kind: 'uplink', label: 'Ethernet 2', up: true, dev: 'eth2', gw: '192.168.2.1', mark: 0 },
};
const ROUTE_ZONES = { ...ZONES, wan: ['eth0', 'eth2', 'sta1'], wgclient1: ['wgclient1'] };
const routing = { ...base, zones: ROUTE_ZONES, internet: ['wan', 'wgclient1'], targets: TARGETS };
const via = (target, fallback) => ({ kind: 'route', target, fallback });
const tvViaUk = policy('000007', 10, { who: [client(TV)], action: via('vpn:10101', 'block') });
const kidsViaEth2 = policy('000008', 20, { who: [group('a1b2c3')], when: everyNight, action: via('uplink:secondwan', 'normal') });
const netflix = policy('000009', 30, { who: [client(TV)], what: { kind: 'sites', sites: ['netflix.com'] }, action: via('vpn:10101', 'normal') });
const down = { ...TARGETS, 'vpn:10101': { ...TARGETS['vpn:10101'], up: false }, 'uplink:secondwan': { ...TARGETS['uplink:secondwan'], up: false } };

/** name -> { input }; each becomes test/golden/<name>.nft */
const CASES = {
	'group-schedule-night': { ...base, policies: [bedtime], now: at(23, 0) },
	'group-schedule-day': { ...base, policies: [bedtime], now: at(12, 0) },
	'sites': { ...base, policies: [tiktok], now: at(12, 0) },
	'network-to-network': { ...base, policies: [guestToLan, policy('000006', 35, { who: [client(TABLET)], what: { kind: 'network', network: 'iot' } })], now: at(12, 0) },
	'allow-exception': { ...base, policies: [exception, bedtime], now: at(23, 0) },
	'pause-running': { ...base, policies: [pause], now: at(23, 30) },
	'pause-expired': { ...base, policies: [pause], now: at(24, 5) },
	'route-vpn-block': { ...routing, policies: [tvViaUk], now: at(12, 0) },
	'route-uplink-night': { ...routing, policies: [kidsViaEth2], now: at(23, 0) },
	'route-uplink-day': { ...routing, policies: [kidsViaEth2], now: at(12, 0) },
	'route-sites-and-order': { ...routing, policies: [policy('000001', 5, { who: [group('a1b2c3')], when: everyNight }), tvViaUk, netflix, kidsViaEth2], now: at(23, 0) },
	'route-target-down': { ...routing, targets: down, policies: [tvViaUk, netflix, kidsViaEth2], now: at(23, 0) },
};

// this ucode needs exports listed rather than marked inline
export { ZONES, CASES, TARGETS, at, policy, group, client, network, kids, base, routing, via, everyNight, MAYA, LEO, TABLET, TV };
