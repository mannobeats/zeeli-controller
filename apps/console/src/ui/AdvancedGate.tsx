import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api } from '../api/router.ts';
import { Button } from './Button.tsx';
import { TextField } from './fields.tsx';
import { PageHeader } from './Layout.tsx';

/**
 * Pages that edit OpenWrt directly (firewall, routes, leases, packages) need OpenWrt's
 * own session on GL firmware. Sign-in opens it; this asks again only if it expired.
 */
export function AdvancedGate({ title, children }: { title: string; children: ReactNode }) {
  const qc = useQueryClient();
  const unlocked = useQuery({ queryKey: ['advanced-unlocked'], queryFn: api.session.advancedUnlocked, staleTime: 60_000 });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (unlocked.data !== false) return <>{children}</>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!(await api.session.unlockAdvanced(password))) return setError('That password didn’t unlock OpenWrt settings.');
      await qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={title} />
      <form className="panel locked" onSubmit={submit} noValidate>
        <h2>Unlock OpenWrt settings</h2>
        <p className="kicker">
          This page talks to OpenWrt directly, which needs the admin password again. Changes apply with automatic rollback: if the router
          loses contact with this page, it undoes them within 30 seconds.
        </p>
        <TextField label="Admin password" type="password" value={password} onChange={setPassword} autoFocus />
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="strong" busy={busy}>
          Unlock
        </Button>
      </form>
    </>
  );
}
