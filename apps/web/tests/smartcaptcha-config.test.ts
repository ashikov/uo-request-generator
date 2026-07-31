import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createSmartCaptchaConfig, toPublicSmartCaptchaConfig } from "../src/smartcaptcha-config";

describe("конфигурация SmartCaptcha", () => {
  it("создаёт отключённую конфигурацию без ключей", () => {
    expect(
      createSmartCaptchaConfig({
        SMARTCAPTCHA_MODE: "disabled",
      }),
    ).toEqual({ mode: "disabled" });
  });

  it("создаёт обязательную конфигурацию с парой ключей", () => {
    expect(
      createSmartCaptchaConfig({
        SMARTCAPTCHA_MODE: "required",
        SMARTCAPTCHA_CLIENT_KEY: "test-public-client-key",
        SMARTCAPTCHA_SERVER_KEY: "test-private-server-key",
      }),
    ).toEqual({
      mode: "required",
      clientKey: "test-public-client-key",
      serverKey: "test-private-server-key",
    });
  });

  it.each([
    ["неизвестный режим", { SMARTCAPTCHA_MODE: "optional" }],
    [
      "обязательный режим без клиентского ключа",
      {
        SMARTCAPTCHA_MODE: "required",
        SMARTCAPTCHA_SERVER_KEY: "test-private-server-key",
      },
    ],
    [
      "обязательный режим без серверного ключа",
      {
        SMARTCAPTCHA_MODE: "required",
        SMARTCAPTCHA_CLIENT_KEY: "test-public-client-key",
      },
    ],
    [
      "пустой клиентский ключ",
      {
        SMARTCAPTCHA_MODE: "required",
        SMARTCAPTCHA_CLIENT_KEY: " ",
        SMARTCAPTCHA_SERVER_KEY: "test-private-server-key",
      },
    ],
    [
      "пустой серверный ключ",
      {
        SMARTCAPTCHA_MODE: "required",
        SMARTCAPTCHA_CLIENT_KEY: "test-public-client-key",
        SMARTCAPTCHA_SERVER_KEY: " ",
      },
    ],
  ])("отклоняет %s", (_caseName, environment) => {
    expect(() => createSmartCaptchaConfig(environment)).toThrow(
      "Invalid SmartCaptcha configuration",
    );
  });

  it("требует явный режим для подключённого LLM", () => {
    expect(() => createSmartCaptchaConfig({})).toThrow("Invalid SmartCaptcha configuration");
  });

  it("разрешает неявно отключённый режим только для локального disabled gateway", () => {
    expect(createSmartCaptchaConfig({}, { allowImplicitDisabled: true })).toEqual({
      mode: "disabled",
    });
  });

  it("не раскрывает серверный ключ в публичном представлении", () => {
    const serverKey = "test-private-server-key";

    const publicConfig = toPublicSmartCaptchaConfig({
      mode: "required",
      clientKey: "test-public-client-key",
      serverKey,
    });

    expect(publicConfig).toEqual({
      required: true,
      clientKey: "test-public-client-key",
    });
    expect(JSON.stringify(publicConfig)).not.toContain(serverKey);
  });

  it("возвращает узкое публичное представление отключённого режима", () => {
    expect(toPublicSmartCaptchaConfig({ mode: "disabled" })).toEqual({
      required: false,
    });
  });

  it("не создаёт приложение с подключённым gateway без явной CAPTCHA-конфигурации", () => {
    expect(() =>
      createApp({
        llmGateway: {
          async generateRequest() {
            return {
              status: "generated" as const,
              result: {
                title: "Тестовая заявка",
                body: "Обезличенный тестовый текст",
                warnings: [],
              },
            };
          },
        },
        generationRateLimitConfig: {
          ipRequestLimit: 3,
          ipWindowMs: 60_000,
          clientDailyLimit: 20,
          cookieSecret: "test-cookie-signing-secret-32-characters",
          trustedProxies: [],
          stateCapacity: 1_000,
        },
      }),
    ).toThrow("SmartCaptcha configuration is required");
  });
});
