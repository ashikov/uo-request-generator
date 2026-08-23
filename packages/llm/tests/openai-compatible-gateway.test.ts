import {
  COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
  COMMON_AREA_ROOF_LEGAL_BASIS_MODULE,
  COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
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
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck: null,
    remedyActions: ["Проверить и восстановить освещение"],
    resultCheck: null,
  },
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
      "1. Проверить и восстановить освещение.",
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
  subject: null,
  actionPlan: null,
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
    expect(callBody.messages[0]?.content).toContain("verification содержит");
    expect(callBody.messages[0]?.content).toContain("warnings: []");
    expect(callBody.messages[0]?.content).toContain("Не добавляй в actionPlan нумерацию");
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

  it("передаёт дверной contract в Chat Completions без другого subject", () => {
    const input = {
      ...VALID_INPUT,
      confirmedProblemSubject: "common_area_entrance_door" as const,
    };
    const requestBody = createOpenAiCompatibleRequestBody(
      {
        apiProtocol: "chat-completions",
        model: "benchmark-model",
        maxOutputTokens: 1200,
      },
      input,
    );

    expect(requestBody).toMatchObject({
      messages: [
        {
          role: "system",
          content: createRequestDraftSystemPrompt(input.confirmedProblemSubject),
        },
        { role: "user", content: expect.any(String) },
      ],
      response_format: {
        json_schema: {
          schema: createRequestDraftJsonSchema(input.confirmedProblemSubject),
        },
      },
    });
    expect(JSON.stringify(requestBody)).not.toContain("common_area_premises_lighting");
    if (!("messages" in requestBody)) {
      throw new Error("Ожидался Chat Completions request");
    }
    expect(requestBody.messages[1]?.content).not.toContain("confirmedProblemSubject");
  });

  it("передаёт lighting contract в Responses API без другого subject", () => {
    const input = {
      ...VALID_INPUT,
      confirmedProblemSubject: "common_area_premises_lighting" as const,
    };
    const requestBody = createOpenAiCompatibleRequestBody(
      {
        apiProtocol: "responses",
        model: "benchmark-model",
        maxOutputTokens: 1200,
      },
      input,
    );

    expect(requestBody).toMatchObject({
      instructions: createRequestDraftSystemPrompt(input.confirmedProblemSubject),
      input: expect.any(String),
      text: {
        format: {
          schema: createRequestDraftJsonSchema(input.confirmedProblemSubject),
        },
      },
    });
    expect(JSON.stringify(requestBody)).not.toContain("common_area_entrance_door");
    if (!("input" in requestBody)) {
      throw new Error("Ожидался Responses request");
    }
    expect(requestBody.input).not.toContain("confirmedProblemSubject");
  });

  it.each([
    "chat-completions",
    "responses",
  ] as const)("передаёт cleaning contract через %s без provider-owned confirmed subject", (apiProtocol) => {
    const input = {
      ...VALID_INPUT,
      confirmedProblemSubject: "common_area_premises_cleaning" as const,
    };
    const requestBody = createOpenAiCompatibleRequestBody(
      {
        apiProtocol,
        model: "benchmark-model",
        maxOutputTokens: 1200,
      },
      input,
    );

    expect(JSON.stringify(requestBody)).toContain("common_area_premises_cleaning");
    expect(JSON.stringify(requestBody)).not.toContain("common_area_entrance_door");
    expect(JSON.stringify(requestBody)).not.toContain("common_area_premises_lighting");
    const expectedPrompt = createRequestDraftSystemPrompt(input.confirmedProblemSubject);
    const expectedSchema = createRequestDraftJsonSchema(input.confirmedProblemSubject);
    const userMessage =
      "messages" in requestBody ? requestBody.messages[1]?.content : requestBody.input;

    if ("messages" in requestBody) {
      expect(requestBody.messages[0]?.content).toBe(expectedPrompt);
      expect(requestBody.response_format.json_schema.schema).toEqual(expectedSchema);
    } else {
      expect(requestBody.instructions).toBe(expectedPrompt);
      expect(requestBody.text.format.schema).toEqual(expectedSchema);
    }
    expect(userMessage).not.toContain("confirmedProblemSubject");
  });

  it.each([
    "chat-completions",
    "responses",
  ] as const)("передаёт roof contract через %s без других subject и backend-owned поля", (apiProtocol) => {
    const input = {
      description: "На кровле многоквартирного дома обнаружена протечка",
      confirmedProblemSubject: "common_area_roof" as const,
    };
    const requestBody = createOpenAiCompatibleRequestBody(
      { apiProtocol, model: "benchmark-model", maxOutputTokens: 1200 },
      input,
    );
    const serializedRequest = JSON.stringify(requestBody);
    const userMessage =
      "messages" in requestBody ? requestBody.messages[1]?.content : requestBody.input;

    expect(serializedRequest).toContain("common_area_roof");
    expect(serializedRequest).not.toContain("common_area_entrance_door");
    expect(serializedRequest).not.toContain("common_area_premises_lighting");
    expect(serializedRequest).not.toContain("common_area_premises_cleaning");
    expect(serializedRequest).not.toContain("common_area_ventilation");
    expect(serializedRequest).not.toContain("common_area_elevator");
    expect(userMessage).not.toContain("confirmedProblemSubject");
    expect(serializedRequest).not.toContain(COMMON_AREA_ROOF_LEGAL_BASIS_MODULE.paragraphs[0]);
  });

  it.each([
    "chat-completions",
    "responses",
  ] as const)("передаёт ventilation contract через %s без других subject и backend-owned поля", (apiProtocol) => {
    const input = {
      description:
        "Общедомовой вентиляционный канал, обслуживающий помещения подъезда, не работает",
      confirmedProblemSubject: "common_area_ventilation" as const,
    };
    const requestBody = createOpenAiCompatibleRequestBody(
      { apiProtocol, model: "benchmark-model", maxOutputTokens: 1200 },
      input,
    );
    const serializedRequest = JSON.stringify(requestBody);
    const userMessage =
      "messages" in requestBody ? requestBody.messages[1]?.content : requestBody.input;

    expect(serializedRequest).toContain("common_area_ventilation");
    expect(serializedRequest).not.toContain("common_area_entrance_door");
    expect(serializedRequest).not.toContain("common_area_premises_lighting");
    expect(serializedRequest).not.toContain("common_area_premises_cleaning");
    expect(serializedRequest).not.toContain("common_area_roof");
    expect(serializedRequest).not.toContain("common_area_elevator");
    expect(userMessage).not.toContain("confirmedProblemSubject");
    expect(serializedRequest).not.toContain(
      COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE.paragraphs[0],
    );
  });

  it.each([
    "chat-completions",
    "responses",
  ] as const)("передаёт elevator contract через %s без других subject и backend-owned поля", (apiProtocol) => {
    const input = {
      description: "Лифт в многоквартирном доме не реагирует на вызов с первого этажа",
      confirmedProblemSubject: "common_area_elevator" as const,
    };
    const requestBody = createOpenAiCompatibleRequestBody(
      { apiProtocol, model: "benchmark-model", maxOutputTokens: 1200 },
      input,
    );
    const serializedRequest = JSON.stringify(requestBody);
    const userMessage =
      "messages" in requestBody ? requestBody.messages[1]?.content : requestBody.input;

    expect(serializedRequest).toContain("common_area_elevator");
    expect(serializedRequest).not.toContain("common_area_entrance_door");
    expect(serializedRequest).not.toContain("common_area_premises_lighting");
    expect(serializedRequest).not.toContain("common_area_premises_cleaning");
    expect(serializedRequest).not.toContain("common_area_roof");
    expect(serializedRequest).not.toContain("common_area_ventilation");
    expect(userMessage).not.toContain("confirmedProblemSubject");
    expect(serializedRequest).not.toContain(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0]);
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
    expect(userContent).not.toContain("confirmedProblemSubject");
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
    const text = createLlmText({
      outcome: "generated",
      title: "Течь на кухне",
      problem: "На кухне течёт кран.",
      circumstances: null,
      impact: null,
      verification: null,
      subject: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Отремонтировать кран"],
        resultCheck: null,
      },
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
      verification: null,
      subject: {
        kind: "common_area_entrance_door",
        evidence: [
          {
            sourceField: "description",
            quote: "входной двери подъезда",
          },
        ],
      },
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Установить ручку на входную дверь"],
        resultCheck: null,
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
    expect(result.result.body).toContain("Прошу:\n1. Установить ручку на входную дверь");
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
      ...VALID_DRAFT,
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
      actionPlan: {
        preliminaryCheck: "При необходимости установить причину отсутствия освещения",
        remedyActions: [input.desiredActions],
        resultCheck: "Проверить работу освещения после восстановления",
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
    const mockFetch = createMockFetch(createLlmText(VALID_DRAFT));

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

  it("возвращает manual-eval observation из того же validated draft и deterministic selection", async () => {
    const description =
      "В общем коридоре многоквартирного дома не работает освещение несколько дней.";
    const draft = {
      ...VALID_DRAFT,
      subject: {
        kind: "common_area_premises_lighting",
        evidence: [{ sourceField: "description", quote: description }],
      },
    };
    createMockFetch(createLlmText(draft));

    const generation = await createGateway().generateRequestForEvaluation({
      description,
      confirmedProblemSubject: "common_area_premises_lighting",
    });

    expect(generation.status).toBe("success");
    if (generation.status !== "success") {
      throw new Error("Ожидался успешный generation result");
    }
    expect(generation.observation.draftOutcome).toBe("generated");
    if (generation.observation.draftOutcome !== "generated") {
      throw new Error("Ожидался generated evaluation observation");
    }
    expect(generation.observation.draft).toMatchObject({ subject: draft.subject });
    expect(generation.observation.selectedNormativeModule).toBe("common-area-lighting");
    expect(generation.systemPromptHash).toMatch(/^sha256:/u);
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
      verification: null,
      subject: {
        kind: "common_area_premises_cleaning",
        evidence: [
          { sourceField: "description", quote: description },
          { sourceField: "location", quote: location },
        ],
      },
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: [desiredActions],
        resultCheck: null,
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

  it("оставляет mismatch выбранного и provider subject fail closed", async () => {
    const description = "У входной двери подъезда отсутствует ручка.";
    const draft = {
      ...VALID_DRAFT,
      subject: {
        kind: "common_area_entrance_door",
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
    expect(result.result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.result.body).not.toContain(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("оставляет неподтверждаемое evidence fail closed", async () => {
    const draft = {
      ...VALID_DRAFT,
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

    const result = await createGateway().generateRequest({
      description: "У входной двери подъезда отсутствует ручка.",
      confirmedProblemSubject: "common_area_entrance_door",
    });

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("не подключает предметный нормативный текст по одной LLM-категории", async () => {
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
    createMockFetch(createLlmText(draft));

    const result = await createGateway().generateRequest(VALID_INPUT);

    expect(result.status).toBe("generated");
    if (result.status !== "generated") {
      throw new Error("Ожидался готовый результат");
    }
    expect(result.result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
  });

  it.each([
    ["дверь квартиры", "Дверь квартиры не закрывается.", "Дверь квартиры"],
    ["бессмысленное evidence", "аааааааааа", "аааааааааа"],
  ])("не подключает предметный нормативный текст по ошибочному provider output: %s", async (_caseName, description, quote) => {
    const draft = {
      ...VALID_DRAFT,
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
        title: null,
        problem: null,
        circumstances: null,
        impact: null,
        verification: null,
        subject: null,
        actionPlan: null,
        warnings: [],
      },
    });
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
        subject: null,
        actionPlan: null,
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

      await expect(gateway.generateRequest(VALID_INPUT)).rejects.toBeInstanceOf(
        GenerationInvalidResponseError,
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

      expect(generation).toMatchObject({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        usage: { inputTokens: 90, outputTokens: 45, totalTokens: 135 },
      });
    });

    it("возвращает безопасную projection failure для evaluation", async () => {
      createResponsesMockFetch({
        status: "incomplete",
        output_text: VALID_LLM_TEXT,
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
