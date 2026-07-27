import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /api/captcha/config", () => {
  it("возвращает только required=false в отключённом режиме", async () => {
    const app = createApp({
      smartCaptchaConfig: { mode: "disabled" },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/captcha/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ required: false });
  });

  it("возвращает только required и клиентский ключ в обязательном режиме", async () => {
    const serverKey = "test-private-server-key";
    const app = createApp({
      smartCaptchaConfig: {
        mode: "required",
        clientKey: "test-public-client-key",
        serverKey,
      },
      smartCaptchaVerifier: {
        verify: async () => ({ status: "verified" }),
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/captcha/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      required: true,
      clientKey: "test-public-client-key",
    });
    expect(response.body).not.toContain(serverKey);
  });
});
