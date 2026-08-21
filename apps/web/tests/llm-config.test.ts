import { DisabledLlmGateway, OpenAiCompatibleGateway } from "@uo-request-generator/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmGateway } from "../src/llm-config.js";

const VALID_LLM_TEXT = JSON.stringify({
  draft: {
    outcome: "generated",
    title: "Не работает освещение",
    problem: "На лестничной площадке не горит свет.",
    circumstances: null,
    impact: null,
    verification: null,
    subject: null,
    actionPlan: {
      preliminaryCheck: null,
      remedyActions: ["Проверить и восстановить освещение"],
      resultCheck: null,
    },
    warnings: [],
  },
});

function mockProviderResponse() {
  const body = { choices: [{ message: { content: VALID_LLM_TEXT } }] };
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

function mockYandexResponsesProviderResponse() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ output_text: VALID_LLM_TEXT }), { status: 200 }),
    );
}

function mockOpenAiResponsesProviderResponse() {
  const body = {
    id: "resp_test",
    object: "response",
    status: "completed",
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: VALID_LLM_TEXT,
            annotations: [],
          },
        ],
      },
    ],
  };
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

describe("createLlmGateway", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("выбирает заглушку без LLM-переменных", () => {
    expect(createLlmGateway({})).toBeInstanceOf(DisabledLlmGateway);
  });

  it("создаёт Yandex-конфигурацию из API-ключа и folder ID", async () => {
    const fetchMock = mockProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_KEY: "test-api-key",
      LLM_FOLDER_ID: "test-folder-id",
    });

    expect(gateway).toBeInstanceOf(OpenAiCompatibleGateway);

    await gateway.generateRequest({ description: "На лестничной площадке не горит свет" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://ai.api.cloud.yandex.net/v1/chat/completions",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Api-Key test-api-key",
      "x-folder-id": "test-folder-id",
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.model).toBe("gpt://test-folder-id/yandexgpt/latest");
    expect(requestBody.messages).toHaveLength(2);
  });

  it("передаёт yandex как provider metadata встроенной конфигурации", async () => {
    mockProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_KEY: "test-api-key",
      LLM_FOLDER_ID: "test-folder-id",
    });

    if (!(gateway instanceof OpenAiCompatibleGateway)) {
      throw new Error("Ожидался OpenAiCompatibleGateway");
    }
    const generation = await gateway.generateRequestWithMetadata({
      description: "На лестничной площадке не горит свет",
    });

    expect(generation).toMatchObject({ status: "success", metadata: { provider: "yandex" } });
  });

  it("явно выбирает Yandex Chat Completions", async () => {
    const fetchMock = mockProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_PROTOCOL: "chat-completions",
      LLM_API_KEY: "test-api-key",
      LLM_FOLDER_ID: "test-folder-id",
    });

    await gateway.generateRequest({ description: "Не работает освещение" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://ai.api.cloud.yandex.net/v1/chat/completions",
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.messages).toHaveLength(2);
  });

  it("создаёт Yandex Responses-конфигурацию с Alice AI LLM Flash", async () => {
    const fetchMock = mockYandexResponsesProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_PROTOCOL: "responses",
      LLM_API_KEY: "test-api-key",
      LLM_FOLDER_ID: "test-folder-id",
    });

    expect(gateway).toBeInstanceOf(OpenAiCompatibleGateway);

    await gateway.generateRequest({ description: "Не работает освещение" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://ai.api.cloud.yandex.net/v1/responses");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Api-Key test-api-key",
      "x-folder-id": "test-folder-id",
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.model).toBe("gpt://test-folder-id/aliceai-llm-flash/latest");
    expect(requestBody.messages).toBeUndefined();
    expect(requestBody.store).toBe(false);
  });

  it("переопределяет модель Yandex Responses через LLM_MODEL", async () => {
    const fetchMock = mockYandexResponsesProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_PROTOCOL: "responses",
      LLM_API_KEY: "test-api-key",
      LLM_FOLDER_ID: "test-folder-id",
      LLM_MODEL: "gpt://test-folder-id/custom-model/latest",
    });

    await gateway.generateRequest({ description: "Не работает освещение" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.model).toBe("gpt://test-folder-id/custom-model/latest");
  });

  it.each([
    ["chat-completions", "https://provider.example/v1/custom-chat"],
    ["responses", "https://provider.example/v1/custom-responses"],
  ] as const)("создаёт стандартную Bearer-конфигурацию для протокола %s", async (apiProtocol, apiUrl) => {
    const fetchMock =
      apiProtocol === "responses" ? mockOpenAiResponsesProviderResponse() : mockProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_PROTOCOL: apiProtocol,
      LLM_API_URL: apiUrl,
      LLM_API_KEY: "test-api-key",
      LLM_AUTH_SCHEME: "Bearer",
      LLM_MODEL: "provider-model-name",
      LLM_PROVIDER: "provider-alpha",
    });

    expect(gateway).toBeInstanceOf(OpenAiCompatibleGateway);

    await gateway.generateRequest({ description: "Не работает освещение" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(apiUrl);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-api-key",
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.model).toBe("provider-model-name");
    expect(requestBody.messages !== undefined).toBe(apiProtocol === "chat-completions");
    expect(requestBody.input !== undefined).toBe(apiProtocol === "responses");
    expect(requestBody.store).toBe(apiProtocol === "responses" ? false : undefined);
  });

  it("сохраняет разные custom provider identifiers для одной model", async () => {
    const environment = {
      LLM_API_URL: "https://provider.example/v1/chat/completions",
      LLM_API_KEY: "test-api-key",
      LLM_AUTH_SCHEME: "Bearer",
      LLM_MODEL: "shared-model-name",
    };
    const firstFetch = mockProviderResponse();
    const firstGateway = createLlmGateway({ ...environment, LLM_PROVIDER: "provider-alpha" });
    if (!(firstGateway instanceof OpenAiCompatibleGateway)) {
      throw new Error("Ожидался OpenAiCompatibleGateway");
    }
    const first = await firstGateway.generateRequestWithMetadata({
      description: "Не работает свет",
    });
    firstFetch.mockRestore();

    mockProviderResponse();
    const secondGateway = createLlmGateway({ ...environment, LLM_PROVIDER: "provider-beta" });
    if (!(secondGateway instanceof OpenAiCompatibleGateway)) {
      throw new Error("Ожидался OpenAiCompatibleGateway");
    }
    const second = await secondGateway.generateRequestWithMetadata({
      description: "Не работает свет",
    });

    expect(first).toMatchObject({
      metadata: { provider: "provider-alpha", model: "shared-model-name" },
    });
    expect(second).toMatchObject({
      metadata: { provider: "provider-beta", model: "shared-model-name" },
    });
  });

  it("не определяет протокол по URL", async () => {
    const fetchMock = mockProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_URL: "https://provider.example/v1/responses",
      LLM_API_KEY: "test-api-key",
      LLM_AUTH_SCHEME: "Bearer",
      LLM_MODEL: "provider-model-name",
      LLM_PROVIDER: "provider-alpha",
    });

    expect(gateway).toBeInstanceOf(OpenAiCompatibleGateway);

    await gateway.generateRequest({ description: "Не работает освещение" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.input).toBeUndefined();
  });

  it("не определяет протокол по имени модели", async () => {
    const fetchMock = mockProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_URL: "https://provider.example/v1/chat",
      LLM_API_KEY: "test-api-key",
      LLM_AUTH_SCHEME: "Bearer",
      LLM_MODEL: "responses-model-name",
      LLM_PROVIDER: "provider-alpha",
    });

    await gateway.generateRequest({ description: "Не работает освещение" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.input).toBeUndefined();
  });

  it.each([
    ["URL", { LLM_API_URL: "https://provider.example/v1/chat/completions" }],
    ["API key", { LLM_API_KEY: "test-private-api-key" }],
    ["model", { LLM_MODEL: "test-private-model" }],
    ["provider", { LLM_PROVIDER: "provider-alpha" }],
    ["auth scheme", { LLM_AUTH_SCHEME: "Bearer" }],
    ["protocol", { LLM_API_PROTOCOL: "responses" }],
    ["folder ID", { LLM_FOLDER_ID: "test-folder-id" }],
  ])("отклоняет отдельно заданный %s", (_name, environment) => {
    expect(() => createLlmGateway(environment)).toThrow("Invalid LLM configuration");
  });

  const completeCustomConfiguration = {
    LLM_API_URL: "https://provider.example/v1/chat/completions",
    LLM_API_KEY: "test-private-api-key",
    LLM_AUTH_SCHEME: "Bearer",
    LLM_MODEL: "test-private-model",
    LLM_PROVIDER: "provider-alpha",
  };

  it.each([
    ["provider", { ...completeCustomConfiguration, LLM_PROVIDER: undefined }],
    ["model", { ...completeCustomConfiguration, LLM_MODEL: undefined }],
    ["auth scheme", { ...completeCustomConfiguration, LLM_AUTH_SCHEME: undefined }],
    ["API key", { ...completeCustomConfiguration, LLM_API_KEY: undefined }],
  ])("отклоняет custom URL без %s", (_name, environment) => {
    expect(() => createLlmGateway(environment)).toThrow("Invalid LLM configuration");
  });

  it.each([
    [
      "provider identifier",
      { ...completeCustomConfiguration, LLM_PROVIDER: "provider identifier" },
    ],
    ["protocol", { ...completeCustomConfiguration, LLM_API_PROTOCOL: "completions" }],
    ["URL", { ...completeCustomConfiguration, LLM_API_URL: "not-a-url" }],
    ["empty API key", { ...completeCustomConfiguration, LLM_API_KEY: "" }],
  ])("отклоняет невалидный %s", (_name, environment) => {
    expect(() => createLlmGateway(environment)).toThrow("Invalid LLM configuration");
  });

  it("не раскрывает private configuration values в сообщении ошибки", () => {
    const privateApiKey = "test-private-api-key-sentinel";
    const privateUrl = "https://provider.example/private-endpoint";
    const privateModel = "test-private-model-sentinel";

    expect(() =>
      createLlmGateway({
        LLM_API_URL: privateUrl,
        LLM_API_KEY: privateApiKey,
        LLM_AUTH_SCHEME: "Bearer",
        LLM_MODEL: privateModel,
        LLM_PROVIDER: "provider identifier",
      }),
    ).toThrow("Invalid LLM configuration");

    try {
      createLlmGateway({
        LLM_API_URL: privateUrl,
        LLM_API_KEY: privateApiKey,
        LLM_AUTH_SCHEME: "Bearer",
        LLM_MODEL: privateModel,
        LLM_PROVIDER: "provider identifier",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(privateApiKey);
      expect(message).not.toContain(privateUrl);
      expect(message).not.toContain(privateModel);
      return;
    }

    throw new Error("Ожидалась ошибка конфигурации LLM");
  });
});
