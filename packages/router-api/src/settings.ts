import type { Transport } from './transport/types.ts';
import { writeAndVerify } from './verify.ts';

const norm = (v: unknown) => (v === true ? 1 : v === false ? 0 : v);

/**
 * Did the router keep `written`? Firmware echoes numbers back as strings and booleans
 * as 0/1, so compare by meaning. A key the router doesn't echo at all can't be judged
 * and counts as kept.
 */
export function sameValue(written: unknown, current: unknown): boolean {
  if (current === undefined) return true;
  if (Array.isArray(written) && Array.isArray(current))
    return written.length === current.length && written.every((x, i) => sameValue(x, current[i]));
  if (written && current && typeof written === 'object' && typeof current === 'object')
    return Object.entries(written).every(([k, v]) => sameValue(v, (current as Record<string, unknown>)[k]));
  return String(norm(written)) === String(norm(current));
}

interface Options<T> {
  get?: string;
  set?: string;
  timeoutMs?: number;
  /** Keys the router never echoes back (passwords, one-shot actions). */
  writeOnly?: (keyof T)[];
}

/**
 * A module's get/set settings pair. `set` sends only what you pass, then reads the
 * settings back and fails if any written value didn't stick.
 */
export function settings<T extends object>(t: Transport, module: string, options: Options<T> = {}) {
  const { get = 'get_config', set = 'set_config', timeoutMs = 30_000, writeOnly = [] } = options;
  const read = () => t.call<T>(module, get);
  return {
    get: read,
    set: (values: Partial<T>, what?: string) =>
      writeAndVerify(
        () => t.call(module, set, values, timeoutMs),
        read,
        (current) =>
          Object.entries(values).every(
            ([k, v]) => writeOnly.includes(k as keyof T) || sameValue(v, (current as Record<string, unknown>)[k]),
          ),
        what,
      ),
  };
}
