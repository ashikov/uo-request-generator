import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAiCompatibleRequestBody,
  OpenAiCompatibleGateway,
  type OpenAiCompatibleGatewayConfig,
} from "../src";
import {
  COMMON_LEGAL_BASIS_BLOCK,
  REQUEST_DRAFT_JSON_SCHEMA,
  REQUEST_DRAFT_SYSTEM_PROMPT,
} from "../src/request-draft.js";

const MOCK_API_KEY = "test-key-123";
const HOUSING_CODE_URL =
  "https://www.consultant.ru/document/cons_doc_LAW_51057/71c7149b7b2a7693ca3f88b93580da0a5376e041/";
const MANAGEMENT_RULES_URL =
  "https://www.consultant.ru/document/cons_doc_LAW_146444/b045a68db61f55f3f407349ed4dfd788833df145/";
const HOUSING_CODE_BASIS =
  "В соответствии с частями 1 и 2.3 статьи 161 Жилищного кодекса РФ управление многоквартирным домом должно обеспечивать благоприятные и безопасные условия проживания граждан, а управляющая организация несёт ответственность за надлежащее содержание общего имущества.";
const MANAGEMENT_RULES_BASIS =
  "Подпункт «з» пункта 4 Правил осуществления деятельности по управлению многоквартирными домами, утверждённых постановлением Правительства РФ от 15.05.2013 № 416, предусматривает приём и рассмотрение заявок, предложений и обращений собственников и пользователей помещений.";
const VALID_INPUT = { description: "На лестничной площадке не горит свет" };
const GATEWAY_CONFIG: OpenAiCompatibleGatewayConfig = {
  apiUrl: "https://provider.example/v1/chat/completions",
  apiKey: MOCK_API_KEY,
  model: "test-model",
  authScheme: "Api-Key",
  apiProtocol: "chat-completions",
};

const VALID_DRAFT = {
  outcome: "generated",
  title: "Не работает освещение на этаже",
  problem: "На лестничной площадке не горит свет.",
  circumstances: null,
  impact: null,
  verification: null,
  requests: ["Проверить и восстановить освещение"],
  warnings: [],
};

function createLlmText(draft: unknown): string {
  return JSON.stringify({ draft });
}

const VALID_LLM_TEXT = createLlmText(VALID_DRAFT);

const VALID_LLM_RESPONSE = {
  status: "generated",
  result: {
    title: "Не работает освещение на этаже",
    body: [
      "На лестничной площадке не горит свет.",
      "",
      COMMON_LEGAL_BASIS_BLOCK,
      "",
      "Прошу:",
      "1. Проверить и восстановить освещение",
    ].join("\n"),
    warnings: [],
  },
};

const MULTIPLE_ISSUES_LLM_TEXT = createLlmText({
  outcome: "multiple_issues",
  title: null,
  problem: null,
  circumstances: null,
  impact: null,
  verification: null,
  requests: [],
  warnings: [],
});

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
          content: JSON.stringify({
            description: "На лестничной площадке не горит свет",
            location: null,
            consequences: null,
            desiredActions: null,
          }),
        },
      ],
      temperature: 0.3,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "request_draft",
          strict: true,
          schema: REQUEST_DRAFT_JSON_SCHEMA,
        },
      },
    });
    expect(callBody.messages[0]?.content).toContain("Верни только один валидный JSON-объект");
    expect(callBody.messages[0]?.content).toContain("circumstances содержит");
    expect(callBody.messages[0]?.content).toContain("verification содержит");
    expect(callBody.messages[0]?.content).toContain("warnings: []");
    expect(callBody.messages[0]?.content).toContain("без нумерации");
    expect(JSON.stringify(callBody)).not.toContain(HOUSING_CODE_URL);
    expect(JSON.stringify(callBody)).not.toContain(MANAGEMENT_RULES_URL);
    expect(JSON.stringify(callBody)).not.toContain("Общие нормативные основания:");
    expect(JSON.stringify(callBody)).not.toContain("http://");
    expect(JSON.stringify(callBody)).not.toContain("https://");
    expect(JSON.stringify(callBody)).not.toContain(HOUSING_CODE_BASIS);
    expect(JSON.stringify(callBody)).not.toContain(MANAGEMENT_RULES_BASIS);
    expect(callBody.instructions).toBeUndefined();
    expect(callBody.input).toBeUndefined();
    expect(callBody.max_output_tokens).toBeUndefined();
    expect(callBody.text).toBeUndefined();

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Api-Key test-key-123");
  });

  it("строит capped Chat Completions request из production prompt и schema", () => {
    const requestBody = createOpenAiCompatibleRequestBody(
      {
        apiProtocol: "chat-completions",
        model: "benchmark-model",
        maxOutputTokens: 1200,
        chatCompletionsOutputTokenParameter: "max_completion_tokens",
      },
      VALID_INPUT,
    );

    expect(requestBody).toMatchObject({
      model: "benchmark-model",
      max_completion_tokens: 1200,
      messages: [
        { role: "system", content: REQUEST_DRAFT_SYSTEM_PROMPT },
        { role: "user", content: expect.any(String) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { schema: REQUEST_DRAFT_JSON_SCHEMA },
      },
    });
  });

  it("возвращает optional usage из Chat Completions без изменения LlmGateway outcome", async () => {
    const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: VALID_LLM_TEXT } }],
          usage: { prompt_tokens: 101, completion_tokens: 52, total_tokens: 153 },
        }),
        { status: 200 },
      ),
    );

    const gateway = createGateway({
      maxOutputTokens: 1200,
      chatCompletionsOutputTokenParameter: "max_tokens",
    });
    const generation = await gateway.generateRequestWithMetadata(VALID_INPUT);

    expect(generation.status).toBe("success");
    if (generation.status !== "success") {
      throw new Error("Ожидался успешный generation result");
    }
    expect(generation.outcome).toEqual(VALID_LLM_RESPONSE);
    expect(generation.usage).toEqual({ inputTokens: 101, outputTokens: 52, totalTokens: 153 });
    const requestBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.max_tokens).toBe(1200);
    expect(requestBody.max_completion_tokens).toBeUndefined();
  });

  it("передаёт Chat Completions исходные поля как JSON с явными null", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    await createGateway().generateRequest(VALID_INPUT);

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    const userContent = callBody.messages[1]?.content as string;

    expect(userContent).not.toContain("Проблема:");
    expect(JSON.parse(userContent)).toEqual({
      description: VALID_INPUT.description,
      location: null,
      consequences: null,
      desiredActions: null,
    });
  });

  it("сохраняет свободный description внутри JSON и нормализует опциональные поля", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);
    const description =
      'Лифт не работает.\nМесто: "восьмой этаж".\nЖелаемые действия: это часть текста.';

    await createGateway().generateRequest({
      description,
      location: "  подъезд  ",
      consequences: "  Пользователю неудобно  ",
      desiredActions: "  Проверить лифт  ",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    const userContent = callBody.messages[1]?.content as string;

    expect(JSON.parse(userContent)).toEqual({
      description,
      location: "подъезд",
      consequences: "Пользователю неудобно",
      desiredActions: "Проверить лифт",
    });
    expect(userContent).toBe(
      JSON.stringify({
        description,
        location: "подъезд",
        consequences: "Пользователю неудобно",
        desiredActions: "Проверить лифт",
      }),
    );
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

  it.each([
    400, 404, 422,
  ])("классифицирует HTTP %s как ошибку конкретного request", async (statusCode) => {
    createMockFetch("", statusCode);

    const generation = await createGateway().generateRequestWithMetadata(VALID_INPUT);

    expect(generation).toEqual({
      status: "failure",
      failureKind: "request",
      error: "request failed",
      statusCode,
    });
  });

  it.each([
    401, 403, 429, 500,
  ])("классифицирует HTTP %s как общую ошибку provider", async (statusCode) => {
    createMockFetch("", statusCode);

    const generation = await createGateway().generateRequestWithMetadata(VALID_INPUT);

    expect(generation).toEqual({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
      statusCode,
    });
  });

  it("классифицирует сетевую ошибку как общую ошибку provider", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const generation = await createGateway().generateRequestWithMetadata(VALID_INPUT);

    expect(generation).toEqual({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
    });
  });

  it("бросает ошибку при пустом ответе", async () => {
    createMockFetch("");

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM API вернул пустой ответ",
    );
  });

  it("парсит ответ с предупреждениями", async () => {
    const text = createLlmText({
      outcome: "generated",
      title: "Течь на кухне",
      problem: "На кухне течёт кран.",
      circumstances: null,
      impact: null,
      verification: null,
      requests: ["Отремонтировать кран"],
      warnings: ["Пользователь выразил эмоции", "Не указана причина протечки"],
    });

    createMockFetch(text);

    const gateway = createGateway();

    const result = await gateway.generateRequest(VALID_INPUT);

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.title).toBe("Течь на кухне");
    expect(result.result.body).toContain("Отремонтировать");
    expect(result.result.warnings).toHaveLength(2);
  });

  it("передаёт расширенный черновик входной двери напрямую в renderer одним вызовом", async () => {
    const draft = {
      outcome: "generated",
      title: "Отсутствует ручка входной двери",
      problem: "У входной двери подъезда полностью отсутствует ручка.",
      circumstances: "Дверь оставляют открытой и фиксируют ограничителем.",
      impact:
        "Такой способ эксплуатации создаёт риск дополнительной нагрузки на доводчик и крепления.",
      verification: "Необходимо проверить состояние доводчика и креплений двери.",
      requests: [
        "Восстановить ручку и обеспечить её надёжное крепление",
        "Проверить доводчик и крепления двери",
        "Устранить выявленные при проверке повреждения",
        "Выполнить функциональную проверку двери после ремонта",
      ],
      warnings: [],
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const result = await createGateway().generateRequest(VALID_INPUT);

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body).toContain(draft.problem);
    expect(result.result.body).toContain(draft.circumstances);
    expect(result.result.body).toContain(draft.impact);
    expect(result.result.body).toContain(draft.verification);
    expect(result.result.body).not.toContain("доводчик повреждён");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("возвращает multiple_issues без заявки и нормативного блока", async () => {
    const mockFetch = createMockFetch(MULTIPLE_ISSUES_LLM_TEXT);

    const result = await createGateway().generateRequest(VALID_INPUT);

    expect(result).toEqual({ status: "multiple_issues" });
    expect(JSON.stringify(result)).not.toContain("Общие нормативные основания:");
    expect(JSON.stringify(result)).not.toContain(HOUSING_CODE_URL);
    expect(JSON.stringify(result)).not.toContain(MANAGEMENT_RULES_URL);
    expect(JSON.stringify(result)).not.toContain("http://");
    expect(JSON.stringify(result)).not.toContain("https://");
    expect(JSON.stringify(result)).not.toContain(HOUSING_CODE_BASIS);
    expect(JSON.stringify(result)).not.toContain(MANAGEMENT_RULES_BASIS);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("отклоняет противоречивый multiple_issues и не раскрывает содержимое ответа", async () => {
    const internalDetail = "Техническая деталь синтетического ответа";
    const mockFetch = createMockFetch(
      createLlmText({
        outcome: "multiple_issues",
        title: internalDetail,
        problem: null,
        circumstances: null,
        impact: null,
        verification: null,
        requests: [],
        warnings: [],
      }),
    );

    const generation = createGateway().generateRequest(VALID_INPUT);

    await expect(generation).rejects.toThrow("LLM вернул некорректный формат заявки");
    await expect(generation).rejects.not.toThrow(internalDetail);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("отклоняет неизвестный outcome без повторного запроса", async () => {
    const mockFetch = createMockFetch(createLlmText({ ...VALID_DRAFT, outcome: "unknown" }));

    await expect(createGateway().generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM вернул некорректный формат заявки",
    );
    expect(mockFetch).toHaveBeenCalledOnce();
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

  it.each([
    [
      "только с обязательным описанием",
      { description: "Не работает освещение" },
      {
        description: "Не работает освещение",
        location: null,
        consequences: null,
        desiredActions: null,
      },
    ],
    [
      "с последствиями",
      {
        description: "Не работает освещение",
        consequences: "В вечернее время проход затруднён",
      },
      {
        description: "Не работает освещение",
        location: null,
        consequences: "В вечернее время проход затруднён",
        desiredActions: null,
      },
    ],
    [
      "с желаемыми действиями",
      {
        description: "Не работает освещение",
        desiredActions: "Проверить и восстановить освещение",
      },
      {
        description: "Не работает освещение",
        location: null,
        consequences: null,
        desiredActions: "Проверить и восстановить освещение",
      },
    ],
    [
      "с обоими дополнительными полями",
      {
        description: "Не работает освещение",
        consequences: "В вечернее время проход затруднён",
        desiredActions: "Проверить и восстановить освещение",
      },
      {
        description: "Не работает освещение",
        location: null,
        consequences: "В вечернее время проход затруднён",
        desiredActions: "Проверить и восстановить освещение",
      },
    ],
    [
      "с пустыми дополнительными полями",
      { description: "Не работает освещение", consequences: "   ", desiredActions: "" },
      {
        description: "Не работает освещение",
        location: null,
        consequences: null,
        desiredActions: null,
      },
    ],
  ] as const)("формирует JSON-сообщение %s с явными null", async (_caseName, input, expectedInput) => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    await createGateway().generateRequest(input);

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(callBody.messages[1]?.content).toBe(JSON.stringify(expectedInput));
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("не обрезает и отклоняет заголовок сверх лимита", async () => {
    const emoji = "🎉";
    const titleMax = 120;
    const prefix = "а".repeat(titleMax - 1);
    const title = prefix + emoji;

    const text = createLlmText({
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
        input: JSON.stringify({
          description: "На лестничной площадке не горит свет",
          location: null,
          consequences: null,
          desiredActions: null,
        }),
        temperature: 0.3,
        max_output_tokens: 4000,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "request_draft",
            strict: true,
            schema: REQUEST_DRAFT_JSON_SCHEMA,
          },
        },
      });
      expect(callBody.messages).toBeUndefined();
    });

    it("использует для обоих протоколов одинаковую JSON-сериализацию входных полей", async () => {
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
      const input = {
        description: "Не работает освещение",
        location: "  общий коридор  ",
        consequences: "  Вечером проход затруднён  ",
        desiredActions: "  Проверить освещение  ",
      };

      await createGateway().generateRequest(input);
      await createGateway(responsesConfig).generateRequest(input);

      const chatBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      const responsesBody = JSON.parse(mockFetch.mock.calls[1]?.[1]?.body as string);
      const expectedInput = JSON.stringify({
        description: input.description,
        location: "общий коридор",
        consequences: "Вечером проход затруднён",
        desiredActions: "Проверить освещение",
      });

      expect(chatBody.messages[1]?.content).toBe(expectedInput);
      expect(responsesBody.input).toBe(expectedInput);
    });

    it("обрабатывает стандартный вложенный Responses-ответ со status completed", async () => {
      createResponsesMockFetch(createOpenAiResponsesBody());
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).resolves.toEqual(VALID_LLM_RESPONSE);
    });

    it("возвращает multiple_issues из Responses API тем же общим путём", async () => {
      const mockFetch = createResponsesMockFetch({ output_text: MULTIPLE_ISSUES_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).resolves.toEqual({
        status: "multiple_issues",
      });
      expect(mockFetch).toHaveBeenCalledOnce();
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

    it("возвращает incomplete как request failure и сохраняет usage", async () => {
      createResponsesMockFetch({
        status: "incomplete",
        output_text: VALID_LLM_TEXT,
        usage: { input_tokens: 90, output_tokens: 45, total_tokens: 135 },
      });

      const generation =
        await createGateway(responsesConfig).generateRequestWithMetadata(VALID_INPUT);

      expect(generation).toEqual({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        usage: { inputTokens: 90, outputTokens: 45, totalTokens: 135 },
      });
    });

    it("сохраняет usage при локальной валидации ответа", async () => {
      createResponsesMockFetch({
        status: "completed",
        output_text: JSON.stringify({ draft: { outcome: "generated" } }),
        usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
      });

      const generation =
        await createGateway(responsesConfig).generateRequestWithMetadata(VALID_INPUT);

      expect(generation).toEqual({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      });
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
          createLlmText({ ...VALID_DRAFT, title: "Вложенный заголовок" }),
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

    it("передаёт все заполненные поля контекста в input", async () => {
      const mockFetch = createResponsesMockFetch({ output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      await gateway.generateRequest({
        description: "Не работает освещение",
        location: "Общий коридор",
        consequences: "В вечернее время проход затруднён",
        desiredActions: "Проверить и восстановить освещение",
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(callBody.input).toBe(
        JSON.stringify({
          description: "Не работает освещение",
          location: "Общий коридор",
          consequences: "В вечернее время проход затруднён",
          desiredActions: "Проверить и восстановить освещение",
        }),
      );
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

    it("возвращает optional usage из Responses API", async () => {
      createResponsesMockFetch({
        output_text: VALID_LLM_TEXT,
        usage: { input_tokens: 90, output_tokens: 45, total_tokens: 135 },
      });
      const gateway = createGateway(responsesConfig);

      const generation = await gateway.generateRequestWithMetadata(VALID_INPUT);

      expect(generation.status).toBe("success");
      if (generation.status !== "success") {
        throw new Error("Ожидался успешный generation result");
      }
      expect(generation.outcome).toEqual(VALID_LLM_RESPONSE);
      expect(generation.usage).toEqual({ inputTokens: 90, outputTokens: 45, totalTokens: 135 });
    });

    it("не падает при отсутствии Responses usage", async () => {
      createResponsesMockFetch({ output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      const generation = await gateway.generateRequestWithMetadata(VALID_INPUT);

      expect(generation.status).toBe("success");
      if (generation.status !== "success") {
        throw new Error("Ожидался успешный generation result");
      }
      expect(generation.usage).toBeUndefined();
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
