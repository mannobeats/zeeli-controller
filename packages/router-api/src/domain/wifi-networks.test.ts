import { beforeEach, describe, expect, test } from 'vitest';
import { createRouterApi, type RouterApi } from '../api.ts';
import { createMockTransport } from '../mock/transport.ts';
import { checkOwnWifi, isOwn, type OwnWifi, type OwnWifiInput } from './wifi-networks.ts';

let api: RouterApi;
beforeEach(async () => {
  api = createRouterApi(createMockTransport({ latencyMs: 0 }));
  await api.session.login('demo');
});

const input: OwnWifiInput = {
  ssid: 'Garage',
  password: 'wrench and socket',
  bands: ['2g', '5g'],
  network: 'Lab',
  security: 'sae-mixed',
  hidden: false,
  isolate: false,
  options: {},
};

async function mine(): Promise<OwnWifi[]> {
  return (await api.wifiNetworks.overview()).networks.filter(isOwn);
}

describe('the overview', () => {
  test('lists the router’s own slots, the demo’s own networks, slot use and joinable networks', async () => {
    const o = await api.wifiNetworks.overview();
    expect(o.networks.filter((n) => n.owner === 'firmware').map((n) => n.role)).toContain('guest');
    expect((await mine()).map((n) => n.ssid)).toEqual(['Kids', 'Workshop']);
    const radios = Object.fromEntries(o.radios.map((r) => [r.band, r]));
    expect(radios['5g']).toMatchObject({ used: 7, limit: 17 });
    expect(o.lanNetworks.map((n) => n.id)).toEqual(['main', 'guest', 'iot', 'Lab', 'Kids']);
    expect(o.pending).toBe(false);
  });

  test('never carries a password', async () => {
    expect(JSON.stringify(await api.wifiNetworks.overview())).not.toContain('dino-nuggets');
  });
});

describe('making and changing networks', () => {
  test('create adds a network on each band and leaves changes waiting for apply', async () => {
    const { id } = await api.wifiNetworks.create(input);
    expect((await mine()).find((n) => n.id === id)).toMatchObject({ ssid: 'Garage', bands: ['2g', '5g'], network: 'Lab', hasKey: true });
    expect((await api.wifiNetworks.overview()).pending).toBe(true);
    await api.wifiNetworks.apply();
    expect((await api.wifiNetworks.overview()).pending).toBe(false);
  });

  test('refuses what the agent refuses, in its words', async () => {
    const fail = (patch: Partial<OwnWifiInput>) => api.wifiNetworks.create({ ...input, ...patch });
    await expect(fail({ ssid: '' })).rejects.toThrow('The network name must be 1 to 32 bytes.');
    await expect(fail({ password: 'short' })).rejects.toThrow('The password must be 8 to 63 characters.');
    await expect(fail({ bands: ['6g'], security: 'psk2' })).rejects.toThrow('6 GHz needs WPA3');
    await expect(fail({ network: 'nowhere' })).rejects.toThrow('That network doesn’t exist on the router.');
    await expect(fail({ ssid: 'Zeeli Home', bands: ['5g'] })).rejects.toThrow('Another network on 5 GHz is already called “Zeeli Home”.');
  });

  test('a band with no free slot is refused', async () => {
    for (let i = 0; i < 10; i++) await api.wifiNetworks.create({ ...input, ssid: `Fill ${i}`, bands: ['5g'] });
    await expect(api.wifiNetworks.create({ ...input, ssid: 'One more', bands: ['5g'] })).rejects.toThrow('The 5 GHz radio is full');
  });

  test('update keeps the password unless a new one is given, and reveal reads it back', async () => {
    const kids = (await mine()).find((n) => n.ssid === 'Kids') as OwnWifi;
    expect(await api.wifiNetworks.reveal(kids.id)).toBe('dino-nuggets-42');
    await api.wifiNetworks.update(kids.id, { ssid: 'Kids Room', options: { maxClients: 8 } });
    expect(await api.wifiNetworks.reveal(kids.id)).toBe('dino-nuggets-42');
    expect((await mine()).find((n) => n.id === kids.id)).toMatchObject({ ssid: 'Kids Room', options: { maxClients: 8 } });
    await api.wifiNetworks.update(kids.id, { password: 'a different one' });
    expect(await api.wifiNetworks.reveal(kids.id)).toBe('a different one');
  });

  test('"no limit" travels as 0 and comes back null', async () => {
    const shop = (await mine()).find((n) => n.ssid === 'Workshop') as OwnWifi;
    expect(shop.options.maxClients).toBe(12);
    await api.wifiNetworks.update(shop.id, { options: { maxClients: null } });
    expect(((await mine()).find((n) => n.id === shop.id) as OwnWifi).options.maxClients).toBeNull();
  });

  test('switching and deleting a network, and refusing one that isn’t there', async () => {
    const kids = (await mine()).find((n) => n.ssid === 'Kids') as OwnWifi;
    await api.wifiNetworks.setEnabled(kids.id, false);
    expect((await mine()).find((n) => n.id === kids.id)?.disabled).toBe(true);
    await api.wifiNetworks.remove(kids.id);
    expect((await mine()).map((n) => n.ssid)).toEqual(['Workshop']);
    await expect(api.wifiNetworks.remove('wifi5g')).rejects.toThrow('belongs to the router’s own settings');
  });

  test('schedules are stored and cleared', async () => {
    const shop = (await mine()).find((n) => n.ssid === 'Workshop') as OwnWifi;
    await api.wifiNetworks.setSchedule(shop.id, { enabled: true, days: ['sat'], off: '23:00', on: '09:00' });
    expect(((await mine()).find((n) => n.id === shop.id) as OwnWifi).schedule).toEqual({
      enabled: true,
      days: ['sat'],
      off: '23:00',
      on: '09:00',
    });
    await api.wifiNetworks.setSchedule(shop.id, null);
    expect(((await mine()).find((n) => n.id === shop.id) as OwnWifi).schedule).toBeNull();
  });
});

describe('multi-link (MLO) networks', () => {
  const mlo: OwnWifiInput = { ...input, ssid: 'Wi-Fi 7', bands: ['5g', '6g'], security: 'sae', mlo: true };

  test('the overview says multi-link is possible and on which bands', async () => {
    expect((await api.wifiNetworks.overview()).mlo).toEqual({ supported: true, bands: ['2g', '5g', '6g'], reason: null });
    expect((await mine()).every((n) => !n.mlo)).toBe(true);
  });

  test('create makes one network over its bands, and WPA3 is the default', async () => {
    const { id } = await api.wifiNetworks.create({ ...mlo, security: undefined as never });
    expect((await mine()).find((n) => n.id === id)).toMatchObject({ ssid: 'Wi-Fi 7', mlo: true, bands: ['5g', '6g'], security: 'sae' });
  });

  test('refuses one band and anything but WPA3', async () => {
    const fail = (patch: Partial<OwnWifiInput>) => api.wifiNetworks.create({ ...mlo, ...patch });
    await expect(fail({ bands: ['5g'] })).rejects.toThrow('Multi-link needs at least two bands.');
    await expect(fail({ security: 'sae-mixed' })).rejects.toThrow('Multi-link networks need WPA3.');
  });

  test('an edit can rename and rekey, but not move or reshape', async () => {
    const { id } = await api.wifiNetworks.create(mlo);
    await api.wifiNetworks.update(id, { ssid: 'Wi-Fi 7 Home', password: 'a different one' });
    expect((await mine()).find((n) => n.id === id)).toMatchObject({ ssid: 'Wi-Fi 7 Home', mlo: true });
    await expect(api.wifiNetworks.update(id, { bands: ['5g'] })).rejects.toThrow('can’t change its bands');
    await expect(api.wifiNetworks.update(id, { network: 'main' })).rejects.toThrow('can’t move to another network');
    await expect(api.wifiNetworks.update(id, { security: 'psk2' })).rejects.toThrow('Multi-link networks need WPA3.');
    await api.wifiNetworks.remove(id);
    expect((await mine()).map((n) => n.id)).not.toContain(id);
  });

  test('checkOwnWifi says the same before asking', () => {
    const ok = { ssid: 'Fine', bands: ['5g' as const, '6g' as const], security: 'sae' as const, mlo: true };
    expect(checkOwnWifi(ok)).toBeNull();
    expect(checkOwnWifi({ ...ok, bands: ['5g'] })).toBe('Multi-link needs at least two bands.');
    expect(checkOwnWifi({ ...ok, bands: ['2g', '5g'], security: 'sae-mixed' })).toBe('Multi-link networks need WPA3.');
  });
});

describe('checkOwnWifi', () => {
  const ok = { ssid: 'Fine', bands: ['5g' as const], security: 'sae' as const };
  test('counts the name in bytes and refuses control characters', () => {
    expect(checkOwnWifi(ok)).toBeNull();
    expect(checkOwnWifi({ ...ok, ssid: 'é'.repeat(17) })).toBe('The network name must be 1 to 32 bytes.');
    expect(checkOwnWifi({ ...ok, ssid: 'a\nb' })).toBe('The network name can’t contain control characters.');
  });
  test('checks the password only when given', () => {
    expect(checkOwnWifi({ ...ok, password: 'long enough' })).toBeNull();
    expect(checkOwnWifi({ ...ok, password: 'café au lait' })).toBe(
      'The password can only use plain letters, numbers, spaces and punctuation.',
    );
  });
  test('wants a band, and WPA3 on 6 GHz', () => {
    expect(checkOwnWifi({ ...ok, bands: [] })).toBe('Pick at least one band.');
    expect(checkOwnWifi({ ...ok, bands: ['6g'], security: 'psk2' })).toBe('6 GHz needs WPA3. Choose WPA3, or leave 6 GHz out.');
  });
});

describe('the firmware’s own list', () => {
  test('leaves out networks the agent made', async () => {
    const t = createMockTransport({ latencyMs: 0 });
    const call = t.call.bind(t);
    t.call = async (module, fn, args) => {
      const r = (await call(module, fn, args)) as { res?: { ifaces: { name: string }[] }[] };
      if (module === 'wifi' && fn === 'get_config') r.res?.[0]?.ifaces.push({ name: 'zeeli_kids01_2g', ssid: 'Kids' } as never);
      return r as never;
    };
    const wifi = createRouterApi(t);
    await wifi.session.login('demo');
    expect((await wifi.wifi.list()).map((n) => n.name)).not.toContain('zeeli_kids01_2g');
  });
});
