import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { RouterError } from '../errors.ts';
import { createGlTransport } from './gl.ts';

// Node has no document or location; the transport only needs the cookie string and the protocol.
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('document', { cookie: 'Admin-Token=abc' });
  vi.stubGlobal('location', { protocol: 'https:' });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/** The next fetch answers with this JSON body (and status). */
const answer = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => (body === '' ? '' : JSON.stringify(body)),
    blob: async () => new Blob(['x']),
  });
const rpcError = (message: string, code = -32000) => answer({ jsonrpc: '2.0', error: { code, message } });
const sentBody = (n = 0) => JSON.parse(fetchMock.mock.calls[n]?.[1].body as string);
const kindOf = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: RouterError) => e.kind,
  );

test('call sends the session id and returns the result', async () => {
  answer({ jsonrpc: '2.0', result: { up: true } });
  const t = createGlTransport('/base');
  expect(await t.call('system', 'get_info')).toEqual({ up: true });
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/base/rpc');
  expect(sentBody().params).toEqual(['abc', 'system', 'get_info', {}]);
});

test('rpc errors map to router error kinds', async () => {
  const t = createGlTransport();
  answer({ nope: true });
  expect(await kindOf(t.call('a', 'b'))).toBe('failed');
  rpcError('Login fail number over limit');
  expect(await kindOf(t.call('a', 'b'))).toBe('tooManyAttempts');
  rpcError('bad params', -32602);
  expect(await kindOf(t.call('a', 'b'))).toBe('invalid');
  rpcError('boom');
  expect(await kindOf(t.call('a', 'b'))).toBe('failed');
});

test('a firmware err_code in the result is an error', async () => {
  const t = createGlTransport();
  answer({ jsonrpc: '2.0', result: { err_code: -1 } });
  await expect(t.call('a', 'b')).rejects.toThrow('Error -1');
  answer({ jsonrpc: '2.0', result: { err_msg: 'busy' } });
  await expect(t.call('a', 'b')).rejects.toThrow('busy');
});

test('access denied signs out and tells listeners', async () => {
  const t = createGlTransport();
  const heard = vi.fn();
  t.session.onSignedOut(heard);
  rpcError('Access denied');
  expect(await kindOf(t.call('a', 'b'))).toBe('signedOut');
  expect(heard).toHaveBeenCalledOnce();
  expect(document.cookie).toContain('Admin-Token=;');
  expect(document.cookie).toContain('Secure');
});

test('network failures and timeouts', async () => {
  const t = createGlTransport();
  fetchMock.mockRejectedValueOnce(new TypeError('down'));
  expect(await kindOf(t.call('a', 'b'))).toBe('offline');
  fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
  expect(await kindOf(t.call('a', 'b'))).toBe('timeout');
});

test('ubus returns data, or an empty object when there is none', async () => {
  const t = createGlTransport();
  answer({ jsonrpc: '2.0', result: [0, { values: 1 }] });
  expect(await t.ubus('uci', 'get', { config: 'network' })).toEqual({ values: 1 });
  expect(sentBody().params.slice(1)).toEqual(['uci', 'get', { config: 'network' }]);
  answer({ jsonrpc: '2.0', result: [0] });
  expect(await t.ubus('uci', 'commit')).toEqual({});
});

test('ubus error codes', async () => {
  const t = createGlTransport();
  answer({ jsonrpc: '2.0', result: [6] });
  await expect(t.ubus('uci', 'set')).rejects.toThrow('Permission denied');
  answer({ jsonrpc: '2.0', result: [42] });
  await expect(t.ubus('uci', 'set')).rejects.toThrow('ubus error 42');
  answer({ jsonrpc: '2.0' });
  await expect(t.ubus('uci', 'set')).rejects.toThrow('Unknown error');
  rpcError('Access denied', -32002);
  expect(await kindOf(t.ubus('uci', 'set'))).toBe('advancedLocked');
  rpcError('nope');
  await expect(t.ubus('uci', 'set')).rejects.toThrow('nope');
});

test('adguard sends JSON bodies and parses answers', async () => {
  const t = createGlTransport();
  answer({ enabled: true });
  expect(await t.adguard('status')).toEqual({ enabled: true });
  expect(fetchMock.mock.calls[0]?.[1].method).toBe('GET');
  answer('');
  expect(await t.adguard('dns_config', { method: 'POST', body: { x: 1 } })).toEqual({});
  expect(fetchMock.mock.calls[1]?.[1].body).toBe('{"x":1}');
});

test('adguard failures', async () => {
  const t = createGlTransport();
  answer({}, 500);
  await expect(t.adguard('status')).rejects.toThrow('AdGuard Home answered 500.');
  fetchMock.mockRejectedValueOnce(new TypeError('down'));
  expect(await kindOf(t.adguard('status'))).toBe('offline');
});

test('alive and logout', async () => {
  const t = createGlTransport();
  answer({ jsonrpc: '2.0', result: {} });
  expect(await t.session.alive()).toBe(true);
  rpcError('expired');
  expect(await t.session.alive()).toBe(false);
  answer({ jsonrpc: '2.0', result: {} });
  await t.session.logout();
  expect(t.session.signedIn()).toBe(false);
  expect(await t.session.alive()).toBe(false);
});

test('login refuses unknown hash methods', async () => {
  answer({ jsonrpc: '2.0', result: { alg: 1, salt: 's', nonce: 'n' } });
  await expect(createGlTransport().session.login('pw')).rejects.toThrow('Sign-in method 1');
});

test('login stores the new session id', async () => {
  answer({ jsonrpc: '2.0', result: { alg: 5, salt: 'salt', nonce: 'nonce' } });
  answer({ jsonrpc: '2.0', result: { sid: 'fresh' } });
  await createGlTransport().session.login('pw');
  expect(sentBody(1).params.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(document.cookie).toContain('Admin-Token=fresh');
});

test('unlocking Advanced posts to LuCI and checks access', async () => {
  const t = createGlTransport();
  answer('');
  answer({ jsonrpc: '2.0', result: [0, { access: true }] });
  expect(await t.session.unlockAdvanced('pw')).toBe(true);
  answer({ jsonrpc: '2.0', result: [6] });
  expect(await t.session.advancedUnlocked()).toBe(false);
});

test('upload and download', async () => {
  const t = createGlTransport();
  answer({});
  await t.upload('/tmp/fw.bin', new Blob(['x']), 'fw.bin');
  answer({}, 507);
  await expect(t.upload('/tmp/fw.bin', new Blob(['x']), 'fw.bin')).rejects.toThrow('doesn’t have room');
  answer({}, 500);
  await expect(t.upload('/tmp/fw.bin', new Blob(['x']), 'fw.bin')).rejects.toThrow('Upload failed (500).');
  answer({});
  expect(await t.download('/tmp/backup.tar.gz', 'backup.tar.gz')).toBeInstanceOf(Blob);
  answer({}, 404);
  await expect(t.download('/x', 'x')).rejects.toThrow('didn’t send the file');
});
