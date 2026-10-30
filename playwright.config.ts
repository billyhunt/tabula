import { defineConfig } from '@playwright/test'

// Drives the built Electron app end to end. Run with `npm run test:e2e`,
// which builds first; vitest never picks these files up. The global setup
// waits for any other desktop suite on this machine (Alethia's included) to
// finish, since two would fight over window focus.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  globalSetup: './e2e/desktopLock.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
})
