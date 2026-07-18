import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleGateway } from "../src";

const MOCK_API_KEY = "test-key-123";
const VALID_INPUT = { description: "На лестничной площадке не горит свет" };

const VALID_LLM_TEXT = [
  "ЗАГОЛОВОК: Не работает освещение на этаже",
  "",
  "На лестничной площадке не горит свет. Прошу: проверить и восстановить освещение.",
  "",
  "ПРЕДУПРЕЖДЕНИЯ:",
].join("\n");

const VALID_LLM_RESPONSE = {
  title: "Не работает освещение на этаже",
  body: "На лестничной площадке не горит свет. Прошу: проверить и восстановить освещение.",
  warnings: [],
};

function createMockFetch(llmText: string, status = 200) {
  const body = { choices: [{ message: { content: llmText } }] };
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("OpenAiCompatibleGateway", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("отклоняет пустой API-ключ", () => {
    expect(() => new OpenAiCompatibleGateway({ apiKey: "" })).toThrow("LLM_API_KEY");
  });

  it("отправляет запрос с корректным телом и парсит ответ", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = new OpenAiCompatibleGateway({ apiKey: MOCK_API_KEY });
    const result = await gateway.generateRequest(VALID_INPUT);

    expect(result).toEqual(VALID_LLM_RESPONSE);

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(callBody.model).toBe("yandexgpt/latest");
    expect(callBody.messages).toHaveLength(2);
    expect(callBody.messages[0]?.role).toBe("system");
    expect(callBody.messages[1]?.role).toBe("user");
    expect(callBody.messages[1]?.content).toContain("не горит свет");

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Api-Key test-key-123");
  });

  it("использует переданную authScheme", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = new OpenAiCompatibleGateway({
      apiKey: MOCK_API_KEY,
      authScheme: "Bearer",
    });

    await gateway.generateRequest(VALID_INPUT);

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key-123");
  });

  it("бросает ошибку при HTTP-ошибке", async () => {
    createMockFetch("", 503);

    const gateway = new OpenAiCompatibleGateway({ apiKey: MOCK_API_KEY });

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM API вернул ошибку: 503",
    );
  });

  it("бросает ошибку при пустом ответе", async () => {
    createMockFetch("");

    const gateway = new OpenAiCompatibleGateway({ apiKey: MOCK_API_KEY });

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM API вернул пустой ответ",
    );
  });

  it("парсит ответ с предупреждениями", async () => {
    const text = [
      "ЗАГОЛОВОК: Течь на кухне",
      "",
      "На кухне течёт кран. Прошу: отремонтировать.",
      "",
      "ПРЕДУПРЕЖДЕНИЯ:",
      "— Пользователь выразил эмоции",
      "— Не указана причина протечки",
    ].join("\n");

    createMockFetch(text);

    const gateway = new OpenAiCompatibleGateway({ apiKey: MOCK_API_KEY });

    const result = await gateway.generateRequest(VALID_INPUT);

    expect(result.title).toBe("Течь на кухне");
    expect(result.body).toContain("отремонтировать");
    expect(result.warnings).toHaveLength(2);
  });

  it("принимает кастомный URL и модель", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = new OpenAiCompatibleGateway({
      apiKey: MOCK_API_KEY,
      apiUrl: "https://custom.api.com/v1/chat/completions",
      model: "custom-model",
    });

    await gateway.generateRequest(VALID_INPUT);

    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://custom.api.com/v1/chat/completions");

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(callBody.model).toBe("custom-model");
  });

  it("передаёт extraHeaders в запрос", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = new OpenAiCompatibleGateway({
      apiKey: MOCK_API_KEY,
      extraHeaders: { "x-folder-id": "test-folder" },
    });

    await gateway.generateRequest(VALID_INPUT);

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["x-folder-id"]).toBe("test-folder");
  });

  it("включает location в запрос, если он передан", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = new OpenAiCompatibleGateway({ apiKey: MOCK_API_KEY });

    await gateway.generateRequest({
      description: "Течёт кран",
      location: "Кухня, третий этаж",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(callBody.messages[1]?.content).toContain("Кухня");
  });
});
