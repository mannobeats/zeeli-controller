import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, expect } from 'vitest';
import { api } from '../api/router.ts';
import { FeedbackProvider } from '../ui/feedback.tsx';

// globals are off, so Testing Library can't register its own cleanup
afterEach(cleanup);
// tests read the demo router through `api` before rendering, too
beforeAll(() => api.session.login('demo'));
// the shared demo router answers after ~120 ms, and a save is a write, a read-back and a refetch
configure({ asyncUtilTimeout: 3000 });

let client = new QueryClient();

/** Render one page against the demo router, signed in and with Advanced unlocked. */
export async function renderPage(ui: ReactElement) {
  await api.session.login('demo');
  await api.session.unlockAdvanced('demo');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <FeedbackProvider>{ui}</FeedbackProvider>
    </QueryClientProvider>,
  );
  return user;
}

/** Wait until no query is loading, e.g. before acting on data a sheet fetches itself. */
export const settled = () => waitFor(() => expect(client.isFetching()).toBe(0));

/** Wait for the toast to say `text`. */
export const expectToast = (text: string | RegExp, timeout?: number) =>
  waitFor(() => expect(screen.getByRole('status').textContent).toMatch(text), { timeout });

/** OpenWrt changes (firewall, routes, pauses) wait 2.5 s for the router to confirm before they report. */
export const expectApplied = (text: string | RegExp) => expectToast(text, 6000);
/** Test timeout for tests that apply OpenWrt changes, which really wait out that confirm. */
export const APPLYING = 15_000;

/** The open side sheet (or confirm dialog), to query inside it. */
export const sheet = async () => within(await screen.findByRole('dialog'));
export const confirmDialog = async () => within(await screen.findByRole('alertdialog'));
