import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("Bootstrap asset", () => {
  it("отдаёт зафиксированный stylesheet из локального package", async () => {
    const app = createApp();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/vendor/bootstrap/bootstrap.min.css",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/css");
      expect(response.body).toMatch(/Bootstrap\s+v5\.3\.8/);
    } finally {
      await app.close();
    }
  });
});
