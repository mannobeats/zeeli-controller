import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { beforeEach, expect, test, vi } from 'vitest';
import { sshReadonly } from './ssh-readonly.ts';

// stands in for `ssh root@router <cmd>`: records the command, answers with `reply`
const ssh = vi.hoisted(() => ({ commands: [] as string[], reply: '' as string | null, running: 0, peak: 0 }));
vi.mock('node:child_process', () => ({
  execFile: (_bin: string, args: string[], _opts: object, done: (err: Error | null, out: string) => void) => {
    ssh.commands.push(args.at(-1) as string);
    ssh.peak = Math.max(ssh.peak, ++ssh.running);
    setTimeout(() => {
      ssh.running--;
      ssh.reply === null ? done(new Error('ssh failed'), '') : done(null, ssh.reply);
    });
  },
}));

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
const routes = new Map<string, Handler>();
const server = { middlewares: { use: (path: string, fn: Handler) => routes.set(path, fn) } } as unknown as ViteDevServer;
(sshReadonly().configureServer as (s: ViteDevServer) => void)(server);

/** POST `body` to a dev-server route and return the parsed JSON answer. */
async function post(path: string, body: object) {
  const req = new EventEmitter() as IncomingMessage;
  let out = '';
  const res = { setHeader: () => res, end: (s: string) => (out = s) } as unknown as ServerResponse;
  const handled = (routes.get(path) as Handler)(req, res);
  req.emit('data', Buffer.from(JSON.stringify(body)));
  req.emit('end');
  await handled;
  return JSON.parse(out);
}
const rpc = (method: string, params: unknown[] = []) => post('/rpc', { id: 1, method, params });
const ubus = (obj: string, fn: string, args: object = {}) => post('/cgi-bin/luci/admin/ubus', { id: 2, params: ['sid', obj, fn, args] });

beforeEach(() => {
  ssh.commands.length = 0;
  ssh.reply = '{"result":{"ok":true}}';
});

test('sign-in calls answer locally', async () => {
  expect((await rpc('challenge')).result).toEqual({ alg: 5, salt: 'x', nonce: 'x' });
  expect((await rpc('login')).result).toEqual({ sid: 'ssh-readonly' });
  expect((await rpc('alive')).result).toEqual({});
  expect(ssh.commands).toEqual([]);
});

test('GL reads run on the router, writes are refused', async () => {
  expect(await rpc('call', ['sid', 'system', 'get_status'])).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  expect(ssh.commands).toEqual([`ubus call gl-session call '{"module":"system","func":"get_status","params":{}}'`]);
  expect((await rpc('call', ['sid', 'system', 'reboot'])).result.err_code).toBe(-99);
  expect(ssh.commands).toHaveLength(1);
});

test('a failed ssh answers a JSON-RPC error', async () => {
  ssh.reply = null;
  expect((await rpc('call', ['sid', 'system', 'get_info'])).error.message).toBe('ssh failed');
});

test('allowed ubus reads run, quoted; the rest are denied', async () => {
  ssh.reply = '{"values":{}}';
  expect((await ubus('uci', 'get', { config: "it's" })).result).toEqual([0, { values: {} }]);
  expect(ssh.commands).toEqual([`ubus call uci get '{"config":"it'\\''s"}'`]);
  expect((await ubus('uci', 'set')).result).toEqual([6]);
  expect((await ubus('session', 'access')).result).toEqual([0, { access: true }]);
});

test('only the listed commands may be executed', async () => {
  ssh.reply = '{"code":0,"stdout":"x"}';
  const ok = await ubus('file', 'exec', { command: '/sbin/ip', params: ['-4', 'route', 'show', 'table', 'all'] });
  expect(ok.result).toEqual([0, { code: 0, stdout: 'x' }]);
  expect(ssh.commands[0]).toMatch(/^\/sbin\/ip '-4' 'route' 'show' 'table' 'all' 2>\/dev\/null \| lua/);
  expect((await ubus('file', 'exec', { command: '/bin/rm', params: ['-rf', '/'] })).result).toEqual([6]);
  expect((await ubus('file', 'exec', { command: '/usr/libexec/opkg-call' })).result).toEqual([6]);
});

test('a failed ubus read answers code 5', async () => {
  ssh.reply = null;
  expect((await ubus('network.interface', 'dump')).result).toEqual([5]);
});

test('at most three ssh sessions run at once', async () => {
  ssh.peak = 0;
  await Promise.all(Array.from({ length: 5 }, (_, i) => rpc('call', ['sid', 'system', `get_${i}`])));
  expect(ssh.commands).toHaveLength(5);
  expect(ssh.peak).toBe(3);
});

test('cgi-exec runs only the allowed reads and returns their raw output', async () => {
  const exec = async (command: string) => {
    const req = new EventEmitter() as IncomingMessage;
    const res = { statusCode: 0, body: '', end: (s: string) => (res.body = s) };
    const handled = (routes.get('/cgi-bin/cgi-exec') as Handler)(req, res as unknown as ServerResponse);
    req.emit('data', Buffer.from(new URLSearchParams({ sessionid: '', command }).toString()));
    req.emit('end');
    await handled;
    return res;
  };
  ssh.reply = 'Package: iperf3\n';
  expect(await exec('/usr/libexec/opkg-call list-available')).toMatchObject({ statusCode: 200, body: 'Package: iperf3\n' });
  expect(ssh.commands.at(-1)).toBe("/usr/libexec/opkg-call 'list-available'");
  expect(await exec('/usr/libexec/opkg-call install x')).toMatchObject({ statusCode: 403 });
});
