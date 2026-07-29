import type { LlmGateway } from "@uo-request-generator/core";
import { GenerationProviderUnavailableError } from "@uo-request-generator/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { GenerationRateLimiter } from "../src/generation-rate-limiter.js";
import { GenerationSafeguard } from "../src/generation-safeguard.js";

const apps: ReturnType<typeof createApp>[] = [];
const validInput = {
  description: "На лестничной площадке не горит свет",
  captchaToken: "test-token",
};
const rateLimitConfig = {
  ipRequestLimit: 100,
  ipWindowMs: 60_000,
  clientDailyLimit: 100,
  cookieSecret: "test-cookie-signing-secret-32-characters",
  trustProxy: true,
  stateCapacity: 1_000,
} as const;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

function createTestApp(options: {
  gateway: LlmGateway;
  safeguard: GenerationSafeguard;
  verifier?: { verify: () => Promise<{ status: "verified" | "failed" | "unavailable" }> };
}) {
  const app = createApp({
    llmGateway: options.gateway,
    generationRateLimitConfig: rateLimitConfig,
    generationSafeguard: options.safeguard,
    smartCaptchaConfig:
      options.verifier === undefined
        ? { mode: "disabled" }
        : { mode: "required", clientKey: "test-client-key", serverKey: "test-server-key" },
    ...(options.verifier === undefined ? {} : { smartCaptchaVerifier: options.verifier }),
  });
  apps.push(app);
  return app;
}

function request(app: ReturnType<typeof createApp>, ip = "198.51.100.1") {
  return app.inject({
    method: "POST",
    url: "/api/generate",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    payload: validInput,
  });
}

function expectUnavailable(response: Awaited<ReturnType<typeof request>>) {
  expect(response.statusCode).toBe(503);
  const body = response.json();
  expect(body).toEqual({
    error: {
      code: "generation_unavailable",
      message: "Генерация временно недоступна. Попробуйте позже",
      requestId: expect.any(String),
    },
  });
  expect(response.body).not.toMatch(/disabled|daily_limit|capacity/i);
}

describe("предохранитель POST /api/generate", () => {
  it("сохраняет порядок валидация → limiter → CAPTCHA → предохранитель → gateway", async () => {
    const events: string[] = [];
    const limiter = new GenerationRateLimiter(rateLimitConfig);
    vi.spyOn(limiter, "acquire").mockImplementation((attempt) => {
      events.push("limiter");
      return GenerationRateLimiter.prototype.acquire.call(limiter, attempt);
    });
    const safeguard = new GenerationSafeguard({
      enabled: true,
      dailyLimit: 2,
      concurrencyLimit: 1,
    });
    vi.spyOn(safeguard, "acquire").mockImplementation(() => {
      events.push("safeguard");
      return GenerationSafeguard.prototype.acquire.call(safeguard);
    });
    const gateway: LlmGateway = {
      async generateRequest() {
        events.push("gateway");
        return { title: "Тест", body: "Обезличенный текст", warnings: [] };
      },
    };
    const verifier = {
      async verify() {
        events.push("captcha");
        return { status: "verified" as const };
      },
    };
    const app = createApp({
      llmGateway: gateway,
      generationRateLimitConfig: rateLimitConfig,
      generationRateLimiter: limiter,
      generationSafeguard: safeguard,
      smartCaptchaConfig: {
        mode: "required",
        clientKey: "test-client-key",
        serverKey: "test-server-key",
      },
      smartCaptchaVerifier: verifier,
    });
    apps.push(app);

    const response = await request(app);
    expect(response.statusCode).toBe(200);
    expect(events).toEqual(["limiter", "captcha", "safeguard", "gateway"]);
  });

  it("не обращается к защитам при невалидном вводе", async () => {
    const gateway: LlmGateway = { generateRequest: vi.fn() };
    const safeguard = new GenerationSafeguard({
      enabled: true,
      dailyLimit: 1,
      concurrencyLimit: 1,
    });
    const acquire = vi.spyOn(safeguard, "acquire");
    const app = createTestApp({ gateway, safeguard });
    const response = await app.inject({
      method: "POST",
      url: "/api/generate",
      payload: { description: "Коротко" },
    });
    expect(response.statusCode).toBe(400);
    expect(acquire).not.toHaveBeenCalled();
    expect(gateway.generateRequest).not.toHaveBeenCalled();
  });

  it.each([
    "disabled",
    "daily",
    "capacity",
  ] as const)("возвращает один 503 при причине %s", async (kind) => {
    const gateway: LlmGateway = { generateRequest: vi.fn() };
    const safeguard = new GenerationSafeguard(
      kind === "disabled"
        ? { enabled: false, dailyLimit: 1, concurrencyLimit: 1 }
        : { enabled: true, dailyLimit: 1, concurrencyLimit: 1 },
    );
    if (kind === "daily") allowed(safeguard.acquire()).release();
    if (kind === "capacity") allowed(safeguard.acquire());
    const response = await request(createTestApp({ gateway, safeguard }));
    expectUnavailable(response);
    expect(gateway.generateRequest).not.toHaveBeenCalled();
  });

  it("освобождает слот после успеха и ошибок gateway, но сохраняет дневную попытку", async () => {
    const gateway: LlmGateway = {
      generateRequest: vi.fn().mockRejectedValue(new GenerationProviderUnavailableError()),
    };
    const safeguard = new GenerationSafeguard({
      enabled: true,
      dailyLimit: 2,
      concurrencyLimit: 1,
    });
    const app = createTestApp({ gateway, safeguard });
    expect((await request(app)).statusCode).toBe(503);
    expect((await request(app, "198.51.100.2")).statusCode).toBe(503);
    expectUnavailable(await request(app, "198.51.100.3"));
  });

  it.each([
    ["успеха", undefined, 200],
    ["контролируемой ошибки", new GenerationProviderUnavailableError(), 503],
    ["неизвестной ошибки", new Error("unexpected gateway failure"), 500],
  ])("освобождает слот после %s gateway", async (_caseName, error, statusCode) => {
    const generateRequest = vi.fn<LlmGateway["generateRequest"]>();
    if (error === undefined) {
      generateRequest.mockResolvedValue({
        title: "Тест",
        body: "Обезличенный текст",
        warnings: [],
      });
    } else {
      generateRequest.mockRejectedValue(error);
    }
    const app = createTestApp({
      gateway: { generateRequest },
      safeguard: new GenerationSafeguard({ enabled: true, dailyLimit: 2, concurrencyLimit: 1 }),
    });

    expect((await request(app)).statusCode).toBe(statusCode);
    expect((await request(app, "198.51.100.2")).statusCode).toBe(statusCode);
    expect(generateRequest).toHaveBeenCalledTimes(2);
  });

  it("удерживает глобальный слот до завершения gateway и допускает следующий запрос после release", async () => {
    const generatedRequest = { title: "Тест", body: "Обезличенный текст", warnings: [] };
    let resolveFirstGatewayCall: (result: typeof generatedRequest) => void = () => {};
    let signalGatewayEntry: () => void = () => {};
    const firstGatewayCall = new Promise<typeof generatedRequest>((resolve) => {
      resolveFirstGatewayCall = resolve;
    });
    const gatewayEntry = new Promise<void>((resolve) => {
      signalGatewayEntry = resolve;
    });
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockImplementationOnce(async () => {
        signalGatewayEntry();
        return await firstGatewayCall;
      })
      .mockResolvedValue(generatedRequest);
    const app = createTestApp({
      gateway: { generateRequest },
      safeguard: new GenerationSafeguard({ enabled: true, dailyLimit: 3, concurrencyLimit: 1 }),
    });
    const firstRequest = request(app, "198.51.100.1");

    try {
      await gatewayEntry;

      expectUnavailable(await request(app, "198.51.100.2"));
      expect(generateRequest).toHaveBeenCalledOnce();

      resolveFirstGatewayCall(generatedRequest);
      expect((await firstRequest).statusCode).toBe(200);

      expect((await request(app, "198.51.100.3")).statusCode).toBe(200);
      expect(generateRequest).toHaveBeenCalledTimes(2);
    } finally {
      resolveFirstGatewayCall(generatedRequest);
      await firstRequest;
    }
  });
});

function allowed(decision: ReturnType<GenerationSafeguard["acquire"]>) {
  if (!decision.allowed) throw new Error("Expected allowed decision");
  return decision;
}
