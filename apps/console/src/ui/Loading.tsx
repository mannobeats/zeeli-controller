import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { errorMessage } from '../lib/errors.ts';
import { Button } from './Button.tsx';
import { PageHeader } from './Layout.tsx';

/**
 * The loading, error and ready states every data page shares. Renders `children(data)`
 * once the query has data, and keeps showing old data while a refresh fails.
 */
export function Loaded<T>({ query, title, children }: { query: UseQueryResult<T>; title: string; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError)
    return (
      <>
        <PageHeader title={title} />
        <div className="panel">
          <h2>Couldn’t load this page</h2>
          <p className="kicker">{errorMessage(query.error)}</p>
          <Button onClick={() => query.refetch()}>Try again</Button>
        </div>
      </>
    );
  return (
    <>
      <PageHeader title={title} />
      <output className="panel skeleton" aria-busy="true" aria-label="Loading" />
    </>
  );
}
