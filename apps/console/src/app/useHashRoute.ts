import { useSyncExternalStore } from 'react';
import { DEFAULT_PAGE, pageById } from './nav.ts';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const read = () => {
  const id = location.hash.slice(1).split('?')[0] ?? '';
  return pageById(id) ? id : DEFAULT_PAGE;
};

/** Hash routes, so one build works at any path: /zeeli/ on a router, /zeeli-controller/ on Pages. */
export const useHashRoute = () => useSyncExternalStore(subscribe, read, () => DEFAULT_PAGE);
export const navigate = (id: string) => {
  location.hash = id;
};

/** Query part of the hash: `#clients?device=AA:BB…` -> URLSearchParams. */
export const hashParams = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
