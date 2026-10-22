export type RouterErrorKind = 'offline' | 'timeout' | 'signedOut' | 'tooManyAttempts' | 'advancedLocked' | 'notKept' | 'invalid' | 'failed';

/** Every failure the API raises, with a message written for the person using the app. */
export class RouterError extends Error {
  readonly kind: RouterErrorKind;
  readonly detail: unknown;

  constructor(kind: RouterErrorKind, message: string, detail?: unknown) {
    super(message);
    this.name = 'RouterError';
    this.kind = kind;
    this.detail = detail;
  }
}

export const isRouterError = (e: unknown): e is RouterError => e instanceof RouterError;
