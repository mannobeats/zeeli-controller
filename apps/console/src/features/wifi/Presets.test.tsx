import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/router.ts';
import { renderPage, sheet } from '../../test/render.tsx';
import { generatePassword } from './own-form.ts';
import WifiPage from './WifiPage.tsx';
import { WORDS } from './words.ts';

beforeEach(() => api.session.login('demo'));
afterEach(() => {
  vi.restoreAllMocks();
  location.hash = '';
});

const field = (s: Awaited<ReturnType<typeof sheet>>, label: RegExp) => s.getByLabelText(label) as HTMLInputElement;

test('a link opens the add sheet with the network and name filled, then forgets itself', async () => {
  location.hash = '#wifi?create=Lab&ssid=Pool%20house';
  await renderPage(<WifiPage />);
  const s = await sheet();
  expect(field(s, /^Network name/).value).toBe('Pool house');
  expect(field(s, /^Joins network/).value).toBe('Lab');
  expect(location.hash).toBe('#wifi');
});

test('presets fill security, bands, keeping apart and the matching network', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  const s = await sheet();
  const on = (band: RegExp) => field(s, band).checked;

  await user.click(s.getByRole('button', { name: 'Guest' }));
  expect(field(s, /^Joins network/).value).toBe('guest');
  expect(field(s, /^Keep devices apart/).checked).toBe(true);
  expect([on(/^2\.4 GHz/), on(/^5 GHz/), on(/^6 GHz/)]).toEqual([true, true, false]);
  await user.click(s.getByRole('button', { name: 'Daytime 8–22' }));
  expect(field(s, /^Turns off at/).value).toBe('22:00');
  expect(field(s, /^Turns on at/).value).toBe('08:00');

  await user.click(s.getByRole('button', { name: 'IoT' }));
  expect(field(s, /^Joins network/).value).toBe('iot');
  expect(field(s, /^Security/).value).toBe('psk2');
  expect([on(/^2\.4 GHz/), on(/^5 GHz/)]).toEqual([true, false]);
  expect(field(s, /^Keep devices apart/).checked).toBe(false);
  expect(s.queryByRole('button', { name: 'Daytime 8–22' })).toBeNull();

  await user.click(s.getByRole('button', { name: 'Fast' }));
  expect(field(s, /^Security/).value).toBe('sae');
  expect(field(s, /^Multi-link/).checked).toBe(true);

  await user.click(s.getByRole('button', { name: 'Home' }));
  expect(field(s, /^Security/).value).toBe('sae-mixed');
  expect(field(s, /^Multi-link/).checked).toBe(false);
});

test('generates a typeable passphrase and checks the length', async () => {
  expect(new Set(WORDS).size).toBe(256);
  for (let i = 0; i < 20; i++) expect(generatePassword()).toMatch(/^[a-z]+(-[a-z]+){3}-\d{3}$/);
  const user = await renderPage(<WifiPage />);
  await user.click(await screen.findByRole('button', { name: 'Add network' }));
  const s = await sheet();
  await user.click(s.getByRole('button', { name: 'Generate' }));
  const pass = field(s, /^Password/);
  expect(pass.type).toBe('text');
  expect(pass.value.length).toBeGreaterThanOrEqual(8);
  expect(pass.value.length).toBeLessThanOrEqual(63);
  await user.clear(pass);
  await user.type(pass, 'short');
  expect(await s.findByText('A WPA password is 8 to 63 characters.')).toBeTruthy();
});

test('shares a network as a code with the name and password beside it', async () => {
  const user = await renderPage(<WifiPage />);
  await user.click((await screen.findAllByText('Kids', { selector: '.name' }))[0] as HTMLElement);
  await user.click(await screen.findByRole('button', { name: 'Share' }));
  expect(await screen.findByRole('img', { name: 'QR code to join Kids' })).toBeTruthy();
  await waitFor(() => expect(screen.getByText('dino-nuggets-42')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
});
