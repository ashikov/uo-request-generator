import type { LlmGateway } from "@uo-request-generator/core";
import { GenerationProviderUnavailableError } from "@uo-request-generator/llm";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { generationClientCookieName } from "../src/generation-client-id.js";
import type { GenerationRateLimitConfig } from "../src/generation-rate-limit-config.js";

const validInput = {
  description: "На тестовой площадке не работает освещение",
};
const generatedRequest = {
  title: "Не работает освещение",
  body: "На тестовой площадке не работает освещение.\nПрошу: проверить освещение.",
  warnings: [],
};
const cookieSecret = "test-cookie-signing-secret-32-characters";
const generationSafeguardConfig = {
  enabled: true,
  dailyLimit: 1_000,
  concurrencyLimit: 100,
} as const;
const clientIds = {
  first: "11111111-1111-4111-8111-111111111111",
  second: "22222222-2222-4222-8222-222222222222",
  third: "33333333-3333-4333-8333-333333333333",
};

const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function rateLimitConfig(
  overrides: Partial<GenerationRateLimitConfig> = {},
): GenerationRateLimitConfig {
  return {
    ipRequestLimit: 3,
    ipWindowMs: 60_000,
    clientDailyLimit: 20,
    cookieSecret,
    trustedProxies: [],
    stateCapacity: 1_000,
    ...overrides,
  };
}

function successfulGateway(): LlmGateway {
  return {
    generateRequest: vi.fn().mockResolvedValue(generatedRequest),
  };
}

function registerApp(options: Parameters<typeof createApp>[0] = {}): ReturnType<typeof createApp> {
  const app = createApp({
    llmGateway: successfulGateway(),
    generationRateLimitConfig: rateLimitConfig(),
    generationSafeguardConfig,
    smartCaptchaConfig: { mode: "disabled" },
    ...options,
  });
  apps.push(app);
  return app;
}

function cookieHeaderFrom(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers["set-cookie"];
  const serializedCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (typeof serializedCookie !== "string") {
    throw new Error("Expected a Set-Cookie response header");
  }

  const cookieHeader = serializedCookie.split(";")[0];
  if (cookieHeader === undefined) {
    throw new Error("Expected a serialized cookie");
  }

  return cookieHeader;
}

function signedCookieHeader(app: FastifyInstance, clientId: string): string {
  return `${generationClientCookieName}=${encodeURIComponent(app.signCookie(clientId))}`;
}

async function injectGenerate(
  app: FastifyInstance,
  options: {
    cookie?: string;
    forwardedFor?: string;
    forwardedProto?: string;
    payload?: Record<string, unknown>;
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
      ...(options.forwardedProto === undefined
        ? {}
        : { "x-forwarded-proto": options.forwardedProto }),
    },
    payload: options.payload ?? validInput,
    ...(options.remoteAddress === undefined ? {} : { remoteAddress: options.remoteAddress }),
  });
}

function expectRateLimitError(response: {
  body: string;
  json: () => unknown;
  statusCode: number;
}): void {
  expect(response.statusCode).toBe(429);
  const payload = response.json();
  expect(payload).toMatchObject({
    error: {
      code: "rate_limit_exceeded",
      message: "Слишком много запросов. Попробуйте позже",
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
  expect(response.body).not.toContain("ip");
  expect(response.body).not.toContain("client");
  expect(response.body).not.toContain("daily");
  expect(response.body).not.toContain(cookieSecret);
}

describe("лимиты POST /api/generate", () => {
  it("не расходует IP- и клиентскую квоту для невалидного входа", async () => {
    const gateway = successfulGateway();
    const app = registerApp({
      llmGateway: gateway,
      generationRateLimitConfig: rateLimitConfig({
        ipRequestLimit: 1,
        clientDailyLimit: 1,
      }),
    });
    await app.ready();
    const cookie = signedCookieHeader(app, clientIds.first);

    const invalidResponse = await injectGenerate(app, {
      cookie,
      payload: { description: "Коротко" },
    });
    const validResponse = await injectGenerate(app, { cookie });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.headers["set-cookie"]).toBeUndefined();
    expect(validResponse.statusCode).toBe(200);
    expect(gateway.generateRequest).toHaveBeenCalledOnce();
  });

  it("допускает три IP-попытки, отклоняет четвёртую и не вызывает gateway", async () => {
    const gateway = successfulGateway();
    const app = registerApp({ llmGateway: gateway });

    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await injectGenerate(app)).statusCode).toBe(200);
    }

    const rejectedResponse = await injectGenerate(app);

    expectRateLimitError(rejectedResponse);
    expect(rejectedResponse.headers["retry-after"]).toBe("60");
    expect(gateway.generateRequest).toHaveBeenCalledTimes(3);
  });

  it("снова допускает IP после истечения скользящего окна", async () => {
    let now = Date.UTC(2026, 6, 27, 12);
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({ ipRequestLimit: 1 }),
      generationRateLimiterNow: () => now,
    });

    expect((await injectGenerate(app)).statusCode).toBe(200);
    expectRateLimitError(await injectGenerate(app));
    now += 60_000;

    expect((await injectGenerate(app)).statusCode).toBe(200);
  });

  it("ведёт разные штатные IP Fastify независимо", async () => {
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({ ipRequestLimit: 1 }),
    });

    expect((await injectGenerate(app, { remoteAddress: "192.0.2.10" })).statusCode).toBe(200);
    expect((await injectGenerate(app, { remoteAddress: "192.0.2.11" })).statusCode).toBe(200);
  });

  it("не доверяет поддельному X-Forwarded-For от источника вне allowlist", async () => {
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({
        trustedProxies: ["198.51.100.10"],
      }),
    });

    for (const forwardedFor of ["192.0.2.10", "192.0.2.11", "192.0.2.12", "192.0.2.13"]) {
      const response = await injectGenerate(app, {
        forwardedFor,
        remoteAddress: "192.0.2.1",
      });
      if (forwardedFor === "192.0.2.13") {
        expectRateLimitError(response);
      } else {
        expect(response.statusCode).toBe(200);
      }
    }
  });

  it("использует штатное Fastify-поведение для proxy из allowlist", async () => {
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({
        trustedProxies: ["192.0.2.0/24"],
      }),
    });

    for (const forwardedFor of ["192.0.2.10", "192.0.2.11", "192.0.2.12", "192.0.2.13"]) {
      expect(
        (
          await injectGenerate(app, {
            forwardedFor,
            remoteAddress: "192.0.2.1",
          })
        ).statusCode,
      ).toBe(200);
    }
  });

  it("допускает двадцать клиентских попыток и отклоняет двадцать первую", async () => {
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({ ipRequestLimit: 100 }),
    });
    await app.ready();
    const cookie = signedCookieHeader(app, clientIds.first);

    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await injectGenerate(app, { cookie })).statusCode).toBe(200);
    }

    const rejectedResponse = await injectGenerate(app, { cookie });

    expectRateLimitError(rejectedResponse);
    expect(rejectedResponse.headers["retry-after"]).toMatch(/^\d+$/);
  });

  it("разделяет суточные лимиты разных технических клиентов", async () => {
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({
        ipRequestLimit: 100,
        clientDailyLimit: 1,
      }),
    });
    await app.ready();

    expect(
      (
        await injectGenerate(app, {
          cookie: signedCookieHeader(app, clientIds.first),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await injectGenerate(app, {
          cookie: signedCookieHeader(app, clientIds.second),
        })
      ).statusCode,
    ).toBe(200);
  });

  it("сбрасывает клиентский лимит при следующих календарных сутках UTC", async () => {
    let now = Date.UTC(2026, 6, 27, 23, 59, 59);
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({
        ipRequestLimit: 100,
        clientDailyLimit: 1,
      }),
      generationRateLimiterNow: () => now,
    });
    await app.ready();
    const cookie = signedCookieHeader(app, clientIds.first);

    expect((await injectGenerate(app, { cookie })).statusCode).toBe(200);
    const rejectedResponse = await injectGenerate(app, { cookie });
    expectRateLimitError(rejectedResponse);
    expect(rejectedResponse.headers["retry-after"]).toBe("1");
    now += 1_000;

    expect((await injectGenerate(app, { cookie })).statusCode).toBe(200);
  });

  it("не увеличивает суточный счётчик при отклонении IP-лимитом", async () => {
    let now = Date.UTC(2026, 6, 27, 12);
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({
        ipRequestLimit: 1,
        clientDailyLimit: 2,
      }),
      generationRateLimiterNow: () => now,
    });
    await app.ready();
    const cookie = signedCookieHeader(app, clientIds.first);

    expect((await injectGenerate(app, { cookie })).statusCode).toBe(200);
    expectRateLimitError(await injectGenerate(app, { cookie }));
    now += 60_000;
    expect((await injectGenerate(app, { cookie })).statusCode).toBe(200);
    now += 60_000;

    expectRateLimitError(await injectGenerate(app, { cookie }));
  });
});

describe("подписанная техническая cookie", () => {
  it("выдаёт новому клиенту подписанный UUID с безопасными атрибутами", async () => {
    const app = registerApp({
      generateGenerationClientId: () => clientIds.first,
    });

    const response = await injectGenerate(app, {
      forwardedFor: "198.51.100.20",
      forwardedProto: "https",
      remoteAddress: "192.0.2.20",
    });
    const cookieHeader = cookieHeaderFrom(response);
    const serializedCookie = String(response.headers["set-cookie"]);
    const signedValue = decodeURIComponent(cookieHeader.split("=")[1] ?? "");

    expect(app.unsignCookie(signedValue)).toMatchObject({
      valid: true,
      value: clientIds.first,
    });
    expect(serializedCookie).toContain("HttpOnly");
    expect(serializedCookie).toContain("SameSite=Strict");
    expect(serializedCookie).toContain("Path=/");
    expect(serializedCookie).toContain("Max-Age=31536000");
    expect(serializedCookie).not.toContain("Secure");
  });

  it("повторно использует корректно подписанную cookie", async () => {
    const generateClientId = vi.fn().mockReturnValue(clientIds.first);
    const app = registerApp({ generateGenerationClientId: generateClientId });

    const firstResponse = await injectGenerate(app);
    const secondResponse = await injectGenerate(app, {
      cookie: cookieHeaderFrom(firstResponse),
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.headers["set-cookie"]).toBeUndefined();
    expect(generateClientId).toHaveBeenCalledOnce();
  });

  it.each([
    "unsigned",
    "damaged",
  ] as const)("не принимает %s cookie и выдаёт новый идентификатор", async (kind) => {
    const generateClientId = vi
      .fn()
      .mockReturnValueOnce(clientIds.first)
      .mockReturnValueOnce(clientIds.second);
    const app = registerApp({ generateGenerationClientId: generateClientId });
    const firstResponse = await injectGenerate(app);
    const validCookie = cookieHeaderFrom(firstResponse);
    const invalidCookie =
      kind === "unsigned"
        ? `${generationClientCookieName}=${clientIds.first}`
        : `${validCookie.slice(0, -1)}x`;

    const response = await injectGenerate(app, { cookie: invalidCookie });
    const replacementCookie = cookieHeaderFrom(response);
    const signedValue = decodeURIComponent(replacementCookie.split("=")[1] ?? "");

    expect(app.unsignCookie(signedValue)).toMatchObject({
      valid: true,
      value: clientIds.second,
    });
    expect(response.body).not.toContain(validCookie);
    expect(response.body).not.toContain(cookieSecret);
  });

  it("не устанавливает Secure по поддельному протоколу от источника вне allowlist", async () => {
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({
        trustedProxies: ["192.0.2.10"],
      }),
    });

    const response = await injectGenerate(app, {
      forwardedProto: "https",
      remoteAddress: "198.51.100.10",
    });

    expect(String(response.headers["set-cookie"])).not.toContain("Secure");
  });

  it("устанавливает Secure по HTTPS-протоколу от proxy из allowlist", async () => {
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({
        trustedProxies: ["192.0.2.10"],
      }),
    });

    const response = await injectGenerate(app, {
      forwardedProto: "https",
      remoteAddress: "192.0.2.10",
    });

    expect(String(response.headers["set-cookie"])).toContain("Secure");
  });
});

describe("параллельные генерации клиента", () => {
  it("сериализует два первых запроса без cookie с одного IP", async () => {
    let resolveGateway: (value: typeof generatedRequest) => void = () => {
      throw new Error("Gateway promise is not initialized");
    };
    const pendingGateway = new Promise<typeof generatedRequest>((resolve) => {
      resolveGateway = resolve;
    });
    const gateway: LlmGateway = {
      generateRequest: vi
        .fn()
        .mockReturnValueOnce(pendingGateway)
        .mockResolvedValue(generatedRequest),
    };
    const generateClientId = vi
      .fn()
      .mockReturnValueOnce(clientIds.first)
      .mockReturnValueOnce(clientIds.second);
    const app = registerApp({
      llmGateway: gateway,
      generateGenerationClientId: generateClientId,
    });
    const remoteAddress = "192.0.2.20";

    const firstResponsePromise = injectGenerate(app, { remoteAddress });
    await vi.waitFor(() => expect(gateway.generateRequest).toHaveBeenCalledOnce());
    const secondResponse = await injectGenerate(app, { remoteAddress });

    expectRateLimitError(secondResponse);
    expect(secondResponse.headers["retry-after"]).toBeUndefined();
    expect(secondResponse.headers["set-cookie"]).toBeUndefined();
    expect(gateway.generateRequest).toHaveBeenCalledOnce();
    expect(generateClientId).toHaveBeenCalledTimes(2);

    resolveGateway(generatedRequest);
    const firstResponse = await firstResponsePromise;
    const nextResponse = await injectGenerate(app, {
      cookie: cookieHeaderFrom(firstResponse),
      remoteAddress,
    });

    expect(nextResponse.statusCode).toBe(200);
    expect(gateway.generateRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    "отсутствующей",
    "повреждённой",
  ] as const)("не позволяет обойти active-слот с %s cookie", async (cookieKind) => {
    let resolveGateway: (value: typeof generatedRequest) => void = () => {
      throw new Error("Gateway promise is not initialized");
    };
    const pendingGateway = new Promise<typeof generatedRequest>((resolve) => {
      resolveGateway = resolve;
    });
    const gateway: LlmGateway = {
      generateRequest: vi
        .fn()
        .mockResolvedValueOnce(generatedRequest)
        .mockReturnValueOnce(pendingGateway)
        .mockResolvedValue(generatedRequest),
    };
    const generateClientId = vi
      .fn()
      .mockReturnValueOnce(clientIds.first)
      .mockReturnValueOnce(clientIds.second)
      .mockReturnValueOnce(clientIds.third);
    const app = registerApp({
      llmGateway: gateway,
      generateGenerationClientId: generateClientId,
    });
    const remoteAddress = "192.0.2.21";
    const initialResponse = await injectGenerate(app, { remoteAddress });
    const validCookie = cookieHeaderFrom(initialResponse);
    const replacementRequestCookie =
      cookieKind === "отсутствующей" ? undefined : `${validCookie.slice(0, -1)}x`;
    const replacementRequestOptions =
      replacementRequestCookie === undefined ? {} : { cookie: replacementRequestCookie };

    const activeResponsePromise = injectGenerate(app, {
      cookie: validCookie,
      remoteAddress,
    });
    await vi.waitFor(() => expect(gateway.generateRequest).toHaveBeenCalledTimes(2));
    const rejectedResponse = await injectGenerate(app, {
      ...replacementRequestOptions,
      remoteAddress,
    });

    expectRateLimitError(rejectedResponse);
    expect(rejectedResponse.headers["retry-after"]).toBeUndefined();
    expect(rejectedResponse.headers["set-cookie"]).toBeUndefined();
    expect(gateway.generateRequest).toHaveBeenCalledTimes(2);

    resolveGateway(generatedRequest);
    expect((await activeResponsePromise).statusCode).toBe(200);
    const replacementResponse = await injectGenerate(app, {
      ...replacementRequestOptions,
      remoteAddress,
    });

    expect(replacementResponse.statusCode).toBe(200);
    expect(replacementResponse.headers["set-cookie"]).toBeDefined();
    expect(gateway.generateRequest).toHaveBeenCalledTimes(3);
  });

  it("отклоняет параллельный запрос той же cookie без Retry-After", async () => {
    let resolveGateway: (value: typeof generatedRequest) => void = () => {
      throw new Error("Gateway promise is not initialized");
    };
    const pendingGateway = new Promise<typeof generatedRequest>((resolve) => {
      resolveGateway = resolve;
    });
    const gateway: LlmGateway = {
      generateRequest: vi.fn().mockReturnValue(pendingGateway),
    };
    const app = registerApp({ llmGateway: gateway });
    await app.ready();
    const cookie = signedCookieHeader(app, clientIds.first);

    const firstResponsePromise = injectGenerate(app, { cookie });
    await vi.waitFor(() => expect(gateway.generateRequest).toHaveBeenCalledOnce());
    const secondResponse = await injectGenerate(app, { cookie });

    expectRateLimitError(secondResponse);
    expect(secondResponse.headers["retry-after"]).toBeUndefined();
    resolveGateway(generatedRequest);
    expect((await firstResponsePromise).statusCode).toBe(200);
  });

  it("допускает параллельные запросы разных клиентов", async () => {
    let resolveGateway: (value: typeof generatedRequest) => void = () => {
      throw new Error("Gateway promise is not initialized");
    };
    const pendingGateway = new Promise<typeof generatedRequest>((resolve) => {
      resolveGateway = resolve;
    });
    const gateway: LlmGateway = {
      generateRequest: vi.fn().mockReturnValue(pendingGateway),
    };
    const app = registerApp({ llmGateway: gateway });
    await app.ready();

    const firstResponsePromise = injectGenerate(app, {
      cookie: signedCookieHeader(app, clientIds.first),
      remoteAddress: "192.0.2.22",
    });
    const secondResponsePromise = injectGenerate(app, {
      cookie: signedCookieHeader(app, clientIds.second),
      remoteAddress: "192.0.2.22",
    });
    await vi.waitFor(() => expect(gateway.generateRequest).toHaveBeenCalledTimes(2));
    resolveGateway(generatedRequest);

    expect((await firstResponsePromise).statusCode).toBe(200);
    expect((await secondResponsePromise).statusCode).toBe(200);
  });

  it("освобождает слот после успеха", async () => {
    const app = registerApp();
    await app.ready();
    const cookie = signedCookieHeader(app, clientIds.first);

    expect((await injectGenerate(app, { cookie })).statusCode).toBe(200);
    expect((await injectGenerate(app, { cookie })).statusCode).toBe(200);
  });

  it("освобождает слот после контролируемой ошибки gateway", async () => {
    const gateway: LlmGateway = {
      generateRequest: vi
        .fn()
        .mockRejectedValueOnce(new GenerationProviderUnavailableError())
        .mockResolvedValueOnce(generatedRequest),
    };
    const app = registerApp({ llmGateway: gateway });
    await app.ready();
    const cookie = signedCookieHeader(app, clientIds.first);
    const remoteAddress = "192.0.2.23";

    expect((await injectGenerate(app, { cookie, remoteAddress })).statusCode).toBe(503);
    expect((await injectGenerate(app, { remoteAddress })).statusCode).toBe(200);
  });

  it("освобождает слот после неизвестного исключения", async () => {
    const gateway: LlmGateway = {
      generateRequest: vi
        .fn()
        .mockRejectedValueOnce(new Error("test gateway failure"))
        .mockResolvedValueOnce(generatedRequest),
    };
    const app = registerApp({ llmGateway: gateway });
    await app.ready();
    const cookie = signedCookieHeader(app, clientIds.first);

    expect((await injectGenerate(app, { cookie })).statusCode).toBe(500);
    expect((await injectGenerate(app, { cookie })).statusCode).toBe(200);
  });
});

describe("ёмкость маршрутного лимитера", () => {
  it("не растёт сверх ёмкости и допускает новые записи после очистки", async () => {
    let now = Date.UTC(2026, 6, 27, 12);
    const app = registerApp({
      generationRateLimitConfig: rateLimitConfig({
        ipRequestLimit: 100,
        clientDailyLimit: 100,
        stateCapacity: 4,
      }),
      generationRateLimiterNow: () => now,
    });
    await app.ready();

    expect(
      (
        await injectGenerate(app, {
          cookie: signedCookieHeader(app, clientIds.first),
          remoteAddress: "192.0.2.10",
        })
      ).statusCode,
    ).toBe(200);
    const capacityResponse = await injectGenerate(app, {
      cookie: signedCookieHeader(app, clientIds.second),
      remoteAddress: "192.0.2.11",
    });
    expectRateLimitError(capacityResponse);
    expect(capacityResponse.headers["retry-after"]).toBeUndefined();

    now += 86_400_000;
    expect(
      (
        await injectGenerate(app, {
          cookie: signedCookieHeader(app, clientIds.third),
          remoteAddress: "192.0.2.12",
        })
      ).statusCode,
    ).toBe(200);
  });
});
