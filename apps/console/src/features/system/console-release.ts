import { useQuery } from '@tanstack/react-query';
import { isDemo } from '../../api/router.ts';

/** This build's version: "1.2.3" from the release workflow, anything else from a working copy. */
export const VERSION: string = import.meta.env.VITE_VERSION;
export const REPO = 'mannobeats/zeeli-controller';

export interface Release {
  tag: string;
  /** What changed, one line per change. */
  changes: string[];
  published: number;
}

const DEMO_RELEASE: Release = {
  tag: 'v0.2.0',
  changes: ['Update the console from System → Firmware', 'Show when a new version is out'],
  published: Date.parse('2026-10-20T12:00:00Z') / 1000,
};

export const parts = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);

/** Whether `tag` is a later release than `current`; a development build is never behind. */
export function newer(tag: string, current: string) {
  const a = parts(tag);
  const b = parts(current);
  if (!a || !b) return false;
  const i = a.findIndex((n, k) => n !== b[k]);
  return i >= 0 && (a[i] as number) > (b[i] as number);
}

async function latestRelease(): Promise<Release | null> {
  if (isDemo) return DEMO_RELEASE;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub didn’t answer (${r.status}). Check again later.`);
  const j = (await r.json()) as { tag_name: string; body?: string; published_at: string };
  return {
    tag: j.tag_name,
    changes: (j.body ?? '')
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2)),
    published: Date.parse(j.published_at) / 1000,
  };
}

export const useRelease = () => useQuery({ queryKey: ['console-release'], queryFn: latestRelease, staleTime: 6 * 3600_000, retry: false });
