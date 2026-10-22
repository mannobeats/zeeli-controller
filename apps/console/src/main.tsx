import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isRouterError } from '@zeeli/router-api';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { applyTheme } from './app/theme.ts';
import { FeedbackProvider } from './ui/feedback.tsx';
import './styles/tokens.css';
import './styles/app.css';
import './styles/console.css';

applyTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // keep showing the last good data while the router is briefly unreachable
      retry: (count, err) => count < 2 && !(isRouterError(err) && err.kind === 'signedOut'),
      refetchOnWindowFocus: true,
      staleTime: 2000,
    },
  },
});

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
