import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { api } from '../api/router.ts';
import { FeedbackProvider } from '../ui/feedback.tsx';
import { App } from './App.tsx';
import { SECTIONS } from './nav.ts';

const PAGES = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.pages));

beforeAll(async () => {
  await api.session.login('demo');
  // Advanced pages sit behind a second password; unlock them so their content renders.
  await api.session.unlockAdvanced('demo');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </QueryClientProvider>,
  );
});
afterAll(cleanup);

/** Every page in the menu renders against the demo router: a title, no crash, no endless loading. */
describe('every page renders', () => {
  test.each(PAGES.map((p) => [p.id, p.title]))('%s', async (id, title) => {
    location.hash = id;
    await waitFor(
      () => {
        // the hash change lands asynchronously; until the title moves, the previous page is still showing
        expect(document.title).toBe(`${title} · Zeeli Controller`);
        expect(document.querySelector('main h1')).not.toBeNull();
        expect(document.querySelector('main [aria-busy="true"]')).toBeNull();
      },
      { timeout: 4000 },
    );
    expect(screen.queryByText('This page hit a problem')).toBeNull();
    expect(screen.queryByText('Couldn’t load this page')).toBeNull();
  });
});
