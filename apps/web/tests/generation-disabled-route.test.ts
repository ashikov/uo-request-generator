import type { LlmGateway } from "@uo-request-generator/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { GenerationLogEvent } from "../src/generation-log.js";
import { GenerationRateLimiter } from "../src/generation-rate-limiter.js";
import { GenerationSafeguard } from "../src/generation-safeguard.js";

const rateLimitConfig = {
  ipRequestLimit: 100,
  ipWindowMs: 60_000,
  clientDailyLimit: 100,
  cookieSecret: "test-cookie-signing-secret-32-characters",
  trustedProxies: [],
  stateCapacity: 1_000,
} as const;

const disabledSafeguardConfig = {
  enabled: false,
  dailyLimit: 100,
  concurrencyLimit: 10,
} as const;

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("отключённая генерация POST /api/generate", () => {
  it("отклоняет невалидный payload до обработки и сохраняет только metadata-only events", async () => {
    const payloadMarker = "private-disabled-payload-marker";
    const captchaToken = "private-disabled-captcha-token";
    const serverKey = "private-disabled-server-key";
    const clientId = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    const gateway: LlmGateway = { generateRequest: vi.fn() };
    const limiter = new GenerationRateLimiter(rateLimitConfig);
    const safeguard = new GenerationSafeguard(disabledSafeguardConfig);
    const verify = vi.fn();
    const events: GenerationLogEvent[] = [];
    const acquireRateLimit = vi.spyOn(limiter, "acquire");
    const acquireSafeguard = vi.spyOn(safeguard, "acquire");
    const app = createApp({
      llmGateway: gateway,
      generationRateLimitConfig: rateLimitConfig,
      generationRateLimiter: limiter,
      generationSafeguard: safeguard,
      generateGenerationClientId: clientId,
      smartCaptchaConfig: {
        mode: "required",
        clientKey: "test-public-client-key",
        serverKey,
      },
      smartCaptchaVerifier: { verify },
      writeGenerationEvent: (event) => {
        events.push(event);
      },
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/generate",
      headers: { "content-type": "application/json" },
      remoteAddress: "198.51.100.11",
      payload: { description: "too short", captchaToken, payloadMarker },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "generation_unavailable",
        message: "Генерация временно недоступна. Попробуйте позже",
        requestId: expect.any(String),
      },
    });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(clientId).not.toHaveBeenCalled();
    expect(acquireRateLimit).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(acquireSafeguard).not.toHaveBeenCalled();
    expect(gateway.generateRequest).not.toHaveBeenCalled();
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(payloadMarker);
    expect(JSON.stringify(events)).not.toContain(captchaToken);
    expect(JSON.stringify(events)).not.toContain(serverKey);
    expect(JSON.stringify(events)).not.toContain("198.51.100.11");
  });
});
