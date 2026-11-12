import { defineConfig } from "@playwright/test";

// รันกับ stack จริง: `docker compose up` ใน Service/ และ `pnpm dev --port 3100` ใน Web/
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  globalSetup: "./global-setup.ts",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.SDES_WEB_URL ?? "http://127.0.0.1:3100",
    // stack production บนเครื่อง dev ใช้ https://localhost กับใบรับรองจาก CA ภายในของ Caddy (phase 4 task 4.1)
    // ฝั่ง Node (global-setup, request) ใช้ NODE_EXTRA_CA_CERTS=<root.crt ของ Caddy> แทนการปิดการตรวจ
    ignoreHTTPSErrors: process.env.SDES_E2E_LOCAL_CA === "1",
    channel: process.env.PW_CHANNEL ?? "msedge",
    viewport: { width: 1366, height: 768 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
