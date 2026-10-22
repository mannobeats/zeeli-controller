import { IconRouter } from '@tabler/icons-react';
import { type FormEvent, useState } from 'react';
import { api, isDemo } from '../api/router.ts';
import { errorMessage } from '../lib/errors.ts';
import { Button } from '../ui/Button.tsx';
import { TextField } from '../ui/fields.tsx';

export function Login({ onSignedIn, message }: { onSignedIn: () => void; message?: string }) {
  const [password, setPassword] = useState(isDemo ? 'demo' : '');
  const [error, setError] = useState(message ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) return setError('Enter the admin password.');
    setBusy(true);
    setError('');
    try {
      await api.session.login(password);
      // OpenWrt settings (firewall, routes, packages) need their own session on GL firmware.
      await api.session.unlockAdvanced(password).catch(() => false);
      onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-form" onSubmit={submit} noValidate>
        <IconRouter className="login-logo" size={36} stroke={1.75} />
        <h1>Sign in to your router</h1>
        {isDemo ? <p className="kicker">This is the demo. It runs a pretend router in your browser; the password is filled in.</p> : null}
        <TextField label="Admin password" type="password" value={password} onChange={setPassword} autoFocus required />
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="strong" busy={busy}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
