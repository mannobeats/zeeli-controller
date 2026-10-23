import type { Handler } from './handlers.ts';

/** `zeeli.system` on the demo router. */
export const agentSystem: Record<string, Handler> = {
  'zeeli:system.version': () => ({ version: 'demo' }),
  'zeeli:system.update': (_s, a) =>
    /^v\d+\.\d+\.\d+$/.test(String(a.tag))
      ? { output: `Installed Zeeli Controller ${String(a.tag).slice(1)}` }
      : { error: `Not a release: ${a.tag}` },
};
