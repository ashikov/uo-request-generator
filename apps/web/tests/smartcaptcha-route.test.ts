import type { LlmGateway } from "@uo-request-generator/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { GenerationRateLimitConfig } from "../src/generation-rate-limit-config";
import { GenerationRateLimiter } from "../src/generation-rate-limiter";
import type { SmartCaptchaVerificationResult } from "../src/smartcaptcha-verifier";

const cookieSecret = "test-cookie-signing-secret-32-characters";
const serverKey = "test-private-server-key";
const captchaToken = "test-one-time-captcha-token";
const remoteAddress = "192.0.2.41";
const generatedRequest = {
  title: "Не работает освещение",
  body: "Прошу проверить освещение на тестовой площадке.",
  warnings: [],
};
const generatedOutcome = { status: "generated" as const, result: generatedRequest };
const validInput = {
  description: "На тестовой площадке не работает освещение",
  location: "Учебная зона",
};
const generationRateLimitConfig = {
  ipRequestLimit: 100,
  ipWindowMs: 60_000,
  clientDailyLimit: 100,
  cookieSecret,
  trustedProxies: [],
  stateCapacity: 1_000,
} satisfies GenerationRateLimitConfig;
const generationSafeguardConfig = {
  enabled: true,
  dailyLimit: 1_000,
  concurrencyLimit: 100,
} as const;

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function successfulGateway(): LlmGateway {
  return {
    generateRequest: vi.fn().mockResolvedValue(generatedOutcome),
  };
}

function verifierWithResults(...results: SmartCaptchaVerificationResult[]) {
  return {
    verify: vi.fn().mockImplementation(async () => {
      const nextResult = results.shift();
      if (nextResult === undefined) {
        throw new Error("Unexpected verifier call");
      }
      return nextResult;
    }),
  };
}

function registerRequiredApp(options: {
  llmGateway?: LlmGateway;
  smartCaptchaVerifier?: ReturnType<typeof verifierWithResults>;
  generationRateLimiter?: GenerationRateLimiter;
  generationRateLimitConfig?: GenerationRateLimitConfig;
}) {
  const app = createApp({
    generationRateLimitConfig: options.generationRateLimitConfig ?? generationRateLimitConfig,
    generationSafeguardConfig,
    smartCaptchaConfig: {
      mode: "required",
      clientKey: "test-public-client-key",
      serverKey,
    },
    smartCaptchaVerifier:
      options.smartCaptchaVerifier ?? verifierWithResults({ status: "verified" }),
    llmGateway: options.llmGateway ?? successfulGateway(),
    generateGenerationClientId: () => "00000000-0000-4000-8000-000000000040",
    ...(options.generationRateLimiter === undefined
      ? {}
      : { generationRateLimiter: options.generationRateLimiter }),
  });
  apps.push(app);
  return app;
}

async function injectGenerate(
  app: ReturnType<typeof createApp>,
  options: {
    payload?: Record<string, unknown>;
    cookie?: string;
    forwardedFor?: string;
    remoteAddress?: string;
  } = {},
) {
  return await app.inject({
    method: "POST",
    url: "/api/generate",
    headers: {
      "content-type": "application/json",
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.forwardedFor === undefined ? {} : { "x-forwarded-for": options.forwardedFor }),
    },
    payload: options.payload ?? {
      ...validInput,
      captchaToken,
    },
    remoteAddress: options.remoteAddress ?? remoteAddress,
  });
}

function cookieHeaderFrom(response: { headers: Record<string, unknown> }): string {
  const setCookie = String(response.headers["set-cookie"]);
  const cookie = setCookie.split(";")[0];
  if (cookie === undefined) {
    throw new Error("Expected Set-Cookie header");
  }
  return cookie;
}

function expectApiError(
  response: { body: string; json: () => unknown; statusCode: number },
  expected: {
    statusCode: number;
    code: string;
    message: string;
  },
): void {
  expect(response.statusCode).toBe(expected.statusCode);
  const payload = response.json();
  expect(payload).toMatchObject({
    error: {
      code: expected.code,
      message: expected.message,
    },
  });

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("error" in payload) ||
    typeof payload.error !== "object" ||
    payload.error === null ||
    !("requestId" in payload.error)
  ) {
    throw new Error("Expected an API error with requestId");
  }

  expect(payload.error.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(Object.keys(payload)).toEqual(["error"]);
  expect(Object.keys(payload.error).sort()).toEqual(["code", "message", "requestId"]);
  expect(response.body).not.toContain(captchaToken);
  expect(response.body).not.toContain(serverKey);
  expect(response.body).not.toContain(remoteAddress);
}

describe("SmartCaptcha в POST /api/generate", () => {
  it("не вызывает limiter, verifier и LLM для невалидного предметного ввода", async () => {
    const limiter = new GenerationRateLimiter(generationRateLimitConfig);
    const acquire = vi.spyOn(limiter, "acquire");
    const verifier = verifierWithResults({ status: "verified" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      generationRateLimiter: limiter,
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const response = await injectGenerate(app, {
      payload: {
        description: "Коротко",
        captchaToken,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(acquire).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(gateway.generateRequest).not.toHaveBeenCalled();
  });

  it("не вызывает verifier и LLM при отказе limiter", async () => {
    const limiter = new GenerationRateLimiter({
      ...generationRateLimitConfig,
      stateCapacity: 1,
    });
    const verifier = verifierWithResults({ status: "verified" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      generationRateLimiter: limiter,
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const response = await injectGenerate(app);

    expect(response.statusCode).toBe(429);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(gateway.generateRequest).not.toHaveBeenCalled();
  });

  it("учитывает запрос без токена в limiter и освобождает active-слот", async () => {
    const limiter = new GenerationRateLimiter(generationRateLimitConfig);
    const acquire = vi.spyOn(limiter, "acquire");
    const verifier = verifierWithResults({ status: "verified" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      generationRateLimiter: limiter,
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const response = await injectGenerate(app, { payload: validInput });

    expectApiError(response, {
      statusCode: 400,
      code: "captcha_failed",
      message: "Не удалось выполнить проверку. Попробуйте ещё раз",
    });
    expect(acquire).toHaveBeenCalledOnce();
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(gateway.generateRequest).not.toHaveBeenCalled();

    const nextResponse = await injectGenerate(app, {
      cookie: cookieHeaderFrom(response),
    });

    expect(nextResponse.statusCode).toBe(200);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(gateway.generateRequest).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "IP-окно",
      {
        ...generationRateLimitConfig,
        ipRequestLimit: 1,
      },
    ],
    [
      "суточный клиентский лимит",
      {
        ...generationRateLimitConfig,
        clientDailyLimit: 1,
      },
    ],
  ])("расходует %s для допущенного запроса без токена", async (_caseName, limiterConfig) => {
    const limiter = new GenerationRateLimiter(limiterConfig);
    const verifier = verifierWithResults({ status: "verified" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      generationRateLimiter: limiter,
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const firstResponse = await injectGenerate(app, { payload: validInput });
    const secondResponse = await injectGenerate(app, {
      payload: validInput,
      cookie: cookieHeaderFrom(firstResponse),
    });

    expectApiError(firstResponse, {
      statusCode: 400,
      code: "captcha_failed",
      message: "Не удалось выполнить проверку. Попробуйте ещё раз",
    });
    expectApiError(secondResponse, {
      statusCode: 429,
      code: "rate_limit_exceeded",
      message: "Слишком много запросов. Попробуйте позже",
    });
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(gateway.generateRequest).not.toHaveBeenCalled();
  });

  it("возвращает captcha_failed и не вызывает LLM", async () => {
    const verifier = verifierWithResults({ status: "failed" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const response = await injectGenerate(app);

    expectApiError(response, {
      statusCode: 400,
      code: "captcha_failed",
      message: "Не удалось выполнить проверку. Попробуйте ещё раз",
    });
    expect(gateway.generateRequest).not.toHaveBeenCalled();
  });

  it("возвращает captcha_unavailable и не вызывает LLM", async () => {
    const verifier = verifierWithResults({ status: "unavailable" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const response = await injectGenerate(app);

    expectApiError(response, {
      statusCode: 503,
      code: "captcha_unavailable",
      message: "Проверка временно недоступна. Попробуйте позже",
    });
    expect(gateway.generateRequest).not.toHaveBeenCalled();
  });

  it("передаёт verifier штатный request.ip, а gateway только предметные поля", async () => {
    const verifier = verifierWithResults({ status: "verified" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const response = await injectGenerate(app, {
      forwardedFor: "192.0.2.99",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(generatedRequest);
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(verifier.verify).toHaveBeenCalledWith({
      token: captchaToken,
      ip: remoteAddress,
    });
    expect(gateway.generateRequest).toHaveBeenCalledOnce();
    expect(gateway.generateRequest).toHaveBeenCalledWith(validInput);
    expect(gateway.generateRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ captchaToken }),
    );
  });

  it("не передаёт verifier поддельный IP от источника вне allowlist", async () => {
    const verifier = verifierWithResults({ status: "verified" });
    const app = registerRequiredApp({
      smartCaptchaVerifier: verifier,
      generationRateLimitConfig: {
        ...generationRateLimitConfig,
        trustedProxies: ["198.51.100.10"],
      },
    });

    const response = await injectGenerate(app, {
      forwardedFor: "192.0.2.99",
      remoteAddress,
    });

    expect(response.statusCode).toBe(200);
    expect(verifier.verify).toHaveBeenCalledWith({
      token: captchaToken,
      ip: remoteAddress,
    });
  });

  it("передаёт verifier IP, штатно определённый через proxy из allowlist", async () => {
    const verifier = verifierWithResults({ status: "verified" });
    const forwardedFor = "198.51.100.99";
    const app = registerRequiredApp({
      smartCaptchaVerifier: verifier,
      generationRateLimitConfig: {
        ...generationRateLimitConfig,
        trustedProxies: [remoteAddress],
      },
    });

    const response = await injectGenerate(app, {
      forwardedFor,
      remoteAddress,
    });

    expect(response.statusCode).toBe(200);
    expect(verifier.verify).toHaveBeenCalledWith({
      token: captchaToken,
      ip: forwardedFor,
    });
  });

  it.each([
    ["failed", { status: "failed" } as const, 400],
    ["unavailable", { status: "unavailable" } as const, 503],
  ])("освобождает active-слот после CAPTCHA %s", async (_caseName, firstResult, statusCode) => {
    const verifier = verifierWithResults(firstResult, { status: "verified" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const firstResponse = await injectGenerate(app);
    const secondResponse = await injectGenerate(app, {
      cookie: cookieHeaderFrom(firstResponse),
    });

    expect(firstResponse.statusCode).toBe(statusCode);
    expect(secondResponse.statusCode).toBe(200);
    expect(verifier.verify).toHaveBeenCalledTimes(2);
    expect(gateway.generateRequest).toHaveBeenCalledOnce();
  });

  it("освобождает active-слот после неизвестного исключения verifier", async () => {
    const verifier = {
      verify: vi
        .fn()
        .mockRejectedValueOnce(new Error("test verifier failure"))
        .mockResolvedValueOnce({ status: "verified" } as const),
    };
    const gateway = successfulGateway();
    const app = createApp({
      generationRateLimitConfig,
      generationSafeguardConfig,
      smartCaptchaConfig: {
        mode: "required",
        clientKey: "test-public-client-key",
        serverKey,
      },
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
      generateGenerationClientId: () => "00000000-0000-4000-8000-000000000040",
    });
    apps.push(app);

    const firstResponse = await injectGenerate(app);
    const secondResponse = await injectGenerate(app, {
      cookie: cookieHeaderFrom(firstResponse),
    });

    expect(firstResponse.statusCode).toBe(500);
    expect(secondResponse.statusCode).toBe(200);
    expect(gateway.generateRequest).toHaveBeenCalledOnce();
  });

  it("не вызывает verifier в отключённом режиме и сохраняет успешный контракт", async () => {
    const verifier = verifierWithResults({ status: "verified" });
    const gateway = successfulGateway();
    const app = createApp({
      generationRateLimitConfig,
      generationSafeguardConfig,
      smartCaptchaConfig: { mode: "disabled" },
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });
    apps.push(app);

    const response = await injectGenerate(app, { payload: validInput });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(generatedRequest);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(gateway.generateRequest).toHaveBeenCalledWith(validInput);
  });

  it("отклоняет слишком длинный токен до limiter и внешних вызовов", async () => {
    const limiter = new GenerationRateLimiter(generationRateLimitConfig);
    const acquire = vi.spyOn(limiter, "acquire");
    const verifier = verifierWithResults({ status: "verified" });
    const gateway = successfulGateway();
    const app = registerRequiredApp({
      generationRateLimiter: limiter,
      smartCaptchaVerifier: verifier,
      llmGateway: gateway,
    });

    const response = await injectGenerate(app, {
      payload: {
        ...validInput,
        captchaToken: "x".repeat(4_097),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(acquire).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(gateway.generateRequest).not.toHaveBeenCalled();
  });
});
