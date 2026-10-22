import { type FormEvent, type ReactNode, useState } from 'react';
import { errorMessage } from '../lib/errors.ts';
import { Button } from './Button.tsx';
import { useFeedback } from './feedback.tsx';

/** Form state with a baseline, so Save stays off until something actually changed. */
export function useForm<T extends object>(initial: T) {
  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  return {
    values,
    set: <K extends keyof T>(key: K, value: T[K]) => setValues((v) => ({ ...v, [key]: value })),
    dirty: JSON.stringify(values) !== JSON.stringify(baseline),
    commit: () => setBaseline(values),
  };
}

interface Props {
  title: ReactNode;
  note?: ReactNode;
  form: { dirty: boolean; commit: () => void };
  /** Throw to show an error under the fields. Resolves with the toast message, or false when cancelled. */
  onSave: () => Promise<string | false | undefined>;
  save?: string;
  children: ReactNode;
}

/** A panel that is its own form: the settings pattern on every page. */
export function SettingsForm({ title, note, form, onSave, save = 'Save', children }: Props) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const message = await onSave();
      if (message === false) return;
      form.commit();
      if (message) toast(message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form-panel" onSubmit={submit} noValidate>
      <div className="panel-head">
        <h2>{title}</h2>
        {note ? <span className="note">{note}</span> : null}
      </div>
      <div className="form-body">{children}</div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button type="submit" variant="strong" busy={busy} disabled={!form.dirty}>
          {save}
        </Button>
      </div>
    </form>
  );
}
