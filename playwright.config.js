import { defineConfig, devices } from '@playwright/test';

/* Service workers need a real server, not file://. Python's built-in server is
   already on the Mac, so this adds no dependency. */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8123',
    viewport: { width: 390, height: 844 },
  },
  projects: [
    { name: 'webkit', use: { ...devices['iPhone 13'] } },   // closest to her iPhone
    { name: 'chromium', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    command: 'python3 -m http.server 8123 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8123/index.html',
    reuseExistingServer: true,
    timeout: 20000,
  },
});
