import { AlertDialog } from 'radix-ui';
import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../lib/errors.ts';

/* ---------- toast ---------- */

interface ToastState {
  id: number;
  message: string;
  undo?: () => Promise<unknown> | unknown;
}
type ShowToast = (message: string, undo?: ToastState['undo']) => void;

/* ---------- confirm ---------- */

interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirm: string;
  /** Destructive actions get a red button. Default true. */
  danger?: boolean;
}
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const FeedbackContext = createContext<{ toast: ShowToast; confirm: Confirm } | null>(null);

export function useFeedback() {
  const ctx = use(FeedbackContext);
  if (!ctx) throw new Error('useFeedback needs <FeedbackProvider>');
  return ctx;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback<ShowToast>((message, undo) => {
    clearTimeout(timer.current);
    setToastState({ id: Date.now(), message, ...(undo ? { undo } : {}) });
    timer.current = setTimeout(() => setToastState(null), undo ? 8000 : 4500);
  }, []);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setDialog(options);
      }),
    [],
  );

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setDialog(null);
  };

  const runUndo = async () => {
    const undo = toastState?.undo;
    setToastState(null);
    if (!undo) return;
    try {
      await undo();
      toast('Undone');
    } catch (err) {
      toast(`Couldn’t undo: ${errorMessage(err)}`);
    }
  };

  return (
    <FeedbackContext value={value}>
      {children}
      <div className={`toast${toastState ? ' show' : ''}`} role="status" aria-live="polite">
        <span>{toastState?.message}</span>
        {toastState?.undo ? (
          <button type="button" onClick={runUndo}>
            Undo
          </button>
        ) : null}
      </div>
      <AlertDialog.Root open={dialog !== null} onOpenChange={(open) => !open && close(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="confirm-scrim" />
          <AlertDialog.Content className="confirm">
            <AlertDialog.Title asChild>
              <h2>{dialog?.title}</h2>
            </AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="confirm-body">{dialog?.body}</div>
            </AlertDialog.Description>
            <div className="confirm-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="btn ghost">
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button type="button" className={`btn ${dialog?.danger === false ? 'strong' : 'danger-solid'}`} onClick={() => close(true)}>
                  {dialog?.confirm}
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </FeedbackContext>
  );
}
