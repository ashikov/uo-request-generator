import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleGateway, type OpenAiCompatibleGatewayConfig } from "../src";
import { requestDraftLimits } from "../src/request-draft.js";

const MOCK_API_KEY = "test-key-123";
const VALID_INPUT = { description: "На лестничной площадке не горит свет" };
const GATEWAY_CONFIG: OpenAiCompatibleGatewayConfig = {
  apiUrl: "https://provider.example/v1/chat/completions",
  apiKey: MOCK_API_KEY,
  model: "test-model",
  authScheme: "Api-Key",
  apiProtocol: "chat-completions",
};

const VALID_DRAFT = {
  title: "Не работает освещение на этаже",
  problem: "На лестничной площадке не горит свет.",
  impact: null,
  requests: ["Проверить и восстановить освещение"],
  warnings: [],
};
const VALID_LLM_TEXT = JSON.stringify(VALID_DRAFT);

const VALID_LLM_RESPONSE = {
  title: "Не работает освещение на этаже",
  body: [
    "На лестничной площадке не горит свет.",
    "",
    "Прошу:",
    "1. Проверить и восстановить освещение",
  ].join("\n"),
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

  it("передаёт новый общий prompt в Chat Completions и парсит JSON-черновик", async () => {
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
    expect(callBody.messages[0]?.content).toContain("Верни только один валидный JSON-объект");
    expect(callBody.messages[0]?.content).toContain('"impact": null');
    expect(callBody.messages[0]?.content).toContain('"warnings": []');
    expect(callBody.messages[0]?.content).toContain("без нумерации");
    expect(callBody.instructions).toBeUndefined();
    expect(callBody.input).toBeUndefined();
    expect(callBody.max_output_tokens).toBeUndefined();
    expect(callBody.text).toBeUndefined();

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
    const text = JSON.stringify({
      title: "Течь на кухне",
      problem: "На кухне течёт кран.",
      impact: null,
      requests: ["Отремонтировать кран"],
      warnings: ["Пользователь выразил эмоции", "Не указана причина протечки"],
    });

    createMockFetch(text);

    const gateway = createGateway();

    const result = await gateway.generateRequest(VALID_INPUT);

    expect(result.title).toBe("Течь на кухне");
    expect(result.body).toContain("Отремонтировать");
    expect(result.warnings).toHaveLength(2);
  });

  it("отклоняет синтаксически корректный JSON, не соответствующий схеме черновика", async () => {
    createMockFetch(JSON.stringify({ title: "Тестовая заявка" }));

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

  it("не обрезает и отклоняет заголовок сверх лимита", async () => {
    const emoji = "🎉";
    const titleMax = 120;
    const prefix = "а".repeat(titleMax - 1);
    const title = prefix + emoji;

    const text = JSON.stringify({
      ...VALID_DRAFT,
      title,
    });

    createMockFetch(text);

    await expect(createGateway().generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM вернул некорректный формат заявки",
    );
  });

  describe("Responses API", () => {
    const responsesConfig: Partial<OpenAiCompatibleGatewayConfig> = {
      apiProtocol: "responses",
      apiUrl: "https://provider.example/v1/responses",
      authScheme: "Bearer",
    };

    it("отправляет Responses-запрос со строгой схемой черновика и поддерживает output_text без status", async () => {
      const mockFetch = createResponsesMockFetch({ output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      const result = await gateway.generateRequest(VALID_INPUT);

      expect(result).toEqual(VALID_LLM_RESPONSE);
      expect(mockFetch.mock.calls[0]?.[0]).toBe("https://provider.example/v1/responses");

      const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(callBody).toEqual({
        model: "test-model",
        instructions: expect.stringContaining("Верни только один валидный JSON-объект"),
        input: "Проблема: На лестничной площадке не горит свет",
        temperature: 0.3,
        max_output_tokens: 1000,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "request_draft",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string", minLength: 1, maxLength: requestDraftLimits.titleMax },
                problem: { type: "string", minLength: 1, maxLength: requestDraftLimits.problemMax },
                impact: {
                  type: ["string", "null"],
                  minLength: 1,
                  maxLength: requestDraftLimits.impactMax,
                },
                requests: {
                  type: "array",
                  minItems: 1,
                  maxItems: requestDraftLimits.requestsMax,
                  items: {
                    type: "string",
                    minLength: 1,
                    maxLength: requestDraftLimits.requestMax,
                  },
                },
                warnings: {
                  type: "array",
                  maxItems: requestDraftLimits.warningsMax,
                  items: {
                    type: "string",
                    minLength: 1,
                    maxLength: requestDraftLimits.warningMax,
                  },
                },
              },
              required: ["title", "problem", "impact", "requests", "warnings"],
              additionalProperties: false,
            },
          },
        },
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
      const firstBoundary = Math.floor(VALID_LLM_TEXT.length / 3);
      const secondBoundary = Math.floor((VALID_LLM_TEXT.length * 2) / 3);
      const textParts = [
        VALID_LLM_TEXT.slice(0, firstBoundary),
        VALID_LLM_TEXT.slice(firstBoundary, secondBoundary),
        VALID_LLM_TEXT.slice(secondBoundary),
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
              { type: "output_text", text: textParts[2], annotations: [] },
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
          JSON.stringify({ ...VALID_DRAFT, title: "Вложенный заголовок" }),
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

    it("использует тот же prompt и формирует тот же результат для обоих протоколов", async () => {
      const mockFetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ choices: [{ message: { content: VALID_LLM_TEXT } }] }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ output_text: VALID_LLM_TEXT }), { status: 200 }),
        );

      const chatResult = await createGateway().generateRequest(VALID_INPUT);
      const responsesResult = await createGateway(responsesConfig).generateRequest(VALID_INPUT);

      const chatBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      const responsesBody = JSON.parse(mockFetch.mock.calls[1]?.[1]?.body as string);

      expect(responsesBody.instructions).toBe(chatBody.messages[0]?.content);
      expect(responsesResult).toEqual(chatResult);
      expect(responsesResult).toEqual(VALID_LLM_RESPONSE);
    });
  });
});
