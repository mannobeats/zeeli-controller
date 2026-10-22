import { screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { confirmDialog, expectToast, renderPage } from '../../test/render.tsx';
import { ConsoleUpdatePanel } from './ConsoleUpdate.tsx';
import { newer } from './console-release.ts';

test('only a later release counts as newer, and a development build is never behind', () => {
  expect(newer('v1.2.10', '1.2.9')).toBe(true);
  expect(newer('v2.0.0', '1.9.9')).toBe(true);
  expect(newer('v1.2.3', '1.2.3')).toBe(false);
  expect(newer('v1.2.3', '1.10.0')).toBe(false);
  expect(newer('v1.2.3', '95ad8ab-dev')).toBe(false);
});

test('a development build can install the latest release after a confirm', async () => {
  const user = await renderPage(<ConsoleUpdatePanel />);
  expect(screen.getByText('Development build dev')).toBeTruthy();
  expect(await screen.findByText(/^0\.2\.0, published/)).toBeTruthy();
  const install = (await screen.findByRole('button', { name: 'Install 0.2.0' })) as HTMLButtonElement;
  // enabled once the router says the console may run its updater
  await waitFor(() => expect(install.disabled).toBe(false));
  await user.click(install);
  await user.click((await confirmDialog()).getByRole('button', { name: 'Install' }));
  await expectToast('Installed 0.2.0. Reloading…');
});
