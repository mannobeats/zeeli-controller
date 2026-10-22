import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { renderPage } from '../test/render.tsx';
import { Login } from './Login.tsx';

const password = () => screen.getByLabelText(/^Admin password/);
const signIn = () => screen.getByRole('button', { name: 'Sign in' });

test('shows why the session ended and asks for a password', async () => {
  const onSignedIn = vi.fn();
  const user = await renderPage(<Login onSignedIn={onSignedIn} message="Your session ended. Sign in again." />);
  expect(screen.getByRole('alert').textContent).toBe('Your session ended. Sign in again.');
  await user.clear(password());
  await user.click(signIn());
  expect(screen.getByRole('alert').textContent).toBe('Enter the admin password.');
  expect(onSignedIn).not.toHaveBeenCalled();
});

test('a wrong password is refused, the demo password signs in', async () => {
  const onSignedIn = vi.fn();
  const user = await renderPage(<Login onSignedIn={onSignedIn} />);
  expect((password() as HTMLInputElement).value).toBe('demo');
  await user.type(password(), 'x');
  await user.click(signIn());
  expect((await screen.findByRole('alert')).textContent).toMatch('That password isn’t right');
  await user.clear(password());
  await user.type(password(), 'demo');
  await user.click(signIn());
  await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
});
