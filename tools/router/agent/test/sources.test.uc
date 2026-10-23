'use strict';

import { eq, ok, test, done } from 'assert';
import * as sources from 'zeeli.sources';

test('ping: loss and average from busybox’s summary, and nothing back is a total loss', () => {
	const good = `PING 1.1.1.1 (1.1.1.1): 56 data bytes

--- 1.1.1.1 ping statistics ---
4 packets transmitted, 4 packets received, 0% packet loss
round-trip min/avg/max = 21.060/21.816/22.394 ms
`;
	eq(sources.parsePing(good), { loss: 0, ms: 21.816 });
	const some = '4 packets transmitted, 3 packets received, 25% packet loss\nround-trip min/avg/max = 9.0/10.0/11.0 ms';
	eq(sources.parsePing(some).loss, 25);
	ok(sources.parsePing(some).ms == 10);
	const none = '--- 203.0.113.9 ping statistics ---\n3 packets transmitted, 0 packets received, 100% packet loss\n';
	eq(sources.parsePing(none), { loss: 100, ms: null });
	eq(sources.parsePing('ping: sendto: Network unreachable'), { loss: 100, ms: null });
	eq(sources.parsePing(null), { loss: 100, ms: null });
});

test('CPU and memory from /proc', () => {
	const stat = 'cpu  4705 150 3034 362343 536 0 98 0 0 0\ncpu0 1175 37 758 90585 134 0 24 0 0 0\n';
	eq(sources.parseStat(stat), { busy: 4705 + 150 + 3034 + 98, total: 4705 + 150 + 3034 + 362343 + 536 + 98 });
	eq(sources.parseStat('intr 1 2 3'), null);
	const mem = 'MemTotal:         882964 kB\nMemFree:           69264 kB\nMemAvailable:     278352 kB\n';
	eq(sources.parseMeminfo(mem), { total: 882964, avail: 278352 });
	eq(sources.parseMeminfo('nothing useful'), null);
});

test('the active uplink is the device of the lowest-metric default route that is up', () => {
	const route = `Iface	Destination	Gateway 	Flags	RefCnt	Use	Metric	Mask		MTU	Window	IRTT
eth0	00000000	0100A8C0	0003	0	0	30	00000000	0	0	0
sta1	00000000	FE01A8C0	0003	0	0	20	00000000	0	0	0
br-lan	000A0A0A	00000000	0001	0	0	0	00FFFFFF	0	0	0
tun0	00000000	00000000	0002	0	0	5	00000000	0	0	0
`;
	eq(sources.parseRoute(route), 'sta1');
	eq(sources.parseRoute('Iface\tDestination\n'), null);
});

test('uplinks and LAN networks from netifd’s dump', () => {
	const dump = { interface: [
		{ interface: 'loopback', up: true, proto: 'static', l3_device: 'lo', 'ipv4-address': [{ address: '127.0.0.1', mask: 8 }] },
		{ interface: 'lan', up: true, proto: 'static', l3_device: 'br-lan', 'ipv4-address': [{ address: '192.168.8.1', mask: 24 }] },
		{ interface: 'guest', up: true, proto: 'static', l3_device: 'br-guest', 'ipv4-address': [{ address: '192.168.9.1', mask: 24 }] },
		{ interface: 'wan', up: false, proto: 'dhcp', device: 'eth0' },
		{ interface: 'wan6', up: false, proto: 'dhcpv6', device: 'eth0' },
		{ interface: 'wwan', up: true, proto: 'dhcp', l3_device: 'sta1', route: [{ target: '0.0.0.0', mask: 0, nexthop: '192.168.1.254' }] },
		{ interface: 'modem_1_1_s1_6', up: false, proto: 'dhcpv6' },
	] };
	const r = sources.parseInterfaces(dump);
	eq(r.uplinks, [
		{ name: 'wan', up: false, dev: null, gateway: null },
		{ name: 'wwan', up: true, dev: 'sta1', gateway: '192.168.1.254' },
	]);
	eq(map(r.networks, (n) => [n.name, n.bits]), [['lan', 24], ['guest', 24]]);
	ok(sources.inNet('192.168.8.77', r.networks[0]));
	ok(!sources.inNet('192.168.9.77', r.networks[0]));
	ok(!sources.inNet('not an address', r.networks[0]));
	ok(sources.inNet('10.1.2.3', { addr: sources.ip4('10.0.0.0'), bits: 8 }));
});

test('GL’s device list: totals are numbers, MACs are upper case, junk keys are dropped', () => {
	const list = { clients: {
		'aa:bb:cc:00:00:01': { name: 'Laptop', ip: '192.168.8.10', online: true, total_rx: '1368690762961', total_tx: 5 },
		'FF:FF:FF:FF:FF:FF': { name: 'global', online: false, total_rx: '0', total_tx: '0' },
		'../../x': { name: 'bad', online: true, total_rx: '1', total_tx: '1' },
		'AA:BB:CC:00:00:02': { online: false },
	} };
	const out = sources.parseClients(list);
	eq(sort(map(out, (c) => c.mac)), ['AA:BB:CC:00:00:01', 'AA:BB:CC:00:00:02']);
	const laptop = filter(out, (c) => c.mac == 'AA:BB:CC:00:00:01')[0];
	eq(laptop, { mac: 'AA:BB:CC:00:00:01', name: 'Laptop', ip: '192.168.8.10', online: true, down: 1368690762961, up: 5 });
	eq(sources.parseClients(null), []);
});

done();
