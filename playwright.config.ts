import { defineConfig } from '@playwright/test';

// The app runs exactly as in production, but OpenRouter is replaced by a local fake.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 1280, height: 820 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'node tests/e2e/fake-openrouter.mjs', url: 'http://localhost:4100/calls', reuseExistingServer: false },
    {
      command: 'npx vite build && npx tsx server/index.ts',
      url: 'http://localhost:3100/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        OPENROUTER_BASE_URL: 'http://localhost:4100',
        OPENROUTER_API_KEY: 'test-key',
        ENGINE_BUDGET_MS: '250',
        JEV_TIMEOUT_MS: '3000',
      },
    },
  ],
});
