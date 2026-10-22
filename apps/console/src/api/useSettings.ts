import { useQuery, useQueryClient } from '@tanstack/react-query';

interface SettingsPair<T> {
  get: () => Promise<T>;
  set: (values: Partial<T>, what?: string) => Promise<T>;
}

/**
 * A page's settings: the query, and a save that writes, verifies the router kept every
 * value (see router-api `settings`) and refreshes the page.
 */
export function useSettings<T>(key: string, pair: SettingsPair<T>) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: [key], queryFn: pair.get });
  const save = async (values: Partial<T>, what?: string) => {
    const kept = await pair.set(values, what);
    qc.setQueryData([key], kept);
    return kept;
  };
  return { query, save };
}
