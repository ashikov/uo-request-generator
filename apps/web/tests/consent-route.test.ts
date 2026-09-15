import type { LlmGateway } from "@uo-request-generator/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

const consentVersion = "c1-2026-09-15-r1";
const receiptId = "00000000-0000-4000-8000-000000000264";
const input = { description: "На учебной площадке не включается освещение" };
const acceptedConsent = { consentAccepted: true, consentVersion };
const result = { title: "Учебная заявка", body: "Синтетический результат", warnings: [] };
const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup(
  options: {
    writeFails?: boolean;
    noLedger?: boolean;
    downstream?: "error" | "multiple";
    captchaFails?: boolean;
    safeguardRejects?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const verify = vi.fn(async () => {
    calls.push("captcha");
    return { status: options.captchaFails ? ("failed" as const) : ("verified" as const) };
  });
  const accept = vi.fn((requestId: string, version: string) => {
    calls.push("receipt");
    if (options.writeFails) throw new Error("Private storage diagnostic must not be disclosed");
    return {
      consentReceiptId: receiptId,
      requestId,
      consentVersion: version,
      serverTimestamp: "2026-09-15T00:00:00.000Z",
      status: "accepted" as const,
    };
  });
  const generateRequest = vi.fn<LlmGateway["generateRequest"]>(async () => {
    calls.push("llm");
    if (options.downstream === "error") throw new Error("Synthetic downstream failure");
    return options.downstream === "multiple"
      ? { status: "multiple_issues" }
      : { status: "generated", result };
  });
  const appOptions = {
    llmGateway: { generateRequest },
    smartCaptchaConfig: {
      mode: "required" as const,
      clientKey: "synthetic-client-key",
      serverKey: "synthetic-server-key",
    },
    smartCaptchaVerifier: { verify },
    generationRateLimitConfig: {
      ipRequestLimit: 100,
      ipWindowMs: 60_000,
      clientDailyLimit: 100,
      cookieSecret: "synthetic-cookie-secret-32-characters",
      trustedProxies: [],
      stateCapacity: 100,
    },
    generationSafeguardConfig: {
      enabled: true,
      dailyLimit: 100,
      concurrencyLimit: options.safeguardRejects ? 0 : 100,
    },
    ...(options.noLedger ? {} : { consentLedger: { accept } }),
  };
  const app = createApp(appOptions);
  apps.push(app);
  const send = (consent: Record<string, unknown> = acceptedConsent) =>
    app.inject({
      method: "POST",
      url: "/api/generate",
      payload: { ...input, captchaToken: "synthetic-token", ...consent },
    });
  return { app, send, calls, verify, accept, generateRequest };
}

describe("Согласие Ц1 на HTTP-границе", () => {
  it("сохраняет диагностический 503 без LLM и ledger, не создавая receipt", async () => {
    const app = createApp({ writeGenerationEvent: () => {} });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/generate",
      payload: { ...input, ...acceptedConsent },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("generation_provider_unavailable");
    expect(response.headers["x-consent-receipt-id"]).toBeUndefined();
  });

  it("проверяет CAPTCHA, сохраняет receipt и только затем вызывает LLM", async () => {
    const { send, calls, accept, generateRequest } = setup();
    const response = await send();
    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(["captcha", "receipt", "llm"]);
    expect(accept).toHaveBeenCalledWith(response.headers["x-request-id"], consentVersion);
    expect(generateRequest).toHaveBeenCalledWith(input, response.headers["x-request-id"]);
    expect(response.headers["x-consent-receipt-id"]).toBe(receiptId);
  });

  it.each([
    {},
    { consentAccepted: false, consentVersion },
    { consentAccepted: true },
    { consentAccepted: true, consentVersion: "unknown" },
    { consentAccepted: true, consentVersion: "c1-2026-09-14-r1" },
    { consentAccepted: "true", consentVersion },
  ])("отклоняет недостаточное согласие после CAPTCHA: %j", async (consent) => {
    const { send, verify, accept, generateRequest } = setup();
    const response = await send(consent);
    expect(verify).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: "validation_error",
        message: "Проверьте формат и содержание запроса",
        requestId: response.headers["x-request-id"],
      },
    });
    expect(response.headers["x-consent-receipt-id"]).toBeUndefined();
    expect(accept).not.toHaveBeenCalled();
    expect(generateRequest).not.toHaveBeenCalled();
  });

  it("не создаёт receipt при отказе CAPTCHA", async () => {
    const { send, accept, generateRequest } = setup({ captchaFails: true });
    const response = await send();
    expect(response.json().error.code).toBe("captcha_failed");
    expect(accept).not.toHaveBeenCalled();
    expect(generateRequest).not.toHaveBeenCalled();
    expect(response.headers["x-consent-receipt-id"]).toBeUndefined();
  });

  it.each([
    { writeFails: true },
    { noLedger: true },
  ])("работает fail closed при недоступной записи: %j", async (options) => {
    const { send, verify, generateRequest } = setup(options);
    const response = await send();
    expect(verify).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("internal_error");
    expect(response.body).not.toContain("Private storage");
    expect(response.headers["x-consent-receipt-id"]).toBeUndefined();
    expect(generateRequest).not.toHaveBeenCalled();
  });

  it.each([
    { downstream: "error" as const, status: 500 },
    { downstream: "multiple" as const, status: 400 },
    { safeguardRejects: true, status: 503 },
  ])("сохраняет заголовок receipt на ответе после записи: %j", async ({ status, ...options }) => {
    const { send, accept } = setup(options);
    const response = await send();
    expect(accept).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(status);
    expect(response.headers["x-consent-receipt-id"]).toBe(receiptId);
  });
});
