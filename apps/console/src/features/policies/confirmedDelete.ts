import { errorMessage } from '../../lib/errors.ts';
import type { useFeedback } from '../../ui/feedback.tsx';

/** Ask first, delete, say so, and explain a failure. Resolves to whether it was deleted. */
export async function confirmedDelete(
  { toast, confirm }: ReturnType<typeof useFeedback>,
  what: string,
  body: string,
  run: () => Promise<unknown>,
  button = 'Delete',
): Promise<boolean> {
  if (!(await confirm({ title: `Delete ${what}?`, body, confirm: button }))) return false;
  try {
    await run();
    toast(`Deleted ${what}`);
    return true;
  } catch (err) {
    toast(`Couldn’t delete: ${errorMessage(err)}`);
    return false;
  }
}
