import { IconX } from '@tabler/icons-react';
import { Dialog } from 'radix-ui';
import { type FormEvent, type ReactNode, useState } from 'react';
import { errorMessage } from '../lib/errors.ts';
import { Button } from './Button.tsx';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  /** Primary button label; without `onSave` the sheet is read-only. */
  save?: string;
  /** Return `false` to keep the sheet open (e.g. after a cancelled confirm). */
  onSave?: (form: FormData) => Promise<unknown> | unknown;
  danger?: { label: string; onClick: () => void };
  wide?: boolean;
}

/** Runs `onSave` with the form's data, keeping its error and busy state for the sheet. */
function useSubmit(onSave: Props['onSave'], onOpenChange: Props['onOpenChange']) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!onSave) return;
    setError('');
    setBusy(true);
    try {
      const keep = await onSave(new FormData(e.currentTarget));
      if (keep !== false) onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return { error, setError, busy, submit };
}

/** A side panel that slides in from the right: every edit form in the console. */
export function Sheet({ open, onOpenChange, title, sub, children, save = 'Save', onSave, danger, wide }: Props) {
  const { error, setError, busy, submit } = useSubmit(onSave, onOpenChange);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setError('');
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="scrim open" />
        <Dialog.Content className={`drawer open${wide ? ' wide' : ''}`}>
          <form className="sheet-form" onSubmit={submit} noValidate>
            <div className="drawer-head">
              <div className="titles">
                <Dialog.Title asChild>
                  <h2>{title}</h2>
                </Dialog.Title>
                {sub ? (
                  <Dialog.Description className="where">{sub}</Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{typeof title === 'string' ? title : 'Details'}</Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <button type="button" className="icon-btn" aria-label="Close">
                  <IconX size={18} stroke={1.75} />
                </button>
              </Dialog.Close>
            </div>
            <div className="drawer-body sheet-body">{children}</div>
            {error ? (
              <p className="form-error sheet-err" role="alert">
                {error}
              </p>
            ) : null}
            {onSave || danger ? <Footer save={save} busy={busy} onSave={onSave} danger={danger} /> : null}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Footer({ save, busy, onSave, danger }: Pick<Props, 'onSave' | 'danger'> & { save: string; busy: boolean }) {
  return (
    <div className="drawer-foot">
      {danger ? (
        <Button variant="danger" onClick={danger.onClick}>
          {danger.label}
        </Button>
      ) : null}
      <span className="grow" />
      <Dialog.Close asChild>
        <Button variant="ghost">Cancel</Button>
      </Dialog.Close>
      {onSave ? (
        <Button type="submit" variant="strong" busy={busy}>
          {save}
        </Button>
      ) : null}
    </div>
  );
}
