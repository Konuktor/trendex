import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec/, use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'mobile',
      testMatch: /(mobile|final)\.spec/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    // PW_PREVIEW=1 runs the checks against the production build (npm run build first).
    command: process.env.PW_PREVIEW ? 'npx vite preview --port 5173 --strictPort' : 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.PW_PREVIEW,
    timeout: 60_000,
  },
});
