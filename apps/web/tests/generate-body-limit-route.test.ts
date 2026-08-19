import type { LlmGateway } from "@uo-request-generator/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { generateRequestBodyLimitBytes } from "../src/generation-http-contract.js";
import type { GenerationLogEvent } from "../src/generation-log.js";
import { GenerationRateLimiter } from "../src/generation-rate-limiter.js";
import { GenerationSafeguard } from "../src/generation-safeguard.js";

const expectedGenerateBodyLimitBytes = 45_635;
const oversizedSentinel = "oversized-sensitive-sentinel";
const generatedOutcome = {
  status: "generated" as const,
  result: { title: "Тест", body: "Обезличенный результат", warnings: [] },
};
const generationRateLimitConfig = {
  ipRequestLimit: 100,
  ipWindowMs: 60_000,
  clientDailyLimit: 100,
  cookieSecret: "test-cookie-signing-secret-32-characters",
  trustedProxies: [],
  stateCapacity: 1_000,
} as const;

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createObservedApp() {
  const rateLimiter = new GenerationRateLimiter(generationRateLimitConfig);
  const rateLimiterAcquire = vi.spyOn(rateLimiter, "acquire");
  const captchaVerify = vi.fn().mockResolvedValue({ status: "verified" as const });
  const safeguard = new GenerationSafeguard({
    enabled: true,
    dailyLimit: 100,
    concurrencyLimit: 100,
  });
  const safeguardAcquire = vi.spyOn(safeguard, "acquire");
  const generateRequest = vi
    .fn<LlmGateway["generateRequest"]>()
    .mockResolvedValue(generatedOutcome);
  const generateRequestWithMetadata = vi
    .fn<NonNullable<LlmGateway["generateRequestWithMetadata"]>>()
    .mockResolvedValue({
      status: "success",
      outcome: generatedOutcome,
      metadata: {
        provider: "test-provider",
        model: "test-model",
        usage: null,
        usageStatus: "missing",
        systemPromptHash: "a".repeat(64),
        durationMs: 1,
      },
    });
  const events: GenerationLogEvent[] = [];
  const app = createApp({
    llmGateway: { generateRequest, generateRequestWithMetadata },
    generationRateLimitConfig,
    generationRateLimiter: rateLimiter,
    generationSafeguard: safeguard,
    smartCaptchaConfig: {
      mode: "required",
      clientKey: "test-client-key",
      serverKey: "test-server-key",
    },
    smartCaptchaVerifier: { verify: captchaVerify },
    writeGenerationEvent: (event) => {
      events.push(event);
    },
  });
  apps.push(app);

  return {
    app,
    events,
    rateLimiterAcquire,
    captchaVerify,
    safeguardAcquire,
    generateRequest,
    generateRequestWithMetadata,
  };
}

function injectRawJson(app: ReturnType<typeof createApp>, payload: string) {
  return app.inject({
    method: "POST",
    url: "/api/generate",
    headers: { "content-type": "application/json" },
    payload,
  });
}

function expectRequestId(response: { headers: Record<string, unknown>; json: () => unknown }) {
  const requestId = response.headers["x-request-id"];
  expect(requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(response.json()).toMatchObject({ error: { requestId } });
  return requestId;
}

describe("body limit POST /api/generate", () => {
  it("выводит byte limit из полного входного контракта и служебного запаса", () => {
    expect(generateRequestBodyLimitBytes).toBe(expectedGenerateBodyLimitBytes);
  });

  it("пропускает реалистичный максимальный продуктовый payload в handler", async () => {
    const observed = createObservedApp();
    const payload = {
      description: "Ж".repeat(2_000),
      location: "Ж".repeat(120),
      consequences: "Ж".repeat(500),
      desiredActions: "Ж".repeat(500),
      confirmedProblemSubject: "common_area_premises_lighting",
      captchaToken: "Ж".repeat(4_096),
    };
    const serializedPayload = JSON.stringify(payload);

    expect(Buffer.byteLength(serializedPayload)).toBeLessThan(expectedGenerateBodyLimitBytes);
    const response = await injectRawJson(observed.app, serializedPayload);

    expect(response.statusCode).toBe(200);
    expect(observed.rateLimiterAcquire).toHaveBeenCalledOnce();
    expect(observed.captchaVerify).toHaveBeenCalledOnce();
    expect(observed.safeguardAcquire).toHaveBeenCalledOnce();
    expect(observed.generateRequestWithMetadata).toHaveBeenCalledOnce();
  });

  it("отклоняет oversized body до JSON parsing и всего downstream pipeline", async () => {
    const observed = createObservedApp();
    const rawBody = `{"description":"${oversizedSentinel}${" ".repeat(expectedGenerateBodyLimitBytes)}`;

    expect(Buffer.byteLength(rawBody)).toBeGreaterThan(expectedGenerateBodyLimitBytes);
    const response = await injectRawJson(observed.app, rawBody);

    expect(response.statusCode).toBe(413);
    const requestId = expectRequestId(response);
    expect(response.json()).toEqual({
      error: {
        code: "request_too_large",
        message: "Размер запроса превышает допустимый предел",
        requestId,
      },
    });
    expect(response.body).not.toContain(oversizedSentinel);
    expect(JSON.stringify(observed.events)).not.toContain(oversizedSentinel);
    expect(observed.events).toEqual([
      {
        event: "generation_started",
        requestId,
        timestamp: expect.any(String),
      },
      {
        event: "generation_rejected",
        requestId,
        timestamp: expect.any(String),
        status: "request_too_large",
        durationMs: expect.any(Number),
        httpStatus: 413,
      },
    ]);
    expect(observed.rateLimiterAcquire).not.toHaveBeenCalled();
    expect(observed.captchaVerify).not.toHaveBeenCalled();
    expect(observed.safeguardAcquire).not.toHaveBeenCalled();
    expect(observed.generateRequest).not.toHaveBeenCalled();
    expect(observed.generateRequestWithMetadata).not.toHaveBeenCalled();
  });

  it("измеряет transport limit в байтах для multibyte JSON", async () => {
    const observed = createObservedApp();
    const rawBody = JSON.stringify({
      description: "Ж".repeat(Math.ceil(expectedGenerateBodyLimitBytes / 2)),
    });

    expect(rawBody.length).toBeLessThan(expectedGenerateBodyLimitBytes);
    expect(Buffer.byteLength(rawBody)).toBeGreaterThan(expectedGenerateBodyLimitBytes);

    const response = await injectRawJson(observed.app, rawBody);

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: { code: "request_too_large" } });
  });

  it("сохраняет отдельный validation_error для небольшого malformed JSON", async () => {
    const observed = createObservedApp();

    const response = await injectRawJson(observed.app, '{"description":');

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "validation_error" } });
    expect(observed.rateLimiterAcquire).not.toHaveBeenCalled();
    expect(observed.captchaVerify).not.toHaveBeenCalled();
    expect(observed.safeguardAcquire).not.toHaveBeenCalled();
    expect(observed.generateRequest).not.toHaveBeenCalled();
    expect(observed.generateRequestWithMetadata).not.toHaveBeenCalled();
  });
});
