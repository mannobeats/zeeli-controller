import { useState } from 'react';

/**
 * Keeps the last `size` samples of a polled value. A new sample is taken each time
 * `at` changes (a query's dataUpdatedAt), so history follows the router's answers.
 * Uses React's "adjust state while rendering" pattern rather than an effect.
 */
export function useSamples<T>(value: T | undefined, at: number, size = 60): T[] {
  const [state, setState] = useState<{ at: number; list: T[] }>({ at: 0, list: [] });
  if (value !== undefined && at && state.at !== at) setState({ at, list: [...state.list.slice(-(size - 1)), value] });
  return state.list;
}
