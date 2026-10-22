// Dev only: `VERIFY_SSH=1 pnpm dev` answers the console's *reads* by running them on
// the router over SSH with your key, and refuses every write. It lets you check pages
// against live data without signing in. Never part of a build.
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const ROUTER = process.env.ROUTER_SSH ?? 'root@192.168.8.1';
const READ_GL = /^(get_|check_|query_)/;
const READ_UBUS: Record<string, string[]> = {
  uci: ['get', 'configs', 'changes'],
  'luci-rpc': ['getDHCPLeases', 'getHostHints', 'getNetworkDevices', 'getBoardJSON'],
  'network.interface': ['dump', 'status'],
  session: ['access'],
};
const READ_EXEC: [string, string][] = [
  ['/sbin/ip', '-4 route show table all'],
  ['/usr/libexec/opkg-call', 'list-installed'],
  ['/usr/libexec/opkg-call', 'list-available'],
];

// dropbear limits concurrent logins, so run at most three at a time
let running = 0;
const waiting: (() => void)[] = [];
const ssh = (cmd: string) =>
  new Promise<string | null>((resolve) => {
    const go = () => {
      running++;
      execFile('ssh', ['-o', 'BatchMode=yes', ROUTER, cmd], { maxBuffer: 64 << 20, timeout: 60_000 }, (err, out) => {
        running--;
        waiting.shift()?.();
        resolve(err ? null : out);
      });
    };
    if (running < 3) go();
    else waiting.push(go);
  });
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const readBody = (req: IncomingMessage) =>
  new Promise<{ id?: number; method?: string; params?: unknown[] }>((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c;
    });
    req.on('end', () => resolve(JSON.parse(data || '{}')));
  });
const send = (res: ServerResponse, obj: unknown) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
};

export function sshReadonly(): Plugin {
  return {
    name: 'zeeli-ssh-readonly',
    configureServer(server) {
      server.middlewares.use('/rpc', async (req, res) => {
        const { id, method, params = [] } = await readBody(req);
        const ok = (result: unknown) => send(res, { jsonrpc: '2.0', id, result });
        if (method === 'challenge') return ok({ alg: 5, salt: 'x', nonce: 'x' });
        if (method === 'login') return ok({ sid: 'ssh-readonly' });
        if (method === 'alive' || method === 'logout') return ok({});
        const [, mod, fn, args = {}] = params as [string, string, string, object?];
        if (!READ_GL.test(fn)) return ok({ err_code: -99, err_msg: 'Read-only verify mode: writes are blocked' });
        const out = await ssh(`ubus call gl-session call ${quote(JSON.stringify({ module: mod, func: fn, params: args }))}`);
        send(
          res,
          out ? { jsonrpc: '2.0', id, ...JSON.parse(out) } : { jsonrpc: '2.0', id, error: { code: -32000, message: 'ssh failed' } },
        );
      });
      server.middlewares.use('/cgi-bin/luci/admin/ubus', async (req, res) => {
        const { id, params = [] } = await readBody(req);
        const [, obj, fn, args = {}] = params as [string, string, string, { command?: string; params?: string[] }?];
        const ok = (result: unknown) => send(res, { jsonrpc: '2.0', id, result });
        let allowed = READ_UBUS[obj]?.includes(fn) ?? false;
        if (obj === 'file' && fn === 'exec')
          allowed = READ_EXEC.some(([c, p]) => c === args.command && p === (args.params ?? []).join(' '));
        if (!allowed) return ok([6]);
        if (obj === 'session') return ok([0, { access: true }]);
        const cmd =
          obj === 'file'
            ? `${args.command} ${(args.params ?? []).map(quote).join(' ')} 2>/dev/null | lua -e 'print(require("luci.jsonc").stringify({code=0,stdout=io.read("*a")}))'`
            : `ubus call ${obj} ${fn} ${quote(JSON.stringify(args))}`;
        const out = await ssh(cmd);
        ok(out ? [0, JSON.parse(out)] : [5]);
      });
    },
  };
}
