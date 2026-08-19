import fs from "node:fs";
import type { GenerateRequestOutcome, LlmGateway } from "@uo-request-generator/core";
import { GenerationProviderUnavailableError } from "@uo-request-generator/llm";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { GenerationEventWriter, GenerationLogEvent } from "../src/generation-log";
import type { GenerationRateLimitConfig } from "../src/generation-rate-limit-config";
import type { GenerationSafeguardOptions } from "../src/generation-safeguard";

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const validInput = { description: "На лестничной площадке не горит свет" };
const generatedRequest = {
  title: "Не работает освещение",
  body: "На лестничной площадке не горит свет.\nПрошу: проверить и восстановить освещение.",
  warnings: [],
};
const generatedOutcome = {
  status: "generated",
  result: generatedRequest,
} satisfies GenerateRequestOutcome;
const generationRateLimitConfig = {
  ipRequestLimit: 100,
  ipWindowMs: 60_000,
  clientDailyLimit: 100,
  cookieSecret: "test-cookie-signing-secret-32-characters",
  trustedProxies: [],
  stateCapacity: 1_000,
} satisfies GenerationRateLimitConfig;
const generationSafeguardConfig = {
  enabled: true,
  dailyLimit: 100,
  concurrencyLimit: 100,
} satisfies GenerationSafeguardOptions;

const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createWriterFailureApp(
  generateRequest: LlmGateway["generateRequest"],
  writeGenerationEvent: GenerationEventWriter,
): FastifyInstance {
  const app = createApp({
    llmGateway: { generateRequest },
    generationRateLimitConfig,
    generationSafeguardConfig,
    smartCaptchaConfig: { mode: "disabled" },
    writeGenerationEvent,
  });
  apps.push(app);
  return app;
}

function requestIdFromResponse(response: { headers: Record<string, unknown> }): string {
  const requestId = response.headers["x-request-id"];
  if (typeof requestId !== "string") {
    throw new Error("Expected an x-request-id response header");
  }
  return requestId;
}

function injectValidRequest(app: FastifyInstance) {
  return app.inject({
    method: "POST",
    url: "/api/generate",
    headers: { "content-type": "application/json" },
    payload: validInput,
  });
}

describe("сбои writer в POST /api/generate", () => {
  it("сохраняет успех, если writer падает на generation_started", async () => {
    // Дано
    const attemptedEvents: GenerationLogEvent["event"][] = [];
    const writer = vi.fn<GenerationEventWriter>((event) => {
      attemptedEvents.push(event.event);
      if (event.event === "generation_started") {
        throw new Error("writer failed for generation_started");
      }
    });
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue(generatedOutcome);
    const app = createWriterFailureApp(generateRequest, writer);

    // Когда
    const response = await injectValidRequest(app);

    // Тогда
    const requestId = requestIdFromResponse(response);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(generatedRequest);
    expect(requestId).toMatch(requestIdPattern);
    expect(generateRequest).toHaveBeenCalledWith(validInput, requestId);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(attemptedEvents).toEqual(["generation_started", "generation_succeeded"]);
  });

  it("сохраняет успех, если writer падает на generation_succeeded", async () => {
    // Дано
    const attemptedEvents: GenerationLogEvent["event"][] = [];
    const writer = vi.fn<GenerationEventWriter>((event) => {
      attemptedEvents.push(event.event);
      if (event.event === "generation_succeeded") {
        throw new Error("writer failed for generation_succeeded");
      }
    });
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue(generatedOutcome);
    const app = createWriterFailureApp(generateRequest, writer);

    // Когда
    const response = await injectValidRequest(app);

    // Тогда
    const requestId = requestIdFromResponse(response);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(generatedRequest);
    expect(generateRequest).toHaveBeenCalledWith(validInput, requestId);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(attemptedEvents).toEqual(["generation_started", "generation_succeeded"]);
  });

  it("сохраняет controlled generation_rejected, если writer падает на нём", async () => {
    // Дано
    const attemptedEvents: GenerationLogEvent["event"][] = [];
    const writer = vi.fn<GenerationEventWriter>((event) => {
      attemptedEvents.push(event.event);
      if (event.event === "generation_rejected") {
        throw new Error("writer failed for generation_rejected");
      }
    });
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue({ status: "multiple_issues" });
    const app = createWriterFailureApp(generateRequest, writer);

    // Когда
    const response = await injectValidRequest(app);

    // Тогда
    const requestId = requestIdFromResponse(response);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "multiple_issues",
        message: "Опишите одну проблему. Для каждой отдельной проблемы составьте отдельную заявку.",
        requestId,
      },
    });
    expect(generateRequest).toHaveBeenCalledWith(validInput, requestId);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(attemptedEvents).toEqual(["generation_started", "generation_rejected"]);
  });

  it("сохраняет generation_failed, если writer падает на нём", async () => {
    // Дано
    const attemptedEvents: GenerationLogEvent["event"][] = [];
    const writer = vi.fn<GenerationEventWriter>((event) => {
      attemptedEvents.push(event.event);
      if (event.event === "generation_failed") {
        throw new Error("writer failed for generation_failed");
      }
    });
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockRejectedValue(new GenerationProviderUnavailableError());
    const app = createWriterFailureApp(generateRequest, writer);

    // Когда
    const response = await injectValidRequest(app);

    // Тогда
    const requestId = requestIdFromResponse(response);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: {
        code: "generation_provider_unavailable",
        message: "Генерация временно недоступна. Попробуйте позже",
        requestId,
      },
    });
    expect(generateRequest).toHaveBeenCalledWith(validInput, requestId);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(attemptedEvents).toEqual(["generation_started", "generation_failed"]);
  });

  it("сохраняет validation_error при некорректном JSON и сбое generation_rejected", async () => {
    // Дано
    const attemptedEvents: GenerationLogEvent["event"][] = [];
    const writer = vi.fn<GenerationEventWriter>((event) => {
      attemptedEvents.push(event.event);
      if (event.event === "generation_rejected") {
        throw new Error("writer failed for malformed JSON rejection");
      }
    });
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue(generatedOutcome);
    const app = createWriterFailureApp(generateRequest, writer);

    // Когда
    const response = await app.inject({
      method: "POST",
      url: "/api/generate",
      headers: { "content-type": "application/json" },
      payload: '{"description":',
    });

    // Тогда
    const requestId = requestIdFromResponse(response);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { requestId } });
    expect(requestId).toMatch(requestIdPattern);
    expect(generateRequest).not.toHaveBeenCalled();
    expect(writer).toHaveBeenCalledTimes(2);
    expect(attemptedEvents).toEqual(["generation_started", "generation_rejected"]);
  });

  it("ограничивает writer двумя попытками и пишет две безопасные fallback-диагностики", async () => {
    // Дано
    const writerFailureMessage = "writer failure detail must remain private";
    const attemptedEvents: GenerationLogEvent["event"][] = [];
    const writeSync = vi
      .spyOn(fs, "writeSync")
      .mockImplementation((_fileDescriptor, line) => Buffer.byteLength(String(line)));
    const writer = vi.fn<GenerationEventWriter>((event) => {
      attemptedEvents.push(event.event);
      throw new Error(writerFailureMessage);
    });
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue(generatedOutcome);
    const app = createWriterFailureApp(generateRequest, writer);

    // Когда
    const response = await injectValidRequest(app);

    // Тогда
    const requestId = requestIdFromResponse(response);
    const stderrLines = writeSync.mock.calls.map(([, line]) => String(line));
    const diagnostics: unknown[] = stderrLines.map((line) => JSON.parse(line));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(generatedRequest);
    expect(generateRequest).toHaveBeenCalledWith(validInput, requestId);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(attemptedEvents).toEqual(["generation_started", "generation_succeeded"]);
    expect(writeSync).toHaveBeenCalledTimes(2);
    expect(writeSync.mock.calls.map(([fileDescriptor]) => fileDescriptor)).toEqual([2, 2]);
    expect(diagnostics).toEqual([
      { event: "generation_event_write_failed", requestId, failedEvent: "generation_started" },
      { event: "generation_event_write_failed", requestId, failedEvent: "generation_succeeded" },
    ]);
    expect(stderrLines.join("\n")).not.toContain(writerFailureMessage);
  });

  it("сохраняет успех, если fallback stderr синхронно падает", async () => {
    // Дано
    const attemptedEvents: GenerationLogEvent["event"][] = [];
    const writeSync = vi.spyOn(fs, "writeSync").mockImplementation(() => {
      throw new Error("stderr failure");
    });
    const writer = vi.fn<GenerationEventWriter>((event) => {
      attemptedEvents.push(event.event);
      throw new Error("writer failure");
    });
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue(generatedOutcome);
    const app = createWriterFailureApp(generateRequest, writer);

    // Когда
    const response = await injectValidRequest(app);

    // Тогда
    const requestId = requestIdFromResponse(response);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(generatedRequest);
    expect(requestId).toMatch(requestIdPattern);
    expect(generateRequest).toHaveBeenCalledWith(validInput, requestId);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(attemptedEvents).toEqual(["generation_started", "generation_succeeded"]);
    expect(writeSync).toHaveBeenCalledTimes(2);
    expect(writeSync.mock.calls.map(([fileDescriptor]) => fileDescriptor)).toEqual([2, 2]);
  });
});
