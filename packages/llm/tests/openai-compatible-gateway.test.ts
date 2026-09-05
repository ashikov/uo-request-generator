import {
  COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
  PRIMARY_REQUEST_SUBJECT_KINDS,
} from "@uo-request-generator/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAiCompatibleRequestBody,
  GenerationInvalidResponseError,
  GenerationNetworkError,
  GenerationProviderUnavailableError,
  GenerationTimeoutError,
  OpenAiCompatibleGateway,
  type OpenAiCompatibleGatewayConfig,
} from "../src";
import {
  COMMON_LEGAL_BASIS_BLOCK,
  createRequestDraftJsonSchema,
  createRequestDraftSystemPrompt,
  createRequestDraftSystemPromptHash,
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
  provider: "test-provider",
  authScheme: "Api-Key",
  apiProtocol: "chat-completions",
};

const VALID_DRAFT = {
  outcome: "generated",
  title: "Не работает освещение на этаже",
  problem: "На лестничной площадке не горит свет.",
  circumstances: null,
  impact: null,
  subject: null,
  warnings: [],
};

function draftForDescription(description: string) {
  return {
    ...VALID_DRAFT,
    problem: description,
  };
}

function draftForInput(input: { description: string }) {
  void input;
  return VALID_DRAFT;
}

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
      "1. Устранить наблюдаемую проблему.",
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
  subject: null,
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

function rejectWhenSignalTimesOut(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const rejectWithTimeoutReason = () => {
      expect(signal.reason).toBeInstanceOf(DOMException);
      expect(signal.reason).toHaveProperty("name", "TimeoutError");
      reject(signal.reason);
    };

    if (signal.aborted) {
      rejectWithTimeoutReason();
      return;
    }

    signal.addEventListener("abort", rejectWithTimeoutReason, { once: true });
  });
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
    expect(callBody.messages[0]?.content).toContain("backend сам добавит его в раздел «Прошу:»");
    expect(callBody.messages[0]?.content).toContain("warnings: []");
    expect(callBody.messages[0]?.content).not.toContain("install_observed_missing_element");
    expect(JSON.stringify(callBody.response_format)).not.toContain("targetQuote");
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

  it.each([
    "chat-completions",
    "responses",
  ] as const)("передаёт provider через %s только предметные входные поля без backend-подтверждения", (apiProtocol) => {
    const confirmedProblemSubject = "common_area_elevator";
    const requestBody = createOpenAiCompatibleRequestBody(
      { apiProtocol, model: "benchmark-model", maxOutputTokens: 1200 },
      {
        description: "В кабине лифта не работает освещение",
        location: "второй подъезд",
        consequences: "В кабине темно",
        desiredActions: "Восстановить освещение",
        confirmedProblemSubject,
      },
    );
    const independentInferencePrompt = createRequestDraftSystemPrompt(confirmedProblemSubject);
    const independentInferenceSchema = createRequestDraftJsonSchema(confirmedProblemSubject);
    const userMessage =
      "messages" in requestBody ? requestBody.messages[1]?.content : requestBody.input;

    if ("messages" in requestBody) {
      expect(requestBody.messages[0]?.content).toBe(independentInferencePrompt);
      expect(requestBody.response_format.json_schema.schema).toEqual(independentInferenceSchema);
    } else {
      expect(requestBody.instructions).toBe(independentInferencePrompt);
      expect(requestBody.text.format.schema).toEqual(independentInferenceSchema);
    }

    expect(JSON.parse(userMessage ?? "")).toEqual({
      description: "В кабине лифта не работает освещение",
      location: "второй подъезд",
      consequences: "В кабине темно",
      desiredActions: "Восстановить освещение",
    });
  });

  it.each(
    PRIMARY_REQUEST_SUBJECT_KINDS,
  )("сохраняет provider-facing coverage поддержанного subject %s", (confirmedProblemSubject) => {
    const requestBody = createOpenAiCompatibleRequestBody(
      { apiProtocol: "chat-completions", model: "benchmark-model", maxOutputTokens: 1200 },
      { ...VALID_INPUT, confirmedProblemSubject },
    );

    if (!("messages" in requestBody)) {
      throw new Error("Ожидался Chat Completions request");
    }
    expect(requestBody.messages[0]?.content).toBe(
      createRequestDraftSystemPrompt(PRIMARY_REQUEST_SUBJECT_KINDS[0]),
    );
    expect(requestBody.response_format.json_schema.schema).toEqual(
      createRequestDraftJsonSchema(PRIMARY_REQUEST_SUBJECT_KINDS[0]),
    );
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
    expect(generation.metadata).toMatchObject({
      provider: "test-provider",
      model: "test-model",
      usage: { inputTokens: 101, outputTokens: 52, totalTokens: 153 },
      usageStatus: "available",
      durationMs: expect.any(Number),
    });
    expect(generation.metadata.durationMs).toBeGreaterThanOrEqual(0);
    const requestBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(generation.metadata.systemPromptHash).toBe(
      createRequestDraftSystemPromptHash(requestBody.messages[0].content),
    );
    expect(requestBody.max_tokens).toBe(1200);
    expect(requestBody.max_completion_tokens).toBeUndefined();
  });

  it.each([
    ["отсутствующем", undefined, "missing"],
    ["частичном", { prompt_tokens: 101, completion_tokens: 52 }, "invalid"],
    ["некорректном", { prompt_tokens: "101", completion_tokens: 52, total_tokens: 153 }, "invalid"],
  ] as const)("не ломает генерацию при %s Chat Completions usage", async (_caseName, usage, usageStatus) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: VALID_LLM_TEXT } }],
          ...(usage === undefined ? {} : { usage }),
        }),
        { status: 200 },
      ),
    );

    const generation = await createGateway().generateRequestWithMetadata(VALID_INPUT);

    expect(generation.status).toBe("success");
    if (generation.status !== "success") {
      throw new Error("Ожидался успешный generation result");
    }
    expect(generation.metadata).toMatchObject({ usage: null, usageStatus });
  });

  it("передаёт Chat Completions исходные поля как JSON с явными null", async () => {
    const mockFetch = createMockFetch(VALID_LLM_TEXT);

    await createGateway().generateRequest({
      ...VALID_INPUT,
      confirmedProblemSubject: "common_area_entrance_door",
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    const userContent = callBody.messages[1]?.content as string;

    expect(userContent).not.toContain("Проблема:");
    expect(JSON.parse(userContent)).toEqual({
      description: VALID_INPUT.description,
      location: null,
      consequences: null,
      desiredActions: null,
    });
    expect(userContent).not.toContain("isCommonAreaDoor");
  });

  it("сохраняет свободный description внутри JSON и нормализует опциональные поля", async () => {
    const description =
      'Лифт не работает.\nМесто: "восьмой этаж".\nЖелаемые действия: это часть текста.';
    const input = {
      description,
      location: "  подъезд  ",
      consequences: "  Пользователю неудобно  ",
      desiredActions: "  Проверить лифт  ",
    };
    const mockFetch = createMockFetch(createLlmText(draftForInput(input)));

    await createGateway().generateRequest(input);

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

    expect(generation).toMatchObject({
      status: "failure",
      failureKind: "request",
      error: "request failed",
      providerHttpStatus: statusCode,
    });
  });

  it.each([
    401, 403, 429, 500,
  ])("классифицирует HTTP %s как общую ошибку provider", async (statusCode) => {
    createMockFetch("", statusCode);

    const generation = await createGateway().generateRequestWithMetadata(VALID_INPUT);

    expect(generation).toMatchObject({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
      failureStatus: "provider_unavailable",
      providerHttpStatus: statusCode,
    });
  });

  it("классифицирует сетевую ошибку как общую ошибку provider", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const generation = await createGateway().generateRequestWithMetadata(VALID_INPUT);

    expect(generation).toMatchObject({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
    });
    expect(generation).toMatchObject({
      failureStatus: "network_error",
      metadata: {
        usage: null,
        usageStatus: "missing",
        durationMs: expect.any(Number),
      },
    });
    expect(generation).not.toHaveProperty("providerHttpStatus");
  });

  it("классифицирует реальный AbortSignal.timeout до HTTP-ответа", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (!(init?.signal instanceof AbortSignal)) {
        throw new Error("Ожидался AbortSignal");
      }

      return await rejectWhenSignalTimesOut(init.signal);
    });

    const gateway = createGateway({ timeoutMs: 5 });

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
      GenerationTimeoutError,
    );
    const generation = await gateway.generateRequestWithMetadata(VALID_INPUT);

    expect(generation).toMatchObject({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
      failureStatus: "timeout",
    });
    expect(generation).not.toHaveProperty("providerHttpStatus");
  });

  it("классифицирует реальный AbortSignal.timeout при чтении body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (!(init?.signal instanceof AbortSignal)) {
        throw new Error("Ожидался AbortSignal");
      }

      const response = new Response(JSON.stringify({}), { status: 200 });
      vi.spyOn(response, "json").mockImplementation(
        async () => await rejectWhenSignalTimesOut(init.signal as AbortSignal),
      );
      return response;
    });

    const gateway = createGateway({ timeoutMs: 5 });

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
      GenerationTimeoutError,
    );
    const generation = await gateway.generateRequestWithMetadata(VALID_INPUT);

    expect(generation).toMatchObject({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
      failureStatus: "timeout",
    });
    expect(generation).not.toHaveProperty("providerHttpStatus");
  });

  it("не возвращает HTTP-статус non-2xx при timeout чтения body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Ожидался AbortSignal");
      }

      const response = new Response(JSON.stringify({}), { status: 503 });
      vi.spyOn(response, "json").mockImplementation(
        async () => await rejectWhenSignalTimesOut(signal),
      );
      return response;
    });

    const generation = await createGateway({ timeoutMs: 5 }).generateRequestWithMetadata(
      VALID_INPUT,
    );

    expect(generation).toMatchObject({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
      failureStatus: "timeout",
    });
    expect(generation).not.toHaveProperty("providerHttpStatus");
  });

  it("бросает ошибку при пустом ответе", async () => {
    createMockFetch("");

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM API вернул пустой ответ",
    );
  });

  it("парсит ответ с предупреждениями", async () => {
    const input = { description: "На кухне течёт кран." };
    const text = createLlmText({
      outcome: "generated",
      title: "Течь на кухне",
      problem: input.description,
      circumstances: null,
      impact: null,
      subject: null,
      warnings: ["Пользователь выразил эмоции", "Не указана причина протечки"],
    });

    createMockFetch(text);

    const gateway = createGateway();

    const result = await gateway.generateRequest(input);

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.title).toBe("Течь на кухне");
    expect(result.result.body).toContain("Устранить наблюдаемую проблему");
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
      subject: {
        kind: "common_area_entrance_door",
        evidence: [
          {
            sourceField: "description",
            quote: "входной двери подъезда",
          },
        ],
      },
      warnings: [],
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const result = await createGateway().generateRequest({
      description: "У входной двери подъезда полностью отсутствует ручка.",
      confirmedProblemSubject: "common_area_entrance_door",
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body).toContain(draft.problem);
    expect(result.result.body).toContain(draft.circumstances);
    expect(result.result.body).toContain(draft.impact);
    expect(result.result.body).toContain("Прошу:\n1. Устранить наблюдаемую проблему");
    expect(result.result.body).toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.result.body).not.toContain("\n2. ");
    expect(result.result.body).not.toContain("доводчик повреждён");
    expect(result.result.body).not.toContain("Устранить выявленные повреждения");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("подключает модуль освещения только для matching subject с подтверждаемым evidence", async () => {
    const description =
      "В общем коридоре многоквартирного дома не работает освещение несколько дней.";
    const draft = {
      ...draftForDescription(description),
      subject: {
        kind: "common_area_premises_lighting",
        evidence: [{ sourceField: "description", quote: description }],
      },
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const result = await createGateway().generateRequest({
      description,
      confirmedProblemSubject: "common_area_premises_lighting",
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body).toContain(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("сохраняет lighting subject для отсутствия освещения в кабине без elevator module", async () => {
    const input = {
      description: "В кабине лифта не работает освещение.",
      location: "второй подъезд",
      consequences: "В кабине темно.",
      desiredActions: "Восстановить освещение.",
      confirmedProblemSubject: "common_area_premises_lighting" as const,
    };
    const draft = {
      ...VALID_DRAFT,
      title: "Не работает освещение в кабине лифта",
      problem: "Во втором подъезде в кабине лифта не работает освещение.",
      impact: "В кабине темно.",
      subject: {
        kind: "common_area_premises_lighting",
        evidence: [{ sourceField: "description", quote: input.description }],
      },
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const result = await createGateway().generateRequest(input);

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body).toContain(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.result.body).not.toContain(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.result.body).not.toContain("Заменить лампу");
    expect(result.result.body).not.toContain("неисправность проводки");
    expect(mockFetch).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>;
    };
    expect(requestBody.messages[0]?.content).toContain("включая кабину лифта");
    expect(requestBody.messages[0]?.content).toContain(
      "Отсутствие освещения в кабине лифта само по себе не подтверждает техническую проблему лифта",
    );
  });

  it("сохраняет elevator subject и модуль для подтверждённого индикатора положения", async () => {
    const input = {
      description: "На первом этаже не работает индикатор положения лифта.",
      location: "второй подъезд",
      consequences: "Из-за этого не видно, на каком этаже находится лифт.",
      desiredActions: "Восстановить работу индикатора.",
      confirmedProblemSubject: "common_area_elevator" as const,
    };
    const draft = {
      ...VALID_DRAFT,
      title: "Не работает индикатор положения лифта",
      problem: "Во втором подъезде на первом этаже не работает индикатор положения лифта.",
      impact: input.consequences,
      subject: {
        kind: "common_area_elevator",
        evidence: [{ sourceField: "description", quote: input.description }],
      },
    };
    createMockFetch(createLlmText(draft));

    const generation = await createGateway().generateRequestForEvaluation(input);

    expect(generation.status).toBe("success");
    if (generation.status !== "success" || generation.observation.draftOutcome !== "generated") {
      throw new Error("Ожидался generated evaluation result");
    }
    expect(generation.observation.draft.subject).toEqual(draft.subject);
    expect(generation.observation.selectedNormativeModule).toBe("common-area-elevator");
    expect(generation.observation.specificLegalBasisSelectionStatus).toBe("applied");
    expect(generation.outcome.status).toBe("generated");
    if (generation.outcome.status !== "generated") {
      throw new Error("Ожидалась готовая заявка");
    }
    expect(generation.outcome.result.body).toContain(
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0],
    );
  });

  it("диагностирует provider subject null для подтверждённого scenario без утечки текста", async () => {
    const input = {
      description: "На первом этаже не работает индикатор положения лифта.",
      confirmedProblemSubject: "common_area_elevator" as const,
    };
    const mockFetch = createMockFetch(
      createLlmText({ ...draftForDescription(input.description), subject: null }),
    );

    const generation = await createGateway().generateRequestForEvaluation(input);

    expect(generation.status).toBe("success");
    if (generation.status !== "success" || generation.observation.draftOutcome !== "generated") {
      throw new Error("Ожидался generated evaluation result");
    }
    expect(generation.observation.specificLegalBasisSelectionStatus).toBe("subject_absent");
    expect(generation.observation.selectedNormativeModule).toBeNull();
    expect(generation.outcome.status).toBe("generated");
    if (generation.outcome.status !== "generated") {
      throw new Error("Ожидалась готовая заявка");
    }
    expect(generation.outcome.result.body).not.toContain(
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(generation.observation.specificLegalBasisSelectionStatus).not.toContain(
      input.description,
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it.each([
    {
      caseName: "противоречивом lighting evidence",
      input: {
        description: "Освещение в кабине лифта работает.",
        confirmedProblemSubject: "common_area_premises_lighting" as const,
      },
      excludedParagraph: COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0],
      promptRule:
        "Если вход сообщает, что освещение работает, или сведения противоречат предмету освещения, укажи subject: null",
    },
    {
      caseName: "одном только отсутствии света при подтверждении лифта",
      input: {
        description: "В кабине лифта не работает освещение.",
        confirmedProblemSubject: "common_area_elevator" as const,
      },
      excludedParagraph: COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0],
      promptRule: "Отсутствие освещения в кабине лифта само по себе не подтверждает этот kind",
    },
  ])("остаётся fail closed при $caseName", async ({ input, excludedParagraph, promptRule }) => {
    const mockFetch = createMockFetch(createLlmText(draftForDescription(input.description)));

    const result = await createGateway().generateRequest(input);

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body).not.toContain(excludedParagraph);
    expect(mockFetch).toHaveBeenCalledOnce();
    const requestBody = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>;
    };
    expect(requestBody.messages[0]?.content).toContain(promptRule);
  });

  it("добавляет cleaning module ровно один раз для подтверждённого синтетического subject", async () => {
    const description = "В подъезде грязно, уборка не проводится около двух недель.";
    const location = "первый подъезд";
    const desiredActions = "Обеспечить регулярную уборку помещения общего пользования.";
    const paragraph = COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE.paragraphs[0];
    const draft = {
      outcome: "generated",
      title: "Не проводится уборка в подъезде",
      problem: "В первом подъезде около двух недель не проводится уборка.",
      circumstances: null,
      impact: null,
      subject: {
        kind: "common_area_premises_cleaning",
        evidence: [
          { sourceField: "description", quote: description },
          { sourceField: "location", quote: location },
        ],
      },
      warnings: [],
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const result = await createGateway().generateRequest({
      description,
      location,
      desiredActions,
      confirmedProblemSubject: "common_area_premises_cleaning",
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body.split(paragraph)).toHaveLength(2);
    expect(result.result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK)).toBeLessThan(
      result.result.body.indexOf(paragraph),
    );
    expect(result.result.body.indexOf(paragraph)).toBeLessThan(
      result.result.body.indexOf("Прошу:"),
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("не применяет модули при lighting subject под подтверждением лифта и сообщает mismatch", async () => {
    const description = "В кабине лифта не работает освещение.";
    const draft = {
      ...draftForDescription(description),
      subject: {
        kind: "common_area_premises_lighting",
        evidence: [{ sourceField: "description", quote: description }],
      },
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const generation = await createGateway().generateRequestForEvaluation({
      description,
      confirmedProblemSubject: "common_area_elevator",
    });

    expect(generation.status).toBe("success");
    if (generation.status !== "success" || generation.observation.draftOutcome !== "generated") {
      throw new Error("Ожидался generated evaluation result");
    }
    expect(generation.observation.specificLegalBasisSelectionStatus).toBe("subject_kind_mismatch");
    expect(generation.observation.selectedNormativeModule).toBeNull();
    expect(generation.outcome.status).toBe("generated");
    if (generation.outcome.status !== "generated") {
      throw new Error("Ожидалась готовая заявка");
    }
    expect(generation.outcome.result.body).not.toContain(
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(generation.outcome.result.body).not.toContain(
      COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "исправная загрязнённая дверь",
      "На входной двери загрязнение. Дверь открывается и закрывается нормально.",
      "common_area_entrance_door",
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0],
    ],
    [
      "загрязнение кабины работающего лифта",
      "В кабине лифта загрязнение. Лифт работает.",
      "common_area_elevator",
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0],
    ],
  ] as const)("сохраняет independently inferred cleaning, но fail closed для backend-подтверждения: %s", async (_caseName, description, confirmedProblemSubject, forbiddenTechnicalParagraph) => {
    const draft = {
      ...draftForDescription(description),
      subject: {
        kind: "common_area_premises_cleaning" as const,
        evidence: [{ sourceField: "description" as const, quote: description }],
      },
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const generation = await createGateway().generateRequestForEvaluation({
      description,
      confirmedProblemSubject,
    });

    expect(generation.status).toBe("success");
    if (generation.status !== "success" || generation.observation.draftOutcome !== "generated") {
      throw new Error("Ожидался generated evaluation result");
    }
    expect(generation.observation.draft.subject?.kind).toBe("common_area_premises_cleaning");
    expect(generation.observation.specificLegalBasisSelectionStatus).toBe("subject_kind_mismatch");
    expect(generation.observation.selectedNormativeModule).toBeNull();
    expect(generation.outcome.status).toBe("generated");
    if (generation.outcome.status !== "generated") {
      throw new Error("Ожидалась готовая заявка");
    }
    expect(generation.outcome.result.body).not.toContain(
      COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(generation.outcome.result.body).not.toContain(forbiddenTechnicalParagraph);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("диагностирует неподтверждаемое evidence и не применяет модуль", async () => {
    const input = {
      description: "У входной двери подъезда отсутствует ручка.",
      confirmedProblemSubject: "common_area_entrance_door" as const,
    };
    const draft = {
      ...draftForDescription(input.description),
      subject: {
        kind: "common_area_entrance_door",
        evidence: [
          {
            sourceField: "description",
            quote: "Входная дверь другого подъезда не закрывается.",
          },
        ],
      },
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const generation = await createGateway().generateRequestForEvaluation(input);

    expect(generation.status).toBe("success");
    if (generation.status !== "success" || generation.observation.draftOutcome !== "generated") {
      throw new Error("Ожидался generated evaluation result");
    }
    expect(generation.observation.specificLegalBasisSelectionStatus).toBe("evidence_unverifiable");
    expect(generation.observation.selectedNormativeModule).toBeNull();
    expect(generation.outcome.status).toBe("generated");
    if (generation.outcome.status !== "generated") {
      throw new Error("Ожидалась готовая заявка");
    }
    expect(generation.outcome.result.body).not.toContain(
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("диагностирует отсутствие подтверждения и не применяет inferred subject module", async () => {
    const draft = {
      ...VALID_DRAFT,
      subject: {
        kind: "common_area_entrance_door",
        evidence: [
          {
            sourceField: "description",
            quote: "входной двери подъезда",
          },
        ],
      },
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

    expect(generation.status).toBe("success");
    if (generation.status !== "success" || generation.observation.draftOutcome !== "generated") {
      throw new Error("Ожидался generated evaluation result");
    }
    expect(generation.observation.specificLegalBasisSelectionStatus).toBe("confirmation_absent");
    expect(generation.observation.selectedNormativeModule).toBeNull();
    expect(generation.outcome.status).toBe("generated");
    if (generation.outcome.status !== "generated") {
      throw new Error("Ожидалась готовая заявка");
    }
    expect(generation.outcome.result.body).not.toContain(
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["дверь квартиры", "Дверь квартиры не закрывается.", "Дверь квартиры"],
    ["бессмысленное evidence", "аааааааааа", "аааааааааа"],
  ])("не подключает предметный нормативный текст по ошибочному provider output: %s", async (_caseName, description, quote) => {
    const draft = {
      ...draftForDescription(description),
      subject: {
        kind: "common_area_entrance_door",
        evidence: [{ sourceField: "description", quote }],
      },
    };
    const mockFetch = createMockFetch(createLlmText(draft));

    const result = await createGateway().generateRequest({ description });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
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

  it("возвращает evaluation observation с фактическим validated multiple_issues draft", async () => {
    createMockFetch(MULTIPLE_ISSUES_LLM_TEXT);

    const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

    expect(generation.status).toBe("success");
    if (generation.status !== "success") {
      throw new Error("Ожидался успешный generation result");
    }
    expect(generation.outcome).toEqual({ status: "multiple_issues" });
    expect(generation.observation).toEqual({
      draftOutcome: "multiple_issues",
      multipleIssuesDraft: {
        outcome: "multiple_issues",
      },
    });
  });

  it("отбрасывает schema-valid generated-looking поля multiple_issues", async () => {
    const internalDetail = "Техническая деталь синтетического ответа";
    const mockFetch = createMockFetch(
      createLlmText({
        ...VALID_DRAFT,
        outcome: "multiple_issues",
        title: internalDetail,
      }),
    );

    const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

    expect(generation).toMatchObject({
      status: "success",
      outcome: { status: "multiple_issues" },
      observation: {
        draftOutcome: "multiple_issues",
        multipleIssuesDraft: { outcome: "multiple_issues" },
      },
    });
    expect(JSON.stringify(generation)).not.toContain(internalDetail);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("fail closed отклоняет malformed universal поле multiple_issues", async () => {
    const mockFetch = createMockFetch(
      createLlmText({
        outcome: "multiple_issues",
        title: 42,
        problem: null,
        circumstances: null,
        impact: null,
        subject: null,
        warnings: [],
      }),
    );

    await expect(createGateway().generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM вернул некорректный формат заявки",
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("отклоняет неизвестный outcome без повторного запроса", async () => {
    const mockFetch = createMockFetch(createLlmText({ ...VALID_DRAFT, outcome: "unknown" }));

    await expect(createGateway().generateRequest(VALID_INPUT)).rejects.toThrow(
      "LLM вернул некорректный формат заявки",
    );
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("fail closed отклоняет provider-authored request item без частичной заявки и повторного запроса", async () => {
    const providerAuthoredRequest = "Заменить проводку и выключатель";
    const mockFetch = createMockFetch(
      createLlmText({
        ...VALID_DRAFT,
        requestItems: [providerAuthoredRequest],
      }),
    );

    const generation = createGateway().generateRequest(VALID_INPUT);

    await expect(generation).rejects.toThrow("LLM вернул некорректный формат заявки");
    await expect(generation).rejects.not.toThrow(providerAuthoredRequest);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("fail closed отклоняет legacy procedural prose без compatibility fallback", async () => {
    const legacyMethod = "Заменить проводку и выключатель";
    const mockFetch = createMockFetch(
      createLlmText({
        outcome: "generated",
        title: VALID_DRAFT.title,
        problem: VALID_DRAFT.problem,
        circumstances: null,
        impact: null,
        verification: null,
        subject: null,
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: [legacyMethod],
          resultCheck: null,
        },
        warnings: [],
      }),
    );

    const generation = createGateway().generateRequest(VALID_INPUT);

    await expect(generation).rejects.toThrow("LLM вернул некорректный формат заявки");
    await expect(generation).rejects.not.toThrow(legacyMethod);
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

  it("бросает GenerationNetworkError при сетевой ошибке", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
      GenerationNetworkError,
    );
  });

  it("бросает GenerationInvalidResponseError при невалидном JSON от API", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("not json", { status: 200 }),
    );

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
      GenerationInvalidResponseError,
    );
    const generation = await gateway.generateRequestWithMetadata(VALID_INPUT);

    expect(generation).toMatchObject({
      status: "failure",
      failureKind: "request",
      error: "request failed",
      failureStatus: "invalid_response",
    });
    expect(generation).not.toHaveProperty("providerHttpStatus");
  });

  it("бросает GenerationInvalidResponseError при невалидной структуре ответа API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ wrong: "data" }), { status: 200 }),
    );

    const gateway = createGateway();

    await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
      GenerationInvalidResponseError,
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
    const input = {
      description: "Течёт кран",
      location: "Кухня, третий этаж",
    };
    const mockFetch = createMockFetch(createLlmText(draftForInput(input)));

    const gateway = createGateway();

    await gateway.generateRequest(input);

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
    const mockFetch = createMockFetch(createLlmText(draftForInput(input)));

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

  describe("privacy-safe evaluation diagnostics", () => {
    it("фиксирует network failure без текста исключения", async () => {
      const sentinel = "SECRET_NETWORK_DIAGNOSTIC";
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(sentinel));

      const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

      expect(generation).toMatchObject({
        status: "failure",
        failureStatus: "network_error",
        diagnosticTrace: {
          status: "failed",
          firstFailureStage: "network",
          stages: [{ stage: "network", status: "fail", reason: "network_error" }],
        },
      });
      expect(JSON.stringify(generation)).not.toContain(sentinel);
    });

    it("фиксирует HTTP failure только безопасным статусом", async () => {
      const sentinel = "SECRET_HTTP_BODY";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: sentinel }), { status: 503 }),
      );

      const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

      expect(generation).toMatchObject({
        status: "failure",
        providerHttpStatus: 503,
        diagnosticTrace: {
          status: "failed",
          firstFailureStage: "http",
          stages: [
            { stage: "network", status: "pass" },
            { stage: "http", status: "fail", httpStatus: 503 },
          ],
        },
      });
      expect(JSON.stringify(generation)).not.toContain(sentinel);
    });

    it("классифицирует Responses provider status и allowlisted error code", async () => {
      createResponsesMockFetch({
        status: "failed",
        error: { code: "server_error", message: "SECRET_PROVIDER_MESSAGE" },
      });

      const generation = await createGateway({
        apiProtocol: "responses",
        apiUrl: "https://provider.example/v1/responses",
      }).generateRequestForEvaluation(VALID_INPUT);

      expect(generation).toMatchObject({
        status: "failure",
        responsesFailure: {
          status: "failed",
          providerErrorCodeStatus: "known",
          providerErrorCode: "server_error",
        },
        diagnosticTrace: {
          firstFailureStage: "provider_status",
          stages: expect.arrayContaining([
            {
              stage: "provider_status",
              status: "fail",
              responsesStatus: "failed",
              providerErrorCodeStatus: "known",
              providerErrorCode: "server_error",
            },
          ]),
        },
      });
      expect(JSON.stringify(generation)).not.toContain("SECRET_PROVIDER_MESSAGE");
    });

    it.each([
      {
        caseName: "missing output",
        responseBody: { choices: [] },
        firstFailureStage: "output_extraction",
      },
      {
        caseName: "invalid output JSON",
        responseBody: { choices: [{ message: { content: "{SECRET_INVALID_JSON" } }] },
        firstFailureStage: "json_parse",
      },
    ])("разделяет $caseName по стадии", async ({ responseBody, firstFailureStage }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

      const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

      expect(generation).toMatchObject({
        status: "failure",
        diagnosticTrace: { status: "failed", firstFailureStage },
      });
      expect(JSON.stringify(generation)).not.toContain("SECRET_INVALID_JSON");
    });

    it.each([
      ["generated", VALID_LLM_TEXT, "generated"],
      ["multiple_issues", MULTIPLE_ISSUES_LLM_TEXT, "multiple_issues"],
    ] as const)("принимает representative %s response", async (_caseName, content, outcome) => {
      createMockFetch(content);

      const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

      expect(generation).toMatchObject({
        status: "success",
        observation: { draftOutcome: outcome },
        diagnosticTrace: { status: "completed" },
      });
    });

    it("диагностирует malformed generated response структурно и без значений", async () => {
      const sentinel = "SECRET_MALFORMED_TITLE";
      createMockFetch(
        createLlmText({
          ...VALID_DRAFT,
          title: { unexpected: sentinel },
        }),
      );

      const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

      expect(generation).toMatchObject({
        status: "failure",
        failureStatus: "invalid_response",
        diagnosticTrace: {
          status: "failed",
          firstFailureStage: "provider_wire_validation",
        },
      });
      expect(JSON.stringify(generation)).not.toContain(sentinel);
    });

    it.each([
      [
        { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        { status: "available", inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      ],
      [{ prompt_tokens: "SECRET_USAGE" }, { status: "invalid" }],
      [undefined, { status: "missing" }],
    ] as const)("возвращает privacy-safe usage: %o", async (usage, expectedUsage) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: MULTIPLE_ISSUES_LLM_TEXT } }],
            ...(usage === undefined ? {} : { usage }),
          }),
          { status: 200 },
        ),
      );

      const generation = await createGateway().generateRequestForEvaluation(VALID_INPUT);

      expect(generation.status).toBe("success");
      expect(generation.diagnosticTrace.usage).toEqual(expectedUsage);
      expect(JSON.stringify(generation)).not.toContain("SECRET_USAGE");
    });

    it("не расширяет production metadata диагностическим trace", async () => {
      createMockFetch(MULTIPLE_ISSUES_LLM_TEXT);

      const generation = await createGateway().generateRequestWithMetadata(VALID_INPUT);

      expect(generation.status).toBe("success");
      expect(generation).not.toHaveProperty("diagnosticTrace");
      expect(generation).not.toHaveProperty("diagnosticStages");
    });
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
      const input = {
        description: "Не работает освещение",
        location: "  общий коридор  ",
        consequences: "  Вечером проход затруднён  ",
        desiredActions: "  Проверить освещение  ",
      };
      const llmText = createLlmText(draftForInput(input));
      const mockFetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ choices: [{ message: { content: llmText } }] }), {
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ output_text: llmText }), { status: 200 }),
        );

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

    it("не разрешает вложенный Responses output через inherited status completed", async () => {
      const responseBody: Record<string, unknown> = {
        output: createOpenAiResponsesBody().output,
      };
      const responsePrototype = {};
      Object.defineProperty(responsePrototype, "status", {
        enumerable: true,
        get() {
          Object.defineProperty(responseBody, "status", {
            value: "completed",
            enumerable: true,
          });
          return "completed";
        },
      });
      Object.setPrototypeOf(responseBody, responsePrototype);
      const response = new Response(null, { status: 200 });
      vi.spyOn(response, "json").mockResolvedValue(responseBody);
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("не разрешает вложенный Responses output через Object.prototype.responsesStatus", async () => {
      const previousDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        "responsesStatus",
      );
      Object.defineProperty(Object.prototype, "responsesStatus", {
        value: "completed",
        configurable: true,
      });

      try {
        const response = new Response(null, { status: 200 });
        vi.spyOn(response, "json").mockResolvedValue({
          output: createOpenAiResponsesBody().output,
        });
        const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
        const gateway = createGateway(responsesConfig);

        await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
          GenerationInvalidResponseError,
        );
        expect(mockFetch).toHaveBeenCalledOnce();
      } finally {
        if (previousDescriptor === undefined) {
          Reflect.deleteProperty(Object.prototype, "responsesStatus");
        } else {
          Object.defineProperty(Object.prototype, "responsesStatus", previousDescriptor);
        }
      }
    });

    it("отклоняет own Responses status accessor без его вызова", async () => {
      const statusGetter = vi.fn(() => {
        throw new Error("SECRET_STATUS_ACCESSOR_247");
      });
      const responseBody = {
        output: createOpenAiResponsesBody().output,
      };
      Object.defineProperty(responseBody, "status", {
        enumerable: true,
        get: statusGetter,
      });
      const response = new Response(null, { status: 200 });
      vi.spyOn(response, "json").mockResolvedValue(responseBody);
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
      expect(statusGetter).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("защищает сырой Responses-ответ: отклоняет унаследованный output_text у пустого объекта", async () => {
      const responseBody = {};
      Object.setPrototypeOf(responseBody, { output_text: VALID_LLM_TEXT });
      const response = new Response(null, { status: 200 });
      vi.spyOn(response, "json").mockResolvedValue(responseBody);
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
      const gateway = createGateway(responsesConfig);
      const generation = gateway.generateRequest(VALID_INPUT);

      expect(mockFetch).toHaveBeenCalledOnce();
      await expect(generation).rejects.toBeInstanceOf(GenerationInvalidResponseError);
    });

    it("защищает сырой Responses-ответ: отклоняет унаследованный output при own status completed", async () => {
      const responseBody = { status: "completed" };
      Object.setPrototypeOf(responseBody, { output: createOpenAiResponsesBody().output });
      const response = new Response(null, { status: 200 });
      vi.spyOn(response, "json").mockResolvedValue(responseBody);
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
      const gateway = createGateway(responsesConfig);
      const generation = gateway.generateRequest(VALID_INPUT);

      expect(mockFetch).toHaveBeenCalledOnce();
      await expect(generation).rejects.toBeInstanceOf(GenerationInvalidResponseError);
    });

    it("защищает сырой Responses-ответ: отклоняет own accessor output_text без вызова и утечки маркера", async () => {
      const outputTextGetter = vi.fn(() => {
        throw new Error("SECRET_OUTPUT_TEXT_ACCESSOR_631");
      });
      const responseBody = {};
      Object.defineProperty(responseBody, "output_text", {
        enumerable: true,
        get: outputTextGetter,
      });
      const response = new Response(null, { status: 200 });
      vi.spyOn(response, "json").mockResolvedValue(responseBody);
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
      const gateway = createGateway(responsesConfig);
      const generation = gateway.generateRequest(VALID_INPUT);

      expect(mockFetch).toHaveBeenCalledOnce();
      await expect(generation).rejects.toBeInstanceOf(GenerationInvalidResponseError);
      await expect(generation).rejects.not.toThrow("SECRET_OUTPUT_TEXT_ACCESSOR_631");
      expect(outputTextGetter).not.toHaveBeenCalled();
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

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
    });

    it("возвращает incomplete как request failure и сохраняет usage", async () => {
      createResponsesMockFetch({
        status: "incomplete",
        output_text: VALID_LLM_TEXT,
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 90, output_tokens: 45, total_tokens: 135 },
      });

      const generation =
        await createGateway(responsesConfig).generateRequestWithMetadata(VALID_INPUT);

      expect(generation).toMatchObject({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        usage: { inputTokens: 90, outputTokens: 45, totalTokens: 135 },
      });
      expect(generation).not.toHaveProperty("responsesFailure");
    });

    it("возвращает безопасную projection failure для evaluation", async () => {
      createResponsesMockFetch({
        status: "incomplete",
        output_text: VALID_LLM_TEXT,
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 90, output_tokens: 45, total_tokens: 135 },
      });

      const generation =
        await createGateway(responsesConfig).generateRequestForEvaluation(VALID_INPUT);
      const serializedGeneration = JSON.stringify(generation);

      expect(generation).toMatchObject({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        failureStatus: "invalid_response",
        responsesFailure: {
          status: "incomplete",
          incompleteReason: "max_output_tokens",
        },
        usage: { inputTokens: 90, outputTokens: 45, totalTokens: 135 },
        usageStatus: "available",
        systemPromptHash: createRequestDraftSystemPromptHash(
          createRequestDraftSystemPrompt(undefined),
        ),
      });
      expect(generation).not.toHaveProperty("metadata");
      expect(serializedGeneration).not.toContain("test-provider");
      expect(serializedGeneration).not.toContain("test-model");
    });

    it("сохраняет безопасную причину failed без raw provider payload", async () => {
      const rawProviderMessage =
        "model test-model rejected at https://provider.example/v1/responses with Bearer test-key-123";
      createResponsesMockFetch({
        status: "failed",
        output: [],
        error: {
          code: "invalid_prompt",
          message: rawProviderMessage,
        },
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        provider_debug: {
          authorization: "Bearer test-key-123",
          raw_request: VALID_INPUT,
        },
      });

      const generation =
        await createGateway(responsesConfig).generateRequestForEvaluation(VALID_INPUT);
      const serializedGeneration = JSON.stringify(generation);

      expect(generation).toMatchObject({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        failureStatus: "invalid_response",
        responsesFailure: {
          status: "failed",
          providerErrorCode: "invalid_prompt",
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      });
      expect(serializedGeneration).not.toContain(rawProviderMessage);
      expect(serializedGeneration).not.toContain("test-model");
      expect(serializedGeneration).not.toContain("https://provider.example/v1/responses");
      expect(serializedGeneration).not.toContain("test-key-123");
      expect(serializedGeneration).not.toContain("raw_request");
      expect(serializedGeneration).not.toContain(VALID_INPUT.description);
    });

    it.each([
      "in_progress",
      "queued",
      "cancelled",
    ] as const)("различает допустимый non-completed status %s", async (status) => {
      createResponsesMockFetch({ status, output: [] });

      const generation =
        await createGateway(responsesConfig).generateRequestForEvaluation(VALID_INPUT);

      expect(generation).toMatchObject({
        status: "failure",
        failureStatus: "invalid_response",
        responsesFailure: { status },
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

      expect(generation).toMatchObject({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      });
    });

    it("отклоняет incomplete-ответ с валидным вложенным текстом", async () => {
      createResponsesMockFetch(createOpenAiResponsesBody(VALID_LLM_TEXT, { status: "incomplete" }));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
    });

    it("отклоняет стандартный вложенный Responses-ответ без status", async () => {
      createResponsesMockFetch(createOpenAiResponsesBody(VALID_LLM_TEXT, { includeStatus: false }));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
    });

    it.each([
      "failed",
      "unknown_status",
    ])("отклоняет незавершённый status %s с валидным текстом", async (status) => {
      createResponsesMockFetch({ status, output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
    });

    it("контролируемо отклоняет status неверного типа", async () => {
      createResponsesMockFetch({ status: 42, output_text: VALID_LLM_TEXT });
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
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

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
    });

    it("передаёт все заполненные поля контекста в input", async () => {
      const input = {
        description: "Не работает освещение",
        location: "Общий коридор",
        consequences: "В вечернее время проход затруднён",
        desiredActions: "Проверить и восстановить освещение",
      };
      const mockFetch = createResponsesMockFetch({
        output_text: createLlmText(draftForInput(input)),
      });
      const gateway = createGateway(responsesConfig);

      await gateway.generateRequest(input);

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
      const mockFetch = createResponsesMockFetch({
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
      expect(generation.metadata).toMatchObject({
        provider: "test-provider",
        model: "test-model",
        usage: { inputTokens: 90, outputTokens: 45, totalTokens: 135 },
        usageStatus: "available",
      });
      const requestBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
      expect(generation.metadata.systemPromptHash).toBe(
        createRequestDraftSystemPromptHash(requestBody.instructions),
      );
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
      expect(generation.metadata).toMatchObject({ usage: null, usageStatus: "missing" });
    });

    it.each([
      { input_tokens: 90, output_tokens: 45 },
      { input_tokens: "90", output_tokens: 45, total_tokens: 135 },
      { input_tokens: 90, output_tokens: -1, total_tokens: 89 },
    ])("не ломает успешную генерацию при некорректном Responses usage: %o", async (usage) => {
      createResponsesMockFetch({ output_text: VALID_LLM_TEXT, usage });

      const generation =
        await createGateway(responsesConfig).generateRequestWithMetadata(VALID_INPUT);

      expect(generation.status).toBe("success");
      if (generation.status !== "success") {
        throw new Error("Ожидался успешный generation result");
      }
      expect(generation.metadata).toMatchObject({ usage: null, usageStatus: "invalid" });
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

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
    });

    it("контролируемо обрабатывает невалидный JSON", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
      );
    });

    it("контролируемо обрабатывает HTTP-ошибку", async () => {
      createResponsesMockFetch({ output_text: "" }, 503);
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationProviderUnavailableError,
      );
    });

    it("контролируемо обрабатывает сетевую ошибку", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      const gateway = createGateway(responsesConfig);

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationNetworkError,
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
