import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'zeeli-theme';
const listeners = new Set<() => void>();

const stored = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
};
const system = (): Theme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const current = () => stored() ?? system();

export function applyTheme() {
  const t = stored();
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

export function toggleTheme() {
  try {
    localStorage.setItem(KEY, current() === 'dark' ? 'light' : 'dark');
  } catch {
    // private mode: the toggle still applies for this page view
  }
  applyTheme();
  for (const fn of listeners) fn();
}

export const useTheme = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const mq = matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', cb);
      return () => {
        listeners.delete(cb);
        mq.removeEventListener('change', cb);
      };
    },
    current,
    () => 'light' as Theme,
  );
