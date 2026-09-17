import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), "../public");
const faviconPath = "/favicon.svg";

describe("favicon", () => {
  it("подключён в HTML и отдаётся приложением", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");
    const app = createApp();

    try {
      expect(html).toContain(`<link rel="icon" href="${faviconPath}" type="image/svg+xml" />`);

      const response = await app.inject({ method: "GET", url: faviconPath });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("image/svg+xml");
    } finally {
      await app.close();
    }
  });
});
