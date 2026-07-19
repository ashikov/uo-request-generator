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
  });

  it("создаёт стандартную Bearer-конфигурацию с явными URL и моделью", async () => {
    const fetchMock = mockProviderResponse();
    const gateway = createLlmGateway({
      LLM_API_URL: "https://provider.example/v1/chat/completions",
      LLM_API_KEY: "test-api-key",
      LLM_AUTH_SCHEME: "Bearer",
      LLM_MODEL: "provider-model-name",
    });

    expect(gateway).toBeInstanceOf(OpenAiCompatibleGateway);

    await gateway.generateRequest({ description: "На лестничной площадке не горит свет" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://provider.example/v1/chat/completions");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-api-key",
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.model).toBe("provider-model-name");
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
});
