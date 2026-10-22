import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../api/router.ts';
import { navigate } from '../../app/useHashRoute.ts';
import { Button } from '../../ui/Button.tsx';
import { Panel } from '../../ui/Layout.tsx';

/**
 * DNS statistics and the query log come from AdGuard Home; when it's off, say so and
 * offer the way to turn it on, instead of an error from a service that isn't running.
 */
export function WhenAdguardOn({ children }: { children: ReactNode }) {
  // same key as the AdGuard page's settings, so the two pages share one answer
  const state = useQuery({ queryKey: ['adguard'], queryFn: api.dns.adguard.get });
  if (!state.data) return <output className="panel skeleton" aria-busy="true" aria-label="Checking AdGuard Home" />;
  if (state.data.enabled) return <>{children}</>;
  return (
    <Panel title="AdGuard Home is off">
      <p className="kicker">DNS statistics and the live query log come from AdGuard Home. Turn it on to see what devices look up.</p>
      <div className="row-actions start">
        <Button variant="strong" onClick={() => navigate('adguard')}>
          Open AdGuard Home
        </Button>
      </div>
    </Panel>
  );
}
