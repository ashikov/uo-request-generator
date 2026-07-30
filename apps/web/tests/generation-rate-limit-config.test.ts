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
    ["отсутствующее значение", undefined, []],
    ["один IPv4", "192.0.2.10", ["192.0.2.10"]],
    ["IPv4 CIDR", "198.51.100.0/24", ["198.51.100.0/24"]],
    ["IPv4 CIDR с минимальным prefix", "192.0.2.10/1", ["192.0.2.10/1"]],
    ["IPv4 CIDR с максимальным prefix", "192.0.2.10/32", ["192.0.2.10/32"]],
    ["один IPv6", "2001:db8::10", ["2001:db8::10"]],
    ["IPv6 CIDR", "2001:db8:1::/64", ["2001:db8:1::/64"]],
    ["IPv6 CIDR с минимальным prefix", "2001:db8::10/1", ["2001:db8::10/1"]],
    ["IPv6 CIDR с максимальным prefix", "2001:db8::10/128", ["2001:db8::10/128"]],
    ["смешанный список IPv4 и IPv6", "192.0.2.10,2001:db8::10", ["192.0.2.10", "2001:db8::10"]],
    [
      "несколько адресов и сетей",
      "192.0.2.10,198.51.100.0/24,2001:db8:1::/64",
      ["192.0.2.10", "198.51.100.0/24", "2001:db8:1::/64"],
    ],
    ["пробелы вокруг элементов", " 192.0.2.10 , 2001:db8::10 ", ["192.0.2.10", "2001:db8::10"]],
  ])("принимает %s", (_caseName, trustedProxies, expected) => {
    expect(
      createGenerationRateLimitConfig({
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
        ...(trustedProxies === undefined ? {} : { GENERATION_TRUSTED_PROXIES: trustedProxies }),
      }).trustedProxies,
    ).toEqual(expected);
  });

  it.each([
    ["пустую строку", ""],
    ["пробельную строку", "   "],
    ["пустой элемент", "192.0.2.10, ,198.51.100.10"],
    ["ведущую запятую", ",192.0.2.10"],
    ["завершающую запятую", "192.0.2.10,"],
    ["двойную запятую", "192.0.2.10,,198.51.100.10"],
    ["boolean true", "true"],
    ["boolean false", "false"],
    ["wildcard", "*"],
    ["hostname", "proxy.example"],
    ["число hop", "1"],
    ["некорректный IPv4", "999.0.2.10"],
    ["некорректный IPv6", "2001:db8:::10"],
    ["IPv4 сеть с нулевым prefix", "0.0.0.0/0"],
    ["IPv6 сеть с нулевым prefix", "::/0"],
    ["IPv4 адрес с нулевым prefix", "192.0.2.10/0"],
    ["IPv6 адрес с нулевым prefix", "2001:db8::10/0"],
    ["IPv4 prefix вне диапазона", "192.0.2.0/33"],
    ["IPv6 prefix вне диапазона", "2001:db8::/129"],
    ["отрицательный prefix", "192.0.2.0/-1"],
    ["дробный prefix", "192.0.2.0/24.5"],
    ["частично разобранный prefix", "192.0.2.0/24suffix"],
    ["неоднозначный prefix", "192.0.2.0/024"],
  ])("отклоняет %s", (_caseName, trustedProxies) => {
    expect(() =>
      createGenerationRateLimitConfig({
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
        GENERATION_TRUSTED_PROXIES: trustedProxies,
      }),
    ).toThrow("Invalid generation rate limit configuration");
  });

  it.each(["true", "false"])("отклоняет legacy-переменную trust proxy=%s", (legacyValue) => {
    expect(() =>
      createGenerationRateLimitConfig({
        GENERATION_CLIENT_COOKIE_SECRET: validSecret,
        GENERATION_TRUST_PROXY: legacyValue,
      }),
    ).toThrow("Invalid generation rate limit configuration");
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
        GENERATION_TRUSTED_PROXIES: "192.0.2.10, 2001:db8:1::/64",
        GENERATION_RATE_LIMIT_STATE_CAPACITY: "500",
      }),
    ).toEqual({
      ipRequestLimit: 7,
      ipWindowMs: 90_000,
      clientDailyLimit: 30,
      cookieSecret: validSecret,
      trustedProxies: ["192.0.2.10", "2001:db8:1::/64"],
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
