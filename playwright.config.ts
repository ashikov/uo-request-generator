import process from "node:process";
import { defineConfig } from "@playwright/test";

const artifactDirectory = process.env.PLAYWRIGHT_ARTIFACT_DIRECTORY;
const artifactPath = (directory: string): string =>
  artifactDirectory === undefined ? directory : `${artifactDirectory}/${directory}`;

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: artifactPath("test-results"),
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [
    ["line"],
    ["html", { outputFolder: artifactPath("playwright-report"), open: "never" }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://web:3000",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "mobile-320x568",
      testMatch: "**/responsive-layout.spec.ts",
      use: { viewport: { width: 320, height: 568 } },
    },
    {
      name: "mobile-360x800",
      testMatch: "**/responsive-layout.spec.ts",
      use: { viewport: { width: 360, height: 800 } },
    },
    {
      name: "mobile-390x844",
      testMatch: [
        "**/responsive-layout.spec.ts",
        "**/critical-flow.spec.ts",
        "**/smartcaptcha-dom-capability.spec.ts",
      ],
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "mobile-412x915",
      testMatch: "**/responsive-layout.spec.ts",
      use: { viewport: { width: 412, height: 915 } },
    },
    {
      name: "mobile-landscape-844x390",
      testMatch: "**/responsive-layout.spec.ts",
      use: { viewport: { width: 844, height: 390 } },
    },
    {
      name: "desktop-1280x800",
      testMatch: [
        "**/responsive-layout.spec.ts",
        "**/critical-flow.spec.ts",
        "**/smartcaptcha-dom-capability.spec.ts",
      ],
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
});
