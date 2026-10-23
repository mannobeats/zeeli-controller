import { isRouterError } from '../errors.ts';
import type { Transport } from '../transport/types.ts';

/** The Zeeli agent itself: the router-side API the console installs with each release. */
export const agent = (t: Transport) => ({
  /** The agent's version, or null on a router installed before the agent existed. */
  version: () =>
    t.zeeli<{ version: string }>('system', 'version').then(
      (r) => r.version,
      (err) => {
        if (isRouterError(err) && err.kind === 'failed') return null;
        throw err;
      },
    ),
  /** Have the router download a console release, check its signature and swap it in. */
  installConsole: (tag: string) => t.zeeli<{ output: string }>('system', 'update', { tag }, 90_000),
});
