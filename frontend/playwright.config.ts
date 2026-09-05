import { defineConfig, devices } from '@playwright/test'

const temporaryRoot = process.env.PLAYWRIGHT_E2E_TMP_DIR

export default defineConfig({
  testDir: '../tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: temporaryRoot ? `${temporaryRoot}/test-results` : 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
