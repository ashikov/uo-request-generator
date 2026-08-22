import type {
  LlmGateway,
  LlmGatewayGeneration,
  LlmGenerationFailureStatus,
  LlmGenerationMetadata,
} from "@uo-request-generator/core";
import {
  DisabledLlmGateway,
  GenerationInvalidResponseError,
  GenerationNetworkError,
  GenerationProviderUnavailableError,
  GenerationTimeoutError,
} from "@uo-request-generator/llm";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { GenerationLogEvent } from "../src/generation-log";
import type { GenerationRateLimitConfig } from "../src/generation-rate-limit-config";
import type { GenerationSafeguardOptions } from "../src/generation-safeguard";

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const generationRateLimitConfig = {
  ipRequestLimit: 100,
  ipWindowMs: 60_000,
  clientDailyLimit: 100,
  cookieSecret: "test-cookie-signing-secret-32-characters",
  trustedProxies: [],
  stateCapacity: 1_000,
} as const;

const generationSafeguardConfig = {
  enabled: true,
  dailyLimit: 100,
  concurrencyLimit: 100,
} as const;

const generatedRequest = {
  title: "Не работает освещение",
  body: "На лестничной площадке не горит свет.\nПрошу: проверить и восстановить освещение.",
  warnings: [],
};
const generatedOutcome = { status: "generated" as const, result: generatedRequest };

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

type TerminalEventShape = {
  event: "generation_succeeded" | "generation_rejected" | "generation_failed";
  status: string;
  httpStatus: number;
};

type LlmGenerationMetadataWithDiagnostics = LlmGenerationMetadata & {
  providerBody?: unknown;
  providerMessage?: unknown;
  providerUrl?: unknown;
  providerHeaders?: unknown;
  providerApiKey?: unknown;
  providerAuthorization?: unknown;
  systemPrompt?: unknown;
  prompt?: unknown;
  userInput?: unknown;
  generatedText?: unknown;
};

type MetadataFailureCase = {
  caseName: string;
  failureStatus: LlmGenerationFailureStatus;
  providerHttpStatus: unknown;
  expectedProviderHttpStatus: number | undefined;
};

function createMetadataGatewayFailure(
  failureStatus: LlmGenerationFailureStatus,
  metadata: LlmGenerationMetadata,
  providerHttpStatus: unknown,
): LlmGateway {
  const generation: Extract<LlmGatewayGeneration, { status: "failure" }> = {
    status: "failure",
    failureStatus,
    metadata,
  };
  Object.defineProperty(generation, "providerHttpStatus", {
    value: providerHttpStatus,
    enumerable: true,
  });
  return {
    generateRequest: vi.fn<LlmGateway["generateRequest"]>(),
    generateRequestWithMetadata: vi
      .fn<NonNullable<LlmGateway["generateRequestWithMetadata"]>>()
      .mockResolvedValue(generation),
  };
}

function expectEventPair(
  events: GenerationLogEvent[],
  requestId: string,
  terminal: TerminalEventShape,
): void {
  const requestEvents = events.filter((event) => event.requestId === requestId);

  expect(requestEvents).toHaveLength(2);
  expect(requestEvents[0]).toEqual({
    event: "generation_started",
    requestId,
    timestamp: expect.stringMatching(isoTimestampPattern),
  });
  expect(requestEvents[1]).toEqual({
    ...terminal,
    requestId,
    timestamp: expect.stringMatching(isoTimestampPattern),
    durationMs: expect.any(Number),
  });
}

function createCapturingApp(
  options: {
    llmGateway?: LlmGateway;
    generationRateLimitConfig?: GenerationRateLimitConfig;
    generateGenerationClientId?: () => string;
    smartCaptchaConfig?:
      | { mode: "disabled" }
      | { mode: "required"; clientKey: string; serverKey: string };
    smartCaptchaVerifier?: {
      verify: () => Promise<{ status: "verified" | "failed" | "unavailable" }>;
    };
    generationSafeguardConfig?: GenerationSafeguardOptions;
  } = {},
): { app: FastifyInstance; events: GenerationLogEvent[] } {
  const events: GenerationLogEvent[] = [];
  const app = createApp({
    llmGateway: options.llmGateway ?? {
      generateRequest: vi.fn().mockResolvedValue(generatedOutcome),
    },
    generationRateLimitConfig: options.generationRateLimitConfig ?? generationRateLimitConfig,
    generationSafeguardConfig: options.generationSafeguardConfig ?? generationSafeguardConfig,
    smartCaptchaConfig: options.smartCaptchaConfig ?? { mode: "disabled" },
    ...(options.generateGenerationClientId === undefined
      ? {}
      : { generateGenerationClientId: options.generateGenerationClientId }),
    ...(options.smartCaptchaVerifier === undefined
      ? {}
      : { smartCaptchaVerifier: options.smartCaptchaVerifier }),
    writeGenerationEvent: (event) => {
      events.push(event);
    },
  });
  apps.push(app);
  return { app, events };
}

async function injectGenerate(
  app: FastifyInstance,
  payload: Record<string, unknown>,
): Promise<ReturnType<FastifyInstance["inject"]>> {
  return await app.inject({
    method: "POST",
    url: "/api/generate",
    headers: { "content-type": "application/json" },
    payload,
  });
}

function requestIdFromResponse(response: { headers: Record<string, unknown> }): string {
  const requestId = response.headers["x-request-id"];
  if (typeof requestId !== "string") {
    throw new Error("Expected an x-request-id response header");
  }
  return requestId;
}

function expectGenerationProviderError(
  response: { json: () => unknown; headers: Record<string, unknown> },
  message: string,
): string {
  const requestId = requestIdFromResponse(response);
  expect(response.json()).toEqual({
    error: {
      code: "generation_provider_unavailable",
      message,
      requestId,
    },
  });
  return requestId;
}

const validInput = { description: "На лестничной площадке не горит свет" };

describe("структурированные события POST /api/generate", () => {
  it("пишет начальное и итоговое событие с общим requestId при успехе", async () => {
    const { app, events } = createCapturingApp();

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(generatedRequest);
    const requestId = requestIdFromResponse(response);
    expect(requestId).toMatch(requestIdPattern);
    expectEventPair(events, requestId, {
      event: "generation_succeeded",
      status: "generated",
      httpStatus: 200,
    });
  });

  it("передаёт requestId в LlmGateway и возвращает его в заголовке", async () => {
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue(generatedOutcome);
    const { app, events } = createCapturingApp({ llmGateway: { generateRequest } });

    const response = await injectGenerate(app, validInput);

    const requestId = requestIdFromResponse(response);
    expect(generateRequest).toHaveBeenCalledWith(validInput, requestId);
    expectEventPair(events, requestId, {
      event: "generation_succeeded",
      status: "generated",
      httpStatus: 200,
    });
  });

  it("добавляет безопасные metadata LLM в terminal event успешной генерации", async () => {
    const llmMetadata = {
      provider: "provider-alpha",
      model: "test-model-full-name",
      usage: { inputTokens: 101, outputTokens: 52, totalTokens: 153 },
      usageStatus: "available" as const,
      systemPromptHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      durationMs: 42,
    };
    const generateRequestWithMetadata = vi.fn().mockResolvedValue({
      status: "success" as const,
      outcome: generatedOutcome,
      metadata: llmMetadata,
    });
    const { app, events } = createCapturingApp({
      llmGateway: {
        generateRequest: vi.fn().mockResolvedValue(generatedOutcome),
        generateRequestWithMetadata,
      },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(200);
    expect(generateRequestWithMetadata).toHaveBeenCalledWith(
      validInput,
      requestIdFromResponse(response),
    );
    expect(events[1]).toMatchObject({ event: "generation_succeeded", llm: llmMetadata });
    expect(JSON.stringify(events)).not.toContain(validInput.description);
    expect(JSON.stringify(events)).not.toContain("https://provider.example");
    expect(JSON.stringify(events)).not.toContain("test-api-key");
  });

  it("сохраняет terminal event без usage провайдера", async () => {
    const llmMetadata = {
      provider: "yandex" as const,
      model: "test-model-full-name",
      usage: null,
      usageStatus: "missing" as const,
      systemPromptHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      durationMs: 42,
    };
    const { app, events } = createCapturingApp({
      llmGateway: {
        generateRequest: vi.fn().mockResolvedValue(generatedOutcome),
        generateRequestWithMetadata: vi.fn().mockResolvedValue({
          status: "success",
          outcome: generatedOutcome,
          metadata: llmMetadata,
        }),
      },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(200);
    expect(events[1]).toMatchObject({
      event: "generation_succeeded",
      llm: { usage: null, usageStatus: "missing" },
    });
  });

  it("сохраняет metadata при контролируемой ошибке provider", async () => {
    const llmMetadata = {
      provider: "openai-compatible" as const,
      model: "test-model-full-name",
      usage: null,
      usageStatus: "missing" as const,
      systemPromptHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      durationMs: 42,
    };
    const { app, events } = createCapturingApp({
      llmGateway: {
        generateRequest: vi.fn(),
        generateRequestWithMetadata: vi.fn().mockResolvedValue({
          status: "failure",
          failureStatus: "timeout",
          metadata: llmMetadata,
        }),
      },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    expect(events[1]).toMatchObject({
      event: "generation_failed",
      status: "timeout",
      llm: llmMetadata,
    });
  });

  it.each([
    {
      caseName: "корректном HTTP status ошибки provider",
      failureStatus: "provider_unavailable",
      providerHttpStatus: 429,
      expectedProviderHttpStatus: 429,
    },
    {
      caseName: "успешном HTTP status provider",
      failureStatus: "provider_unavailable",
      providerHttpStatus: 200,
      expectedProviderHttpStatus: undefined,
    },
    {
      caseName: "строковом HTTP status",
      failureStatus: "provider_unavailable",
      providerHttpStatus: "429",
      expectedProviderHttpStatus: undefined,
    },
    {
      caseName: "дробном HTTP status",
      failureStatus: "provider_unavailable",
      providerHttpStatus: 429.5,
      expectedProviderHttpStatus: undefined,
    },
    {
      caseName: "выходящем за HTTP range status",
      failureStatus: "provider_unavailable",
      providerHttpStatus: 600,
      expectedProviderHttpStatus: undefined,
    },
    {
      caseName: "timeout с HTTP status provider",
      failureStatus: "timeout",
      providerHttpStatus: 429,
      expectedProviderHttpStatus: undefined,
    },
    {
      caseName: "network error с HTTP status provider",
      failureStatus: "network_error",
      providerHttpStatus: 429,
      expectedProviderHttpStatus: undefined,
    },
    {
      caseName: "invalid response с HTTP status provider",
      failureStatus: "invalid_response",
      providerHttpStatus: 429,
      expectedProviderHttpStatus: undefined,
    },
  ] satisfies readonly MetadataFailureCase[])("сохраняет providerHttpStatus только при $caseName", async ({
    failureStatus,
    providerHttpStatus,
    expectedProviderHttpStatus,
  }) => {
    const metadataGateway = createMetadataGatewayFailure(
      failureStatus,
      {
        provider: "test-provider",
        model: "test-model",
        usage: null,
        usageStatus: "missing",
        systemPromptHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        durationMs: 1,
      },
      providerHttpStatus,
    );
    const { app, events } = createCapturingApp({ llmGateway: metadataGateway });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    const requestId = expectGenerationProviderError(
      response,
      "Генерация временно недоступна. Попробуйте позже",
    );
    expect(events[1]).toMatchObject({
      event: "generation_failed",
      requestId,
      status: failureStatus,
      httpStatus: 503,
    });
    if (expectedProviderHttpStatus === undefined) {
      expect(events[1]).not.toHaveProperty("providerHttpStatus");
      return;
    }
    expect(events[1]).toMatchObject({ providerHttpStatus: expectedProviderHttpStatus });
  });

  it("не раскрывает diagnostics metadata-capable gateway в public response или events", async () => {
    const privateProviderBody = "private-provider-body-sentinel";
    const privateProviderMessage = "private-provider-message-sentinel";
    const privateProviderUrl = "https://private-provider-url-sentinel.example";
    const privateProviderHeaders = "private-provider-headers-sentinel";
    const privateApiKey = "private-api-key-sentinel";
    const privateAuthorization = "Bearer private-authorization-sentinel";
    const privatePrompt = "private-prompt-sentinel";
    const privateUserInput = "private-user-input-sentinel";
    const privateGeneratedText = "private-generated-text-sentinel";
    const metadataWithDiagnostics: LlmGenerationMetadataWithDiagnostics = {
      provider: "test-provider",
      model: "test-model",
      usage: null,
      usageStatus: "missing",
      systemPromptHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      durationMs: 1,
      providerBody: privateProviderBody,
      providerMessage: privateProviderMessage,
      providerUrl: privateProviderUrl,
      providerHeaders: {
        authorization: privateAuthorization,
        "x-api-key": privateApiKey,
        "x-private": privateProviderHeaders,
      },
      providerApiKey: privateApiKey,
      providerAuthorization: privateAuthorization,
      systemPrompt: privatePrompt,
      prompt: privatePrompt,
      userInput: privateUserInput,
      generatedText: privateGeneratedText,
    };
    const metadataGateway = createMetadataGatewayFailure(
      "provider_unavailable",
      metadataWithDiagnostics,
      429,
    );
    const { app, events } = createCapturingApp({ llmGateway: metadataGateway });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    const requestId = expectGenerationProviderError(
      response,
      "Генерация временно недоступна. Попробуйте позже",
    );
    const serializedPublicResponse = response.body;
    const serializedEvents = events.map((event) => JSON.stringify(event)).join("\n");
    for (const privateValue of [
      privateProviderBody,
      privateProviderMessage,
      privateProviderUrl,
      privateProviderHeaders,
      privateApiKey,
      privateAuthorization,
      privatePrompt,
      privateUserInput,
      privateGeneratedText,
    ]) {
      expect(serializedPublicResponse).not.toContain(privateValue);
      expect(serializedEvents).not.toContain(privateValue);
    }
    expect(events[1]).toMatchObject({
      event: "generation_failed",
      requestId,
      status: "provider_unavailable",
      httpStatus: 503,
      providerHttpStatus: 429,
    });
  });

  it("пишет generation_rejected/validation_error для невалидного ввода", async () => {
    const { app, events } = createCapturingApp();

    const response = await injectGenerate(app, { description: "Коротко" });

    expect(response.statusCode).toBe(400);
    const requestId = requestIdFromResponse(response);
    expect(response.json()).toMatchObject({ error: { requestId } });
    expectEventPair(events, requestId, {
      event: "generation_rejected",
      status: "validation_error",
      httpStatus: 400,
    });
  });

  it("пишет generation_rejected/validation_error для некорректного JSON", async () => {
    const { app, events } = createCapturingApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/generate",
      headers: { "content-type": "application/json" },
      payload: '{"description":',
    });

    expect(response.statusCode).toBe(400);
    const requestId = requestIdFromResponse(response);
    expect(requestId).toMatch(requestIdPattern);
    expect(response.json()).toMatchObject({ error: { requestId } });
    expectEventPair(events, requestId, {
      event: "generation_rejected",
      status: "validation_error",
      httpStatus: 400,
    });
  });

  it("сохраняет единый requestId при ошибке подготовки client id", async () => {
    const { app, events } = createCapturingApp({
      generateGenerationClientId: () => {
        throw new Error("unexpected client id failure");
      },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(500);
    const requestId = requestIdFromResponse(response);
    expect(response.json()).toMatchObject({ error: { requestId } });
    expectEventPair(events, requestId, {
      event: "generation_failed",
      status: "internal_error",
      httpStatus: 500,
    });
    expect(events.filter((event) => event.event === "generation_started")).toHaveLength(1);
  });

  it("пишет generation_rejected/rate_limited при превышении лимита", async () => {
    const { app, events } = createCapturingApp({
      generationRateLimitConfig: { ...generationRateLimitConfig, ipRequestLimit: 1 },
    });

    expect((await injectGenerate(app, validInput)).statusCode).toBe(200);
    const rejectedResponse = await injectGenerate(app, validInput);

    expect(rejectedResponse.statusCode).toBe(429);
    const requestId = requestIdFromResponse(rejectedResponse);
    expectEventPair(events, requestId, {
      event: "generation_rejected",
      status: "rate_limited",
      httpStatus: 429,
    });
  });

  it("пишет generation_rejected/multiple_issues", async () => {
    const { app, events } = createCapturingApp({
      llmGateway: { generateRequest: vi.fn().mockResolvedValue({ status: "multiple_issues" }) },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(400);
    expectEventPair(events, requestIdFromResponse(response), {
      event: "generation_rejected",
      status: "multiple_issues",
      httpStatus: 400,
    });
  });

  it("пишет generation_rejected/captcha_failed без токена", async () => {
    const { app, events } = createCapturingApp({
      smartCaptchaConfig: {
        mode: "required",
        clientKey: "test-public-client-key",
        serverKey: "test-private-server-key",
      },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(400);
    expectEventPair(events, requestIdFromResponse(response), {
      event: "generation_rejected",
      status: "captcha_failed",
      httpStatus: 400,
    });
  });

  it("пишет generation_rejected/captcha_unavailable при недоступной проверке", async () => {
    const { app, events } = createCapturingApp({
      smartCaptchaConfig: {
        mode: "required",
        clientKey: "test-public-client-key",
        serverKey: "test-private-server-key",
      },
      smartCaptchaVerifier: {
        verify: async () => ({ status: "unavailable" as const }),
      },
    });

    const response = await injectGenerate(app, {
      ...validInput,
      captchaToken: "test-one-time-captcha-token",
    });

    expect(response.statusCode).toBe(503);
    expectEventPair(events, requestIdFromResponse(response), {
      event: "generation_rejected",
      status: "captcha_unavailable",
      httpStatus: 503,
    });
  });

  it("пишет generation_rejected/generation_unavailable при недоступной генерации", async () => {
    const { app, events } = createCapturingApp({
      generationSafeguardConfig: { enabled: false, dailyLimit: 100, concurrencyLimit: 100 },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    expectEventPair(events, requestIdFromResponse(response), {
      event: "generation_rejected",
      status: "generation_unavailable",
      httpStatus: 503,
    });
  });

  it("пишет generation_failed/provider_unavailable при недоступном провайдере", async () => {
    const { app, events } = createCapturingApp({
      llmGateway: {
        generateRequest: vi.fn().mockRejectedValue(new GenerationProviderUnavailableError()),
      },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    expectEventPair(
      events,
      expectGenerationProviderError(response, "Генерация временно недоступна. Попробуйте позже"),
      {
        event: "generation_failed",
        status: "provider_unavailable",
        httpStatus: 503,
      },
    );
  });

  it("сохраняет отдельное сообщение для отключённой генерации", async () => {
    const { app, events } = createCapturingApp({ llmGateway: new DisabledLlmGateway() });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    expectEventPair(
      events,
      expectGenerationProviderError(response, "Генерация пока не подключена"),
      {
        event: "generation_failed",
        status: "provider_unavailable",
        httpStatus: 503,
      },
    );
  });

  it("пишет generation_failed/timeout при таймауте провайдера", async () => {
    const { app, events } = createCapturingApp({
      llmGateway: { generateRequest: vi.fn().mockRejectedValue(new GenerationTimeoutError()) },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    expectEventPair(
      events,
      expectGenerationProviderError(response, "Генерация временно недоступна. Попробуйте позже"),
      {
        event: "generation_failed",
        status: "timeout",
        httpStatus: 503,
      },
    );
  });

  it("пишет generation_failed/network_error при сетевой ошибке", async () => {
    const { app, events } = createCapturingApp({
      llmGateway: { generateRequest: vi.fn().mockRejectedValue(new GenerationNetworkError()) },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    expectEventPair(
      events,
      expectGenerationProviderError(response, "Генерация временно недоступна. Попробуйте позже"),
      {
        event: "generation_failed",
        status: "network_error",
        httpStatus: 503,
      },
    );
  });

  it("пишет generation_failed/invalid_response при некорректном ответе провайдера", async () => {
    const { app, events } = createCapturingApp({
      llmGateway: {
        generateRequest: vi.fn().mockRejectedValue(new GenerationInvalidResponseError()),
      },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(503);
    expectEventPair(
      events,
      expectGenerationProviderError(response, "Генерация временно недоступна. Попробуйте позже"),
      {
        event: "generation_failed",
        status: "invalid_response",
        httpStatus: 503,
      },
    );
  });

  it("пишет generation_failed/internal_error при неизвестной ошибке", async () => {
    const { app, events } = createCapturingApp({
      llmGateway: { generateRequest: vi.fn().mockRejectedValue(new Error("unexpected failure")) },
    });

    const response = await injectGenerate(app, validInput);

    expect(response.statusCode).toBe(500);
    expectEventPair(events, requestIdFromResponse(response), {
      event: "generation_failed",
      status: "internal_error",
      httpStatus: 500,
    });
  });

  it("не включает пользовательский ввод, токены и ключи в события", async () => {
    const privateDescription = "На площадке пахнет, личная деталь 8472";
    const captchaToken = "test-one-time-captcha-token-8391";
    const serverKey = "test-private-server-key-3957";
    const authorization = "Bearer test-private-api-key-1842";
    const cookie = "private-cookie-6384";
    const environmentValue = "private-environment-value-7519";
    vi.stubEnv("GENERATION_LOG_TEST_SECRET", environmentValue);
    const { app, events } = createCapturingApp({
      smartCaptchaConfig: {
        mode: "required",
        clientKey: "test-public-client-key",
        serverKey,
      },
      smartCaptchaVerifier: {
        verify: async () => ({ status: "verified" as const }),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/generate",
      headers: {
        "content-type": "application/json",
        authorization,
        cookie: `unrelated=${cookie}`,
      },
      payload: {
        description: privateDescription,
        captchaToken,
      },
    });

    expect(response.statusCode).toBe(200);
    const serializedEvents = events.map((event) => JSON.stringify(event)).join("\n");
    expect(serializedEvents).not.toContain(privateDescription);
    expect(serializedEvents).not.toContain(captchaToken);
    expect(serializedEvents).not.toContain(serverKey);
    expect(serializedEvents).not.toContain(authorization);
    expect(serializedEvents).not.toContain(cookie);
    expect(serializedEvents).not.toContain(environmentValue);
    expect(serializedEvents).not.toContain(generatedRequest.body);
  });

  it("не раскрывает технические детали неизвестной ошибки в событиях", async () => {
    const privateInput = "На площадке пахнет, личная деталь 8472";
    const gatewayErrorMessage = "Unexpected gateway failure 9135";
    const { app, events } = createCapturingApp({
      llmGateway: {
        generateRequest: vi.fn().mockRejectedValue(new Error(gatewayErrorMessage)),
      },
    });

    const response = await injectGenerate(app, { description: privateInput });

    expect(response.statusCode).toBe(500);
    const serializedEvents = events.map((event) => JSON.stringify(event)).join("\n");
    expect(serializedEvents).not.toContain(privateInput);
    expect(serializedEvents).not.toContain(gatewayErrorMessage);
  });
});
