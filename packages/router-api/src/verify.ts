import { RouterError } from './errors.ts';

/**
 * Write, then read the setting back and confirm the router kept it. Firmware often
 * answers "ok" to a value it silently ignores (an unsupported option, a clamped
 * number); this turns that into an error the person sees instead of a false "Saved".
 */
export async function writeAndVerify<T>(
  write: () => Promise<unknown>,
  read: () => Promise<T>,
  kept: (current: T) => boolean,
  what = 'that setting',
): Promise<T> {
  await write();
  const current = await read();
  if (!kept(current)) throw new RouterError('notKept', `The router didn’t keep ${what}.`, current);
  return current;
}
