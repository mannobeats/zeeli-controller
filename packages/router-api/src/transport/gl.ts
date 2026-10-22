import { sha256Hex, shaCrypt } from '../crypt.ts';
import { RouterError } from '../errors.ts';
import type { Session, Transport } from './types.ts';

/**
 * GL.iNet firmware 4.x: JSON-RPC at /rpc (oui-httpd), files at /upload and /download,
 * OpenWrt's ubus through LuCI at /cgi-bin/luci/admin/ubus, AdGuard Home at /control/.
 * The session id lives in the same Admin-Token cookie the stock panel uses, so a
 * sign-in in either interface works in both.
 */

const DEFAULT_TIMEOUT = 15_000;
/** LuCI treats the all-zero session id as "use my cookie". */
const LUCI_SID = '0'.repeat(32);
const UBUS_ERRORS = [
  '',
  'Invalid command',
  'Invalid argument',
  'Method not found',
  'Not found',
  'No data',
  'Permission denied',
  'Timed out',
  'Not supported',
  'Unknown error',
  'Connection failed',
];

interface RpcBody<T> {
  jsonrpc?: string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

const cookie = (name: string) =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim() ?? '';

const setSid = (sid: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: the stock panel reads this exact cookie, so a shared sign-in needs it
  document.cookie = `Admin-Token=${sid}; path=/; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`;
};

async function post<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, method: 'POST', signal: ctrl.signal, credentials: 'same-origin' });
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new RouterError('timeout', 'The router took too long to answer.');
    throw new RouterError('offline', 'Can’t reach the router.');
  } finally {
    clearTimeout(timer);
  }
}

export function createGlTransport(base = ''): Transport {
  let id = 0;
  const listeners = new Set<() => void>();
  const sid = () => cookie('Admin-Token');

  async function rpc<T>(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT): Promise<T> {
    const body = await post<RpcBody<T>>(
      `${base}/rpc`,
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      },
      timeoutMs,
    );
    if (body?.jsonrpc !== '2.0') throw new RouterError('failed', 'The router sent an unexpected answer.');
    if (body.error) {
      const { message, data } = body.error;
      if (message === 'Access denied') {
        setSid('');
        for (const fn of listeners) fn();
        throw new RouterError('signedOut', 'Your session ended. Sign in again.', data);
      }
      if (message === 'Login fail number over limit')
        throw new RouterError('tooManyAttempts', 'Too many attempts. Wait a minute, then try again.', data);
      throw new RouterError(body.error.code === -32602 ? 'invalid' : 'failed', message, data);
    }
    const result = body.result as T & { err_code?: number; err_msg?: string };
    if (result && typeof result === 'object' && (result.err_code || result.err_msg))
      throw new RouterError('failed', result.err_msg || `Error ${result.err_code}`, result);
    return result;
  }

  async function ubus<T>(object: string, method: string, args: object = {}, timeoutMs = DEFAULT_TIMEOUT) {
    const body = await post<RpcBody<[number, T?]>>(
      `${base}/cgi-bin/luci/admin/ubus`,
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'call', params: [LUCI_SID, object, method, args] }),
      },
      timeoutMs,
    );
    if (body?.error)
      throw body.error.code === -32002
        ? new RouterError('advancedLocked', 'Advanced settings are locked.')
        : new RouterError('failed', body.error.message);
    const [code = 9, data] = body?.result ?? [];
    if (code !== 0) throw new RouterError('failed', UBUS_ERRORS[code] || `ubus error ${code}`, { code });
    return (data ?? {}) as T;
  }

  const session: Session = {
    signedIn: () => sid() !== '',
    async login(password) {
      const { alg, salt, nonce } = await rpc<{ alg: number; salt: string; nonce: string }>('challenge', {
        username: 'root',
      });
      if (alg !== 5) throw new RouterError('failed', `Sign-in method ${alg} isn’t supported yet.`);
      const hash = await sha256Hex(`root:${await shaCrypt(password, `$5$${salt}$`)}:${nonce}`);
      const { sid: next } = await rpc<{ sid: string }>('login', { username: 'root', hash });
      setSid(next);
    },
    async alive() {
      if (!sid()) return false;
      try {
        await rpc('alive', { sid: sid() });
        return true;
      } catch {
        return false;
      }
    },
    async logout() {
      const current = sid();
      setSid('');
      await rpc('logout', { sid: current }).catch(() => undefined);
    },
    async advancedUnlocked() {
      try {
        const r = await ubus<{ access?: boolean }>('session', 'access', {
          scope: 'uci',
          object: 'firewall',
          function: 'write',
        });
        return Boolean(r.access);
      } catch {
        return false;
      }
    },
    async unlockAdvanced(password) {
      await fetch(`${base}/cgi-bin/luci/`, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ luci_username: 'root', luci_password: password }),
      }).catch(() => undefined);
      return session.advancedUnlocked();
    },
    onSignedOut(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    session,
    call: (module, fn, args = {}, timeoutMs) => rpc('call', [sid(), module, fn, args], timeoutMs),
    ubus,
    async adguard(path, init) {
      const res = await fetch(`${base}/control/${path}`, {
        method: init?.method ?? 'GET',
        credentials: 'same-origin',
        ...(init?.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
      }).catch(() => null);
      if (!res) throw new RouterError('offline', 'Can’t reach AdGuard Home.');
      if (!res.ok) throw new RouterError('failed', `AdGuard Home answered ${res.status}.`);
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as never;
    },
    async upload(path, file, filename) {
      const form = new FormData();
      form.append('sid', sid());
      form.append('size', String(file.size));
      form.append('path', path);
      form.append('file', file, filename);
      const res = await fetch(`${base}/upload`, { method: 'POST', body: form }).catch(() => null);
      if (!res) throw new RouterError('offline', 'Can’t reach the router.');
      if (res.status === 507) throw new RouterError('failed', 'The router doesn’t have room for that file.');
      if (!res.ok) throw new RouterError('failed', `Upload failed (${res.status}).`);
    },
    async download(path, filename) {
      const res = await fetch(`${base}/download`, {
        method: 'POST',
        body: new URLSearchParams({ sid: sid(), path, filename }),
      }).catch(() => null);
      if (!res?.ok) throw new RouterError('failed', 'The router didn’t send the file.');
      return res.blob();
    },
  };
}
