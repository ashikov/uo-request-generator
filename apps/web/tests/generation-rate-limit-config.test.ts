import type { LlmGateway } from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  createGenerationRateLimitConfig,
  generationRateLimitDefaults,
} from "../src/generation-rate-limit-config.js";

const validSecret = "test-cookie-signing-secret-32-characters";

describe("createGenerationRateLimitConfig", () => {
  it("использует значения лимитов из issue по умолчанию", () => {
    expect(
      createGenerationRateLimitConfig({
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
      }),
    ).toEqual({
      ...generationRateLimitDefaults,
      cookieSecret: validSecret,
    });
  });

  it.each([
    ["GENERATION_IP_REQUEST_LIMIT", "0"],
    ["GENERATION_IP_REQUEST_LIMIT", "-1"],
    ["GENERATION_IP_REQUEST_LIMIT", "1.5"],
    ["GENERATION_IP_REQUEST_LIMIT", "три"],
    ["GENERATION_IP_WINDOW_MS", ""],
    ["GENERATION_CLIENT_DAILY_LIMIT", "20.0"],
    ["GENERATION_RATE_LIMIT_STATE_CAPACITY", "1000 записей"],
  ])("отклоняет некорректное значение %s=%s", (name, value) => {
    expect(() =>
      createGenerationRateLimitConfig({
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
        [name]: value,
      }),
    ).toThrow("Invalid generation rate limit configuration");
  });

  it.each([
    "1",
    "yes",
    "TRUE",
    "false ",
  ])("не принимает неоднозначное значение trust proxy %s", (trustProxy) => {
    expect(() =>
      createGenerationRateLimitConfig({
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
        GENERATION_TRUST_PROXY: trustProxy,
      }),
    ).toThrow("Invalid generation rate limit configuration");
  });

  it("принимает только явные boolean-значения trust proxy", () => {
    expect(
      createGenerationRateLimitConfig({
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
        GENERATION_TRUST_PROXY: "true",
      }).trustProxy,
    ).toBe(true);
    expect(
      createGenerationRateLimitConfig({
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
        GENERATION_TRUST_PROXY: "false",
      }).trustProxy,
    ).toBe(false);
  });

  it.each([
    undefined,
    "",
    "short-secret",
  ])("не использует отсутствующий или недостаточный production-секрет: %s", (cookieSecret) => {
    expect(() =>
      createGenerationRateLimitConfig({
        ...(cookieSecret === undefined ? {} : { GENERATION_CLIENT_COOKIE_SECRET: cookieSecret }),
      }),
    ).toThrow("Invalid generation rate limit configuration");
  });

  it("разрешает эфемерный секрет только для отключённой генерации", () => {
    expect(
      createGenerationRateLimitConfig(
        {},
        {
          allowEphemeralCookieSecret: true,
          generateCookieSecret: () => validSecret,
        },
      ),
    ).toEqual({
      ...generationRateLimitDefaults,
      cookieSecret: validSecret,
    });
  });

  it("принимает детерминированную полную конфигурацию без process.env", () => {
    expect(
      createGenerationRateLimitConfig({
        GENERATION_IP_REQUEST_LIMIT: "7",
        GENERATION_IP_WINDOW_MS: "90000",
        GENERATION_CLIENT_DAILY_LIMIT: "30",
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
        GENERATION_TRUST_PROXY: "true",
        GENERATION_RATE_LIMIT_STATE_CAPACITY: "500",
      }),
    ).toEqual({
      ipRequestLimit: 7,
      ipWindowMs: 90_000,
      clientDailyLimit: 30,
      cookieSecret: validSecret,
      trustProxy: true,
      stateCapacity: 500,
    });
  });

  it("не создаёт приложение с включённым gateway без явного секрета", () => {
    const gateway: LlmGateway = {
      async generateRequest() {
        return {
          title: "Тестовая заявка",
          body: "Обезличенный тестовый текст",
          warnings: [],
        };
      },
    };

    expect(() => createApp({ llmGateway: gateway })).toThrow(
      "Invalid generation rate limit configuration",
    );
  });
});
