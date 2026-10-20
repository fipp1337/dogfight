import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:48123", headless: true },
  webServer: {
    command: `"${process.execPath}" server/dist/index.js`,
    port: 48123,
    env: {
      PORT: "48123",
      ALLOWED_ORIGINS:
        "http://localhost:48123,http://127.0.0.1:48123,http://localhost:5173,http://127.0.0.1:5173",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
