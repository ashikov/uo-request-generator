import { DisabledLlmGateway, OpenAiCompatibleGateway } from "@uo-request-generator/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmGateway } from "../src/llm-config.js";

const VALID_LLM_TEXT = [
  "ЗАГОЛОВОК: Не работает освещение",
  "",
  "На лестничной площадке не горит свет.",
  "Прошу: проверить и восстановить освещение.",
].join("\n");

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

  it("не определяет протокол по URL", async () => {
    const fetchMock = mockProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_URL: "https://provider.example/v1/responses",
      LLM_API_KEY: "test-api-key",
      LLM_AUTH_SCHEME: "Bearer",
      LLM_MODEL: "provider-model-name",
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
    });

    await gateway.generateRequest({ description: "Не работает освещение" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.input).toBeUndefined();
  });

  it("выбирает заглушку при неполной конфигурации", () => {
    expect(createLlmGateway({ LLM_API_KEY: "test-api-key" })).toBeInstanceOf(DisabledLlmGateway);
    expect(
      createLlmGateway({
        LLM_API_URL: "https://provider.example/v1/chat/completions",
        LLM_API_KEY: "test-api-key",
      }),
    ).toBeInstanceOf(DisabledLlmGateway);
  });

  it("выбирает заглушку при неизвестном протоколе", () => {
    expect(
      createLlmGateway({
        LLM_API_PROTOCOL: "completions",
        LLM_API_URL: "https://provider.example/v1/chat/completions",
        LLM_API_KEY: "test-api-key",
        LLM_AUTH_SCHEME: "Bearer",
        LLM_MODEL: "provider-model-name",
      }),
    ).toBeInstanceOf(DisabledLlmGateway);
  });
});
