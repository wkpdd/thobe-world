// End-to-end: a real browser plays the customer, H47 Pay's own website client
// (test/newstore/site.ts, vendored from NewStore) plays the shop.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  globalSetup: './test/e2e/global-setup.js',
  fullyParallel: false,
  workers: 1, // one shop, one store: the scenarios share its orders and stock on purpose
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8099',
    locale: 'ar-DZ',
    trace: 'off',
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}),
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] }, testIgnore: /desktop/u },
    { name: 'desktop', use: { viewport: { width: 1366, height: 900 } }, testMatch: /desktop|storefront/u },
  ],
});
