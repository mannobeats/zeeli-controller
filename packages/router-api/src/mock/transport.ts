import { RouterError } from '../errors.ts';
import type { Session, Transport } from '../transport/types.ts';
import { handlers } from './handlers.ts';
import { type MockState, seed } from './seed.ts';

/**
 * An in-memory router for the demo and for tests. Reads come from a seeded home
 * network; writes change that state, so every flow can be tried without hardware.
 * Calls without a handler answer `{}` for reads and succeed for writes.
 */
export function createMockTransport(options: { latencyMs?: number; password?: string } = {}): Transport {
  const { latencyMs = 120, password = 'demo' } = options;
  const state: MockState = seed();
  const started = Date.now();
  // The demo remembers its sign-in for the tab, so a reload doesn't bounce you to sign-in.
  const memory = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  const KEY = 'zeeli-demo-session';
  let signedIn = memory?.getItem(KEY) === '1';
  const setSignedIn = (on: boolean) => {
    signedIn = on;
    on ? memory?.setItem(KEY, '1') : memory?.removeItem(KEY);
  };
  let advanced = false;
  const listeners = new Set<() => void>();
  const wait = () => new Promise((r) => setTimeout(r, latencyMs * (0.5 + Math.random())));

  const session: Session = {
    signedIn: () => signedIn,
    async login(pw) {
      await wait();
      if (pw !== password) throw new RouterError('failed', 'That password isn’t right. The demo password is “demo”.');
      setSignedIn(true);
    },
    alive: async () => signedIn,
    async logout() {
      setSignedIn(false);
      for (const fn of listeners) fn();
    },
    advancedUnlocked: async () => advanced,
    async unlockAdvanced(pw) {
      advanced = pw === password;
      return advanced;
    },
    onSignedOut(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  const guard = () => {
    if (!signedIn) throw new RouterError('signedOut', 'Your session ended. Sign in again.');
  };

  return {
    session,
    async call<T>(module: string, fn: string, args: object = {}) {
      await wait();
      guard();
      const h = handlers[`${module}.${fn}`];
      if (h) return h(state, args as Record<string, unknown>, { uptime: (Date.now() - started) / 1000 }) as T;
      return {} as T;
    },
    async ubus<T>(object: string, method: string, args: object = {}) {
      await wait();
      guard();
      if (!advanced) throw new RouterError('advancedLocked', 'Advanced settings are locked.');
      const h = handlers[`ubus:${object}.${method}`];
      return (h ? h(state, args as Record<string, unknown>, { uptime: 0 }) : {}) as T;
    },
    async execDirect(command, params = []) {
      const r = (await this.ubus('file', 'exec', { command, params })) as { stdout?: string };
      return r.stdout ?? '';
    },
    async adguard<T>(path: string, init?: { body?: unknown }) {
      await wait();
      guard();
      const h = handlers[`adguard:${path.split('?')[0]}`];
      return (h ? h(state, (init?.body ?? {}) as Record<string, unknown>, { uptime: 0 }) : {}) as T;
    },
    async upload() {
      await wait();
      guard();
    },
    async download(_path, filename) {
      await wait();
      guard();
      return new Blob([`# ${filename} from the Zeeli demo router\n`], { type: 'text/plain' });
    },
  };
}
