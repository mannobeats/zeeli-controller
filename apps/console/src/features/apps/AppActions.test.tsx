import { screen, waitFor } from '@testing-library/react';
import { APP_CATALOG } from '@zeeli/router-api';
import { expect, test } from 'vitest';
import { expectToast, renderPage } from '../../test/render.tsx';
import { RunPanel, WakePanel } from './AppActions.tsx';

const iperf = {
  ...(APP_CATALOG.find((a) => a.id === 'iperf3') as (typeof APP_CATALOG)[number]),
  installed: true,
  running: null,
  versions: {},
};

test('the speed test server starts from its page', async () => {
  const user = await renderPage(<RunPanel app={iperf} />);
  const start = await screen.findByRole('button', { name: 'Start a test server' });
  // enabled once the router confirms the console may run it
  await waitFor(() => expect(start).toHaveProperty('disabled', false));
  await user.click(start);
  await expectToast('Test server ready on port 5201 for one test');
});

test('a sleeping wired device can be woken', async () => {
  const user = await renderPage(<WakePanel />);
  const wake = await screen.findByRole('button', { name: 'Wake' });
  await waitFor(() => expect(wake).toHaveProperty('disabled', false));
  await user.click(wake);
  await expectToast(/^Wake packet sent to /);
});
