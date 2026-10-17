import { defineConfig } from '@playwright/test'

// Drives the built Electron app end to end. Run with `npm run test:e2e`,
// which builds first; vitest never picks these files up.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
})
