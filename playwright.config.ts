import { defineConfig } from "@playwright/test";

export const TEST_DB = "postgres://postgres:devpass@localhost:54329/attendance";
const PORT = 3217;

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: TEST_DB,
      SESSION_SECRET: "test-only-secret-test-only-secret-test-only",
      INSECURE_COOKIES: "1",
    },
  },
});
