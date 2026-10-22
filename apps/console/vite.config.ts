import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';
import { sshReadonly } from './dev/ssh-readonly.ts';

// The router the dev server forwards API calls to. GL.iNet's factory address is 192.168.8.1.
const router = process.env.ROUTER_URL ?? 'https://192.168.8.1';
const forward: ProxyOptions = { target: router, secure: false, changeOrigin: true };
const routerProxy: Record<string, ProxyOptions> = {
  '/rpc': forward,
  '/cgi-bin': forward,
  '/upload': forward,
  '/download': forward,
  '/control': forward,
};

// the demo and the tests run against the in-memory router
const transportFor = (mode: string) => (mode === 'demo' || mode === 'test' ? 'mock' : 'gl');

export default defineConfig(({ mode }) => ({
  // relative, so the same build works under /zeeli/ on a router and on GitHub Pages
  base: './',
  plugins: [react(), ...(process.env.VERIFY_SSH ? [sshReadonly()] : [])],
  define: {
    'import.meta.env.VITE_TRANSPORT': JSON.stringify(transportFor(mode)),
    // set by the release workflow; anything else is a development build
    'import.meta.env.VITE_VERSION': JSON.stringify(process.env.ZEELI_VERSION ?? 'dev'),
  },
  server: {
    port: 4318,
    proxy: mode === 'demo' ? {} : routerProxy,
  },
  build: { target: 'es2023', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    // load the router API from its source path, so coverage counts the calls pages make into it
    alias: { '@zeeli/router-api': fileURLToPath(new URL('../../packages/router-api/src/index.ts', import.meta.url)) },
  },
}));
