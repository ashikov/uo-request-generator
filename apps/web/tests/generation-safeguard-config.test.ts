import type { LlmGateway } from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createGenerationSafeguardConfig } from "../src/generation-safeguard-config.js";

const enabledEnvironment = {
  GENERATION_ENABLED: "true",
  GENERATION_GLOBAL_DAILY_LIMIT: "10",
  GENERATION_GLOBAL_CONCURRENCY_LIMIT: "2",
};

describe("createGenerationSafeguardConfig", () => {
  it("принимает полную включённую конфигурацию", () => {
    expect(createGenerationSafeguardConfig(enabledEnvironment)).toEqual({
      enabled: true,
      dailyLimit: 10,
      concurrencyLimit: 2,
    });
  });

  it("принимает явное аварийное отключение", () => {
    expect(createGenerationSafeguardConfig({ GENERATION_ENABLED: "false" })).toEqual({
      enabled: false,
      dailyLimit: 1,
      concurrencyLimit: 1,
    });
  });

  it("сохраняет zero-config путь только для DisabledLlmGateway", () => {
    expect(
      createGenerationSafeguardConfig({}, { allowImplicitDisabledGateway: true }),
    ).toBeUndefined();
  });

  it.each([
    ["отсутствующий флаг", { ...enabledEnvironment, GENERATION_ENABLED: undefined }],
    [
      "отсутствующий дневной лимит",
      { GENERATION_ENABLED: "true", GENERATION_GLOBAL_CONCURRENCY_LIMIT: "2" },
    ],
    [
      "отсутствующий лимит одновременности",
      { GENERATION_ENABLED: "true", GENERATION_GLOBAL_DAILY_LIMIT: "2" },
    ],
    ["ноль", { ...enabledEnvironment, GENERATION_GLOBAL_DAILY_LIMIT: "0" }],
    ["отрицательное число", { ...enabledEnvironment, GENERATION_GLOBAL_DAILY_LIMIT: "-1" }],
    ["дробное число", { ...enabledEnvironment, GENERATION_GLOBAL_DAILY_LIMIT: "1.5" }],
    ["пустую строку", { ...enabledEnvironment, GENERATION_GLOBAL_DAILY_LIMIT: "" }],
    ["пробельную строку", { ...enabledEnvironment, GENERATION_GLOBAL_DAILY_LIMIT: " " }],
    [
      "небезопасное целое",
      { ...enabledEnvironment, GENERATION_GLOBAL_DAILY_LIMIT: "9007199254740992" },
    ],
    ["неоднозначный boolean", { ...enabledEnvironment, GENERATION_ENABLED: "TRUE" }],
  ])("отклоняет %s", (_caseName, environment) => {
    expect(() => createGenerationSafeguardConfig(environment)).toThrow(
      "Invalid generation safeguard configuration",
    );
  });

  it("не создаёт приложение с реальным gateway без защиты", () => {
    const gateway: LlmGateway = {
      async generateRequest() {
        return { title: "Тест", body: "Обезличенный текст", warnings: [] };
      },
    };

    expect(() =>
      createApp({
        llmGateway: gateway,
        generationRateLimitConfig: {
          ipRequestLimit: 1,
          ipWindowMs: 1,
          clientDailyLimit: 1,
          cookieSecret: "test-cookie-signing-secret-32-characters",
          trustedProxies: [],
          stateCapacity: 10,
        },
        smartCaptchaConfig: { mode: "disabled" },
      }),
    ).toThrow("Invalid generation safeguard configuration");
  });
});
