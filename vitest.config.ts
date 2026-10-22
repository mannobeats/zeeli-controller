import { defineConfig } from 'vitest/config';

// One run over every package, so coverage (which fallow reads for CRAP scores) is one report.
export default defineConfig({
  test: {
    projects: ['packages/router-api', 'apps/console'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}', 'apps/*/dev/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/test/**'],
      reporter: ['json', 'text-summary'],
    },
  },
});
