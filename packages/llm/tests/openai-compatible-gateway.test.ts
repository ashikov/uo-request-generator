import { generateRequestLimits } from "@uo-request-generator/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleGateway, type OpenAiCompatibleGatewayConfig } from "../src";

const MOCK_API_KEY = "test-key-123";
const VALID_INPUT = { description: "На лестничной площадке не горит свет" };
const GATEWAY_CONFIG: OpenAiCompatibleGatewayConfig = {
  apiUrl: "https://provider.example/v1/chat/completions",
  apiKey: MOCK_API_KEY,
  model: "test-model",
  authScheme: "Api-Key",
  apiProtocol: "chat-completions",
};

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

function createResponsesMockFetch(responseBody: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(responseBody), { status }));
}

function createOpenAiResponsesBody(
  outputText: unknown = VALID_LLM_TEXT,
  options: { includeStatus?: boolean; status?: unknown } = {},
) {
  const { includeStatus = true, status = "completed" } = options;

  return {
    id: "resp_test",
    object: "response",
    ...(includeStatus ? { status } : {}),
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: outputText,
            annotations: [],
          },
        ],
      },
    ],
  };
}

function createGateway(config: Partial<OpenAiCompatibleGatewayConfig> = {}) {
  return new OpenAiCompatibleGateway({ ...GATEWAY_CONFIG, ...config });
}

describe("OpenAiCompatibleGateway", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("отклоняет пустой API-ключ", () => {
    expect(() => createGateway({ apiKey: "" })).toThrow("LLM_API_KEY");
  });

  it("отправляет запрос с корректным телом и парсит ответ", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = createGateway();
    const result = await gateway.generateRequest(VALID_INPUT);

    expect(result).toEqual(VALID_LLM_RESPONSE);

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(callBody).toEqual({
      model: "test-model",
      messages: [
        expect.objectContaining({ role: "system" }),
        {
          role: "user",
          content: "Проблема: На лестничной площадке не горит свет",
        },
      ],
      temperature: 0.3,
    });
    expect(callBody.messages[0]?.content).toContain("Формат ответа:");
    expect(callBody.instructions).toBeUndefined();
    expect(callBody.input).toBeUndefined();
    expect(callBody.max_output_tokens).toBeUndefined();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Api-Key test-key-123");
  });

  it("использует переданную authScheme", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = createGateway({ authScheme: "Bearer" });

    await gateway.generateRequest(VALID_INPUT);

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key-123");
  });

  it("бросает ошибку при HTTP-ошибке", async () => {
    createMockFetch("", 503);

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "Generation provider is not configured",
    );
  });

  it("бросает ошибку при пустом ответе", async () => {
    createMockFetch("");

    const gateway = createGateway();

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

    const gateway = createGateway();

    const result = await gateway.generateRequest(VALID_INPUT);

    expect(result.title).toBe("Течь на кухне");
    expect(result.body).toContain("отремонтировать");
    expect(result.warnings).toHaveLength(2);
  });

  it("принимает body в пределах лимита", async () => {
    const request = "Прошу: устранить неисправность.";
    const description = "а".repeat(generateRequestLimits.result.bodyMax - request.length - 1);
    const body = `${description}\n${request}`;
    const text = ["ЗАГОЛОВОК: Тестовая заявка", "", body].join("\n");

    createMockFetch(text);

    const result = await createGateway().generateRequest(VALID_INPUT);

    expect(result.body).toBe(body);
    expect(result.body).toHaveLength(generateRequestLimits.result.bodyMax);
  });

  it("отклоняет body длиннее лимита", async () => {
    const body = `Прошу: ${"а".repeat(generateRequestLimits.result.bodyMax)}`;
    const text = ["ЗАГОЛОВОК: Тестовая заявка", "", body].join("\n");

    createMockFetch(text);

    await expect(createGateway().generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM вернул некорректный формат заявки",
    );
  });

  it("отклоняет ответ, если раздел «Прошу:» находится после границы body", async () => {
    const body = `${"а".repeat(generateRequestLimits.result.bodyMax)}\nПрошу: устранить неисправность.`;
    const text = ["ЗАГОЛОВОК: Тестовая заявка", "", body].join("\n");

    createMockFetch(text);

    await expect(createGateway().generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM вернул некорректный формат заявки",
    );
  });

  it("отклоняет body без раздела «Прошу:»", async () => {
    const text = ["ЗАГОЛОВОК: Тестовая заявка", "", "На лестничной площадке не горит свет."].join(
      "\n",
    );

    createMockFetch(text);

    await expect(createGateway().generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM вернул некорректный формат заявки",
    );
  });

  it("принимает кастомный URL и модель", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = createGateway({
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

    const gateway = createGateway({
      extraHeaders: { "x-folder-id": "test-folder" },
    });

    await gateway.generateRequest(VALID_INPUT);

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["x-folder-id"]).toBe("test-folder");
  });

  it("бросает GenerationProviderUnavailableError при сетевой ошибке", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "Generation provider is not configured",
    );
  });

  it("бросает GenerationProviderUnavailableError при таймауте (AbortError)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "Generation provider is not configured",
    );
  });

  it("бросает GenerationProviderUnavailableError при невалидном JSON от API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }));

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "Generation provider is not configured",
    );
  });

  it("бросает GenerationProviderUnavailableError при невалидной структуре ответа API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ wrong: "data" }), { status: 200 }),
    );

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "Generation provider is not configured",
    );
  });

  it("бросает ошибку при whitespace-only ответе от LLM", async () => {
    const body = { choices: [{ message: { content: "   " } }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM API вернул пустой ответ",
    );
  });

  it("включает location в запрос, если он передан", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    const gateway = createGateway();

    await gateway.generateRequest({
      description: "Течёт кран",
      location: "Кухня, третий этаж",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(callBody.messages[1]?.content).toContain("Кухня");
  });

  it("безопасно обрезает текст с эмодзи на границе лимита", async () => {
    const emoji = "🎉";
    const titleMax = 120;
    const prefix = "а".repeat(titleMax - 1);
    const title = prefix + emoji;

    const text = [`ЗАГОЛОВОК: ${title}`, "", "Течёт кран. Прошу: отремонтировать."].join("\n");

    createMockFetch(text);

    const gateway = createGateway();
    const result = await gateway.generateRequest(VALID_INPUT);

    expect(result.title).toBe(prefix);
    expect(result.title.length).toBe(titleMax - 1);
  });

  describe("Responses API", () => {
    const responsesConfig: Partial<OpenAiCompatibleGatewayConfig> = {
      apiProtocol: "responses",
      apiUrl: "https://provider.example/v1/responses",
      authScheme: "Bearer",
    };

    it("отправляет Responses-запрос с отключённым хранением и поддерживает output_text без status", async () => {
      const mockFetch = createResponsesMockFetch({ output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      const result = await gateway.generateRequest(VALID_INPUT);

      expect(result).toEqual(VALID_LLM_RESPONSE);
      expect(mockFetch.mock.calls[0]?.[0]).toBe("https://provider.example/v1/responses");

      const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(callBody).toEqual({
        model: "test-model",
        instructions: expect.stringContaining("Формат ответа:"),
        input: "Проблема: На лестничной площадке не горит свет",
        temperature: 0.3,
        max_output_tokens: 1000,
        store: false,
      });
      expect(callBody.messages).toBeUndefined();
    });

    it("обрабатывает стандартный вложенный Responses-ответ со status completed", async () => {
      createResponsesMockFetch(createOpenAiResponsesBody());
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).resolves.toEqual(VALID_LLM_RESPONSE);
    });

    it("отклоняет incomplete-ответ с валидным верхнеуровневым текстом", async () => {
      createResponsesMockFetch({
        status: "incomplete",
        output_text: VALID_LLM_TEXT,
      });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("отклоняет incomplete-ответ с валидным вложенным текстом", async () => {
      createResponsesMockFetch(createOpenAiResponsesBody(VALID_LLM_TEXT, { status: "incomplete" }));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("отклоняет стандартный вложенный Responses-ответ без status", async () => {
      createResponsesMockFetch(createOpenAiResponsesBody(VALID_LLM_TEXT, { includeStatus: false }));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it.each([
      "failed",
      "unknown_status",
    ])("отклоняет незавершённый status %s с валидным текстом", async (status) => {
      createResponsesMockFetch({ status, output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("контролируемо отклоняет status неверного типа", async () => {
      createResponsesMockFetch({ status: 42, output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("находит текст не в первом элементе output", async () => {
      const responseBody = createOpenAiResponsesBody();
      responseBody.output.unshift({
        id: "reasoning_test",
        type: "reasoning",
        role: "assistant",
        status: "completed",
        content: [],
      });
      createResponsesMockFetch(responseBody);
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).resolves.toEqual(VALID_LLM_RESPONSE);
    });

    it("объединяет текстовые части из нескольких сообщений в исходном порядке", async () => {
      const textParts = [
        "ЗАГОЛОВОК: Не работает освещение на этаже\n\n",
        "На лестничной площадке не горит свет. ",
        "Прошу: проверить и восстановить освещение.\n\n",
        "ПРЕДУПРЕЖДЕНИЯ:",
      ];
      createResponsesMockFetch({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [
          {
            id: "msg_first",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", text: textParts[0], annotations: [] },
              { type: "output_text", text: textParts[1], annotations: [] },
            ],
          },
          {
            id: "msg_second",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", text: textParts[2], annotations: [] },
              { type: "output_text", text: textParts[3], annotations: [] },
            ],
          },
        ],
      });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).resolves.toEqual(VALID_LLM_RESPONSE);
    });

    it("игнорирует нетекстовые и неизвестные элементы рядом с корректным текстом", async () => {
      createResponsesMockFetch({
        id: "resp_test",
        object: "response",
        status: "completed",
        output: [
          {
            id: "reasoning_test",
            type: "reasoning",
            summary: [],
          },
          {
            id: "tool_test",
            type: "function_call",
            call_id: "call_test",
            name: "test_function",
            arguments: "{}",
            status: "completed",
          },
          {
            type: "custom_item",
          },
          {
            id: "msg_test",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              { type: "refusal", refusal: "Отказ не должен попасть в результат" },
              { type: "custom_block", text: "Неизвестный блок" },
              { type: "output_text", text: VALID_LLM_TEXT, annotations: [] },
            ],
          },
        ],
      });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).resolves.toEqual(VALID_LLM_RESPONSE);
    });

    it("предпочитает непустой верхнеуровневый текст без дублирования", async () => {
      createResponsesMockFetch({
        output_text: VALID_LLM_TEXT,
        ...createOpenAiResponsesBody(
          VALID_LLM_TEXT.replace("Не работает освещение на этаже", "Вложенный заголовок"),
        ),
      });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).resolves.toEqual(VALID_LLM_RESPONSE);
    });

    it.each([
      ["пустом", ""],
      ["состоящем только из пробелов", "   "],
      ["равном null", null],
    ])("использует вложенный текст при %s верхнеуровневом output_text и status completed", async (_caseName, text) => {
      createResponsesMockFetch({
        ...createOpenAiResponsesBody(),
        output_text: text,
      });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).resolves.toEqual(VALID_LLM_RESPONSE);
    });

    it.each([
      ["пустом", ""],
      ["состоящем только из пробелов", "   "],
      ["равном null", null],
    ])("отклоняет вложенный текст при %s верхнеуровневом output_text без status", async (_caseName, text) => {
      createResponsesMockFetch({
        ...createOpenAiResponsesBody(VALID_LLM_TEXT, { includeStatus: false }),
        output_text: text,
      });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("передаёт location в input", async () => {
      const mockFetch = createResponsesMockFetch({ output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      await gateway.generateRequest({
        description: "Не работает освещение",
        location: "Общий коридор",
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(callBody.input).toBe("Проблема: Не работает освещение\n\nМесто: Общий коридор");
    });

    it("использует заданный лимит выходных токенов", async () => {
      const mockFetch = createResponsesMockFetch({ output_text: VALID_LLM_TEXT });
      const gateway = createGateway({
        ...responsesConfig,
        maxOutputTokens: 1200,
      });

      await gateway.generateRequest(VALID_INPUT);

      const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(callBody.max_output_tokens).toBe(1200);
    });

    it("использует схему авторизации и дополнительные заголовки", async () => {
      const mockFetch = createResponsesMockFetch(createOpenAiResponsesBody());
      const gateway = createGateway({
        ...responsesConfig,
        extraHeaders: { "x-project-id": "test-project-id" },
      });

      await gateway.generateRequest(VALID_INPUT);

      expect(mockFetch.mock.calls[0]?.[1]?.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: "Bearer test-key-123",
        "x-project-id": "test-project-id",
      });
    });

    it.each([
      ["пустой", ""],
      ["состоящий только из пробелов", "   "],
    ])("отклоняет %s output_text", async (_caseName, outputText) => {
      createResponsesMockFetch({ output_text: outputText });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "LLM API вернул пустой ответ",
      );
    });

    it.each([
      ["без текстовых элементов", { status: "completed", output: [] }],
      [
        "только с refusal",
        {
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "Отказ не должен попасть в ошибку" }],
            },
          ],
        },
      ],
      ["с пустым вложенным текстом", createOpenAiResponsesBody("")],
      ["с whitespace-only вложенным текстом", createOpenAiResponsesBody("   ")],
    ])("отклоняет ответ %s как пустой", async (_caseName, body) => {
      createResponsesMockFetch(body);
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "LLM API вернул пустой ответ",
      );
    });

    it.each([
      ["отсутствующий", {}],
      ["с неверным типом output_text", { output_text: 42 }],
      ["с неверным типом output", { output: "not-an-array" }],
      ["с неверным типом content", { output: [{ type: "message", content: "not-an-array" }] }],
      ["с неверным типом text", createOpenAiResponsesBody(42)],
    ])("контролируемо отклоняет %s ответ", async (_caseName, body) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), { status: 200 }),
      );
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("контролируемо обрабатывает невалидный JSON", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("контролируемо обрабатывает HTTP-ошибку", async () => {
      createResponsesMockFetch({ output_text: "" }, 503);
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("контролируемо обрабатывает сетевую ошибку", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("контролируемо обрабатывает таймаут", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new DOMException("The operation was aborted", "AbortError"),
      );
      const gateway = createGateway({
        ...responsesConfig,
        timeoutMs: 10,
      });

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "Generation provider is not configured",
      );
    });

    it("передаёт извлечённый текст в общий парсер заявки", async () => {
      createResponsesMockFetch(createOpenAiResponsesBody("Ответ без ожидаемого формата заявки"));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
        "LLM вернул некорректный формат заявки",
      );
    });
  });
});
