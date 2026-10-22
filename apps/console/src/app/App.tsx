import { useQueryClient } from '@tanstack/react-query';
import { Suspense, useEffect, useState } from 'react';
import { api } from '../api/router.ts';
import { PageError } from '../ui/PageError.tsx';
import { Login } from './Login.tsx';
import { pageById } from './nav.ts';
import { PAGE_COMPONENTS } from './pages.tsx';
import { Shell } from './Shell.tsx';
import { useHashRoute } from './useHashRoute.ts';

type Phase = 'checking' | 'signedOut' | 'signedIn';

export function App() {
  const [phase, setPhase] = useState<Phase>(() => (api.session.signedIn() ? 'checking' : 'signedOut'));
  const [message, setMessage] = useState<string>();
  const page = useHashRoute();
  const qc = useQueryClient();

  useEffect(() => {
    if (phase !== 'checking') return;
    let live = true;
    api.session.alive().then((ok) => live && setPhase(ok ? 'signedIn' : 'signedOut'));
    return () => {
      live = false;
    };
  }, [phase]);

  useEffect(
    () =>
      api.session.onSignedOut(() => {
        qc.clear();
        setMessage('Your session ended. Sign in again.');
        setPhase('signedOut');
      }),
    [qc],
  );

  // each page gets its own title, starts at the top, and moves focus for screen readers
  useEffect(() => {
    document.title = `${pageById(page)?.title ?? 'Console'} · Zeeli Controller`;
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [page]);

  if (phase === 'checking') return <div className="boot" aria-busy="true" />;
  if (phase === 'signedOut') return <Login message={message} onSignedIn={() => setPhase('signedIn')} />;

  const Page = PAGE_COMPONENTS[page];
  return (
    <Shell
      page={page}
      onSignOut={async () => {
        await api.session.logout();
        qc.clear();
        setMessage(undefined);
        setPhase('signedOut');
      }}
    >
      <PageError key={page}>
        <Suspense fallback={<div className="page-loading" aria-busy="true" />}>{Page ? <Page /> : null}</Suspense>
      </PageError>
    </Shell>
  );
}
