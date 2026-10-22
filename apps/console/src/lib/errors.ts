/** A message for any thrown value, written for the person using the app. */
export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'Something went wrong.';
