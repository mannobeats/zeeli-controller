import type { MockState } from './seed.ts';

type Args = Record<string, unknown>;
type Handler = (state: MockState, args: Args, ctx: { uptime: number }) => unknown;

interface Protections {
  safebrowsing: boolean;
  parental: boolean;
  safesearch: Record<string, boolean>;
}

/** AdGuard Home's protection switches, held per mock router like the real one keeps them. */
const protections = (s: MockState): Protections => {
  const found = s.extra.get('adguard-protections') as Protections | undefined;
  if (found) return found;
  const fresh: Protections = {
    safebrowsing: true,
    parental: false,
    safesearch: { enabled: false, bing: true, duckduckgo: true, google: true, pixabay: true, yandex: true, youtube: true },
  };
  s.extra.set('adguard-protections', fresh);
  return fresh;
};

const toggle =
  (key: 'safebrowsing' | 'parental', on: boolean): Handler =>
  (s) => {
    protections(s)[key] = on;
    return {};
  };

export const adguardHandlers: Record<string, Handler> = {
  'adguard:safebrowsing/status': (s) => ({ enabled: protections(s).safebrowsing }),
  'adguard:safebrowsing/enable': toggle('safebrowsing', true),
  'adguard:safebrowsing/disable': toggle('safebrowsing', false),
  'adguard:parental/status': (s) => ({ enabled: protections(s).parental }),
  'adguard:parental/enable': toggle('parental', true),
  'adguard:parental/disable': toggle('parental', false),
  'adguard:safesearch/status': (s) => protections(s).safesearch,
  'adguard:safesearch/settings': (s, a) => {
    protections(s).safesearch = a as Record<string, boolean>;
    return {};
  },
};
