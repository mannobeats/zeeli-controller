import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createRouterApi, type RouterApi } from '../api.ts';
import { RouterError } from '../errors.ts';
import { createMockTransport } from '../mock/transport.ts';
import type { Transport } from '../transport/types.ts';
import { confirmChange } from './safety.ts';

let api: RouterApi;
beforeEach(async () => {
  api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
});

const armed = { token: '0123456789abcdef', seconds: 30 };
/** A transport whose agent answers the confirm call from a script, one reply or error per try. */
const scripted = (...replies: (object | RouterError)[]) => {
  const zeeli = vi.fn(async () => {
    const next = replies.shift();
    if (next instanceof RouterError) throw next;
    return next;
  });
  return { zeeli } as unknown as Transport & { zeeli: typeof zeeli };
};

describe('confirming a change', () => {
  test('reaching the router keeps the change', async () => {
    const t = scripted({ state: 'confirmed' });
    expect(await confirmChange(t, 'firewall', armed)).toEqual({ state: 'confirmed' });
    expect(t.zeeli).toHaveBeenCalledWith('firewall', 'confirm', { token: armed.token });
  });

  test('a router that already undid it says so', async () => {
    const t = scripted({ state: 'rolledBack', message: 'The router undid it.' });
    expect(await confirmChange(t, 'firewall', armed)).toEqual({ state: 'rolledBack', message: 'The router undid it.' });
  });

  test('a router with no record of the change says it can’t tell', async () => {
    const t = scripted({ state: 'unknown', message: 'The router has no record of that change.' });
    expect(await confirmChange(t, 'firewall', armed)).toEqual({ state: 'unknown', message: 'The router has no record of that change.' });
  });

  test('a router that failed to undo it is reported the same way', async () => {
    const t = scripted({ state: 'failed', message: 'The router couldn’t undo the change automatically: no space.' });
    expect(await confirmChange(t, 'firewall', armed)).toMatchObject({ state: 'rolledBack' });
  });

  test('losing the router for a moment is retried until it answers', async () => {
    const t = scripted(new RouterError('offline', 'Can’t reach the router.'), new RouterError('timeout', 'Too slow.'), {
      state: 'confirmed',
    });
    expect(await confirmChange(t, 'firewall', armed, 0)).toEqual({ state: 'confirmed' });
    expect(t.zeeli).toHaveBeenCalledTimes(3);
  });

  test('never reaching it again is reported as unknown, because the router decides alone', async () => {
    vi.useFakeTimers();
    try {
      const t = scripted();
      t.zeeli.mockRejectedValue(new RouterError('offline', 'Can’t reach the router.'));
      const outcome = confirmChange(t, 'firewall', armed, 1000);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(await outcome).toMatchObject({ state: 'unknown' });
      expect(t.zeeli.mock.calls.length).toBeGreaterThan(10);
    } finally {
      vi.useRealTimers();
    }
  });

  test('other failures, such as being signed out, are not retried', async () => {
    const t = scripted(new RouterError('signedOut', 'Your session ended.'));
    await expect(confirmChange(t, 'firewall', armed, 0)).rejects.toThrow('Your session ended.');
    expect(t.zeeli).toHaveBeenCalledTimes(1);
  });
});

describe('firewall through the agent', () => {
  test('a zone change is written, confirmed, and read back', async () => {
    const { outcome } = await api.safety.firewall.updateZone('guest', { input: 'DROP', mssClamp: true, networks: ['guest'] });
    expect(outcome).toEqual({ state: 'confirmed' });
    expect((await api.safety.firewall.zones()).find((z) => z.name === 'guest')).toMatchObject({ input: 'DROP', mssClamp: true });
  });

  test('service sections are listed but can’t be changed', async () => {
    const zones = await api.safety.firewall.zones();
    expect(zones.find((z) => z.name === 'tailscale0')).toMatchObject({ owner: 'service', editable: false });
    await expect(api.safety.firewall.updateZone('tailscale0', { input: 'DROP' })).rejects.toThrow('changed from that service');
    const rules = await api.safety.firewall.rules();
    const service = rules.find((r) => !r.editable);
    expect(service).toBeDefined();
    if (service) await expect(api.safety.firewall.setRuleEnabled(service, false)).rejects.toThrow('changed from that service');
  });

  test('a change nobody confirms is undone by the router', async () => {
    const t = createMockTransport({ latencyMs: 0 });
    await t.session.login('demo');
    const fw = createRouterApi(t).safety.firewall;
    const before = await fw.rules();
    const first = before[0];
    if (!first) throw new Error('no rules');
    // write without confirming, as a console that lost the router would
    const written = await t.zeeli<{ token: string }>('firewall', 'rule_enable', { id: first.id, current: first.name, enabled: false });
    expect((await fw.rules())[0]?.enabled).toBe(false);
    await expect(t.zeeli('firewall', 'rule_delete', { id: first.id, current: first.name })).rejects.toThrow('still waiting');
    expect(await t.zeeli('firewall', 'revert', { token: written.token })).toMatchObject({ state: 'rolledBack' });
    expect((await fw.rules())[0]?.enabled).toBe(true);
    expect(await t.zeeli('firewall', 'confirm', { token: written.token })).toMatchObject({ state: 'rolledBack' });
  });

  test('rules are added, checked, moved and removed by position and name', async () => {
    const fw = api.safety.firewall;
    await expect(fw.addRule({ name: 'Bad', destPort: '99999' })).rejects.toThrow('Ports must be 1 to 65535');
    await expect(fw.addRule({ name: 'Bad', proto: 'icmp', destPort: '80' })).rejects.toThrow('Ports only apply to TCP or UDP');
    await fw.addRule({ name: 'Game server', src: 'wan', dest: 'lan', proto: 'udp', destPort: '27015' });
    const added = (await fw.rules()).find((r) => r.name === 'Game server');
    expect(added).toMatchObject({ proto: 'udp', destPort: '27015', owner: 'custom', enabled: true });
    if (!added) return;

    await expect(fw.updateRule({ ...added, name: 'Someone else' }, { target: 'DROP' })).rejects.toThrow('changed since you loaded it');
    await fw.updateRule(added, { target: 'DROP' });
    await fw.moveRule(added, 0);
    expect((await fw.rules()).map((r) => r.name)[0]).toBe('Game server');
    expect((await fw.rules()).map((r) => r.index)).toEqual([...(await fw.rules()).keys()]);
    const moved = (await fw.rules())[0];
    if (!moved) return;
    expect((await fw.moveRule(moved, 0)).result).toMatchObject({ moved: false });
    await fw.removeRule(moved);
    expect((await fw.rules()).some((r) => r.name === 'Game server')).toBe(false);
  });

  test('forwardings connect two different zones once', async () => {
    const fw = api.safety.firewall;
    await expect(fw.addForwarding('lan', 'wan')).rejects.toThrow('already connected');
    await expect(fw.addForwarding('lan', 'lan')).rejects.toThrow('two different zones');
    await fw.addForwarding('iot', 'guest');
    const added = (await fw.forwardings()).find((f) => f.src === 'iot' && f.dest === 'guest');
    expect(added).toBeDefined();
    if (added) await fw.removeForwarding(added);
    expect((await fw.forwardings()).some((f) => f.src === 'iot' && f.dest === 'guest')).toBe(false);
  });
});

describe('snapshots and backups', () => {
  test('a snapshot is listed newest first, diffed, restored and removed', async () => {
    const b = api.safety.backup.snapshots;
    const made = await b.create('Before the test');
    const { snapshots, keep } = await b.list();
    expect(keep).toBe(10);
    expect(snapshots[0]).toMatchObject({ id: made.id, reason: 'Before the test' });
    expect(await b.diff(made.id)).toEqual([]);

    await api.safety.firewall.updateZone('iot', { forward: 'ACCEPT' });
    const diff = await b.diff(made.id);
    expect(diff).toEqual([
      { name: 'firewall', change: 'changed', sections: [{ section: 'zone iot', change: 'changed', options: ['forward'] }] },
    ]);

    const r = await b.restore(made.id);
    expect(r).toMatchObject({ restored: ['firewall'], reloaded: ['firewall'], rebootNeeded: false });
    expect(r.undo).not.toBeNull();
    expect((await api.safety.firewall.zones()).find((z) => z.name === 'iot')?.forward).toBe('REJECT');
    expect(await b.restore(made.id)).toMatchObject({ restored: [], undo: null });

    await b.remove(made.id);
    await expect(b.remove(made.id)).rejects.toThrow('already gone');
    await expect(b.restore('../etc')).rejects.toThrow('isn’t a snapshot');
  });

  test('settings only read at startup mean a restart is needed', async () => {
    const old = (await api.safety.backup.snapshots.list()).snapshots.at(-1);
    if (!old) throw new Error('no snapshot');
    const r = await api.safety.backup.snapshots.restore(old.id);
    expect(r.rebootNeeded).toBe(true);
    expect(r.summary).toContain('kmwan is only read when the router starts');
  });

  test('only ten are kept, and a reason is required', async () => {
    const b = api.safety.backup.snapshots;
    await expect(b.create('  ')).rejects.toThrow('Say why');
    for (let i = 0; i < 12; i++) await b.create(`Number ${i}`);
    expect((await b.list()).snapshots).toHaveLength(10);
  });

  test('a backup downloads through the path the router names', async () => {
    const { blob, filename } = await api.safety.backup.download();
    expect(filename).toMatch(/^backup-\d+\.tar\.gz$/);
    expect(blob.size).toBeGreaterThan(0);
  });

  test('a file is checked first and restored only with the token it was shown', async () => {
    const b = api.safety.backup;
    await expect(b.restoreFile('x')).rejects.toThrow('No backup file has been sent yet');
    const info = await b.inspect(new Blob(['archive']), 'backup.tar.gz');
    expect(info).toMatchObject({ files: 91, configs: 54 });
    await expect(b.restoreFile('0'.repeat(64))).rejects.toThrow('isn’t the file you were shown');
    expect(await b.restoreFile(info.token)).toMatchObject({ rebootRequired: true, restored: 91 });
    await expect(b.restoreFile(info.token)).rejects.toThrow('No backup file has been sent yet');
    await b.inspect(new Blob(['archive']), 'backup.tar.gz');
    await b.discard();
    await expect(b.restoreFile(info.token)).rejects.toThrow('No backup file');
  });
});

describe('ports and profiles', () => {
  test('status names each port’s link, and leaves unplaceable devices unplaced', async () => {
    const s = await api.safety.ports.status();
    expect(s.ports.find((p) => p.name === 'secondwan')).toMatchObject({ label: 'LAN1', link: true, speedMbps: 1000, duplex: 'full' });
    expect(s.ports.find((p) => p.name === 'lan2')).toMatchObject({ link: false, speedMbps: null });
    expect(s.ports.every((p) => p.devices.length === 0)).toBe(true);
    expect(s.unattributed.length).toBeGreaterThan(0);
  });

  test('profiles keep their names unique and carry their tagged networks', async () => {
    const p = api.safety.ports;
    expect((await p.profiles()).map((x) => x.name)).toEqual(['Camera port', 'Lab trunk']);
    await expect(p.saveProfile({ name: 'camera port', untagged: 'iot', tagged: [] })).rejects.toThrow('already exists');
    await expect(p.saveProfile({ name: '', untagged: 'iot', tagged: [] })).rejects.toThrow('Give the profile a name');
    await expect(p.saveProfile({ name: 'A', untagged: '', tagged: [] })).rejects.toThrow('Pick the network');
    const saved = await p.saveProfile({ name: 'Guest AP', untagged: 'main', tagged: ['guest', 'main', 'guest'] });
    expect(saved.tagged).toEqual(['guest']);
    const edited = await p.saveProfile({ id: saved.id, name: 'Guest access point', untagged: 'main', tagged: [] });
    expect(edited).toMatchObject({ id: saved.id, name: 'Guest access point', tagged: [] });
    await p.removeProfile(saved.id);
    await expect(p.removeProfile(saved.id)).rejects.toThrow('already gone');
    await expect(p.saveProfile({ id: saved.id, name: 'Gone', untagged: 'main', tagged: [] })).rejects.toThrow('profile is gone');
  });
});

describe('mesh nodes', () => {
  test('GL’s topology becomes members with backhaul, signal, clients and uptime', async () => {
    const nodes = await api.networkExtras.mesh.nodes();
    expect(nodes.find((n) => n.self)).toMatchObject({ name: 'Zeeli-Demo', model: 'GL-BE9300' });
    expect(nodes.find((n) => n.name === 'Upstairs')).toMatchObject({
      backhaul: 'wireless',
      band: '5G',
      signal: -57,
      clients: 6,
      uptime: 259_200,
      online: true,
    });
    expect(nodes.find((n) => n.name === 'Garage')).toMatchObject({ backhaul: 'wired', signal: null });
  });

  test('nodes are renamed, rebooted and removed by MAC', async () => {
    const m = api.networkExtras.mesh;
    const garage = (await m.nodes()).find((n) => n.name === 'Garage');
    if (!garage) throw new Error('no node');
    await m.rename(garage.mac, 'Workshop');
    await m.reboot([garage.mac]);
    expect((await m.nodes()).find((n) => n.mac === garage.mac)).toMatchObject({ name: 'Workshop', uptime: 12 });
    await m.remove([garage.mac]);
    expect((await m.nodes()).some((n) => n.mac === garage.mac)).toBe(false);
  });

  test('a topology with other field names and nothing in it still reads', async () => {
    const t = {
      call: async () => [{ macaddr: 'aa:bb:cc:dd:ee:ff', hostname: 'Hall', backhaul: 'ethernet', clients: [{}, {}], online: 0 }, {}],
    } as unknown as Transport;
    const nodes = await createRouterApi(t).networkExtras.mesh.nodes();
    expect(nodes[0]).toMatchObject({ mac: 'AA:BB:CC:DD:EE:FF', name: 'Hall', backhaul: 'wired', clients: 2, online: false, uptime: null });
    expect(nodes[1]).toMatchObject({ mac: '', name: '', model: 'GL.iNet', backhaul: null, clients: 0, online: true });
  });
});
