import { createGlTransport, createMockTransport, createRouterApi } from '@zeeli/router-api';

/** The demo build talks to an in-memory router; every other build talks to the real one. */
export const isDemo = import.meta.env.VITE_TRANSPORT === 'mock';
export const api = createRouterApi(isDemo ? createMockTransport() : createGlTransport());
