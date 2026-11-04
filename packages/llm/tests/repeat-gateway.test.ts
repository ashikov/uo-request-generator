import { type RepeatRequestInput, renderRepeatRequestDraft } from "@uo-request-generator/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAiCompatibleRepeatRequestBody,
  createRepeatRequestDraftJsonSchema,
  GenerationInvalidResponseError,
  OpenAiCompatibleGateway,
  type OpenAiCompatibleGatewayConfig,
} from "../src";

const input: RepeatRequestInput = {
  previousRequest: "Ранее просил восстановить светильник на учебной площадке.",
  currentState: "Светильник по-прежнему не включается.",
  response: { status: "received", text: "УО сообщила, что обращение принято в работу." },
  previousRequestDate: "2026-10-01",
  previousRequestNumber: "SYNTHETIC-17",
};
const generatedDraft = {
  outcome: "generated",
  title: "Повторное обращение об освещении",
  originalProblem: "На учебной площадке не включается светильник.",
  previousRequestSummary: "Ранее просил восстановить освещение.",
  responseSummary: "УО сообщила о принятии обращения в работу.",
  performedActions: null,
  currentState: "Светильник по-прежнему не включается.",
  unresolvedQuestions: null,
  circumstancesToVerify: null,
  newFacts: null,
  warnings: [],
};
const config: OpenAiCompatibleGatewayConfig = {
  apiUrl: "https://provider.example/v1/responses",
  apiKey: "synthetic-test-key",
  model: "synthetic-model",
  provider: "synthetic-provider",
  authScheme: "Api-Key",
  apiProtocol: "responses",
};

function mockProvider(draft: unknown, protocol = config.apiProtocol) {
  const text = JSON.stringify({ draft });
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const envelope =
      protocol === "responses"
        ? { output_text: text, usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 } }
        : {
            choices: [{ message: { content: text } }],
            usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
          };
    return new Response(JSON.stringify(envelope));
  });
}

afterEach(() => vi.restoreAllMocks());

describe("repeat request gateway", () => {
  it("defines one strict wire object for all outcomes and no backend-owned fields", () => {
    const schema = createRepeatRequestDraftJsonSchema();
    expect(schema.additionalProperties).toBe(false);
    const draft = schema.properties.draft;
    expect(draft.additionalProperties).toBe(false);
    expect(Object.keys(draft.properties)).toEqual(draft.required);
    expect(draft.properties.outcome.enum).toEqual([
      "generated",
      "multiple_issues",
      "insufficient_history",
    ]);
    expect(JSON.stringify(schema)).not.toContain("previousRequestDate");
    expect(JSON.stringify(schema)).not.toContain("requestItems");
    expect(JSON.stringify(schema)).not.toContain("subject");
  });

  it("reports allowed repeat keys without false unknown-key counts", async () => {
    mockProvider(generatedDraft);
    const result = await new OpenAiCompatibleGateway(config).generateRepeatRequestForEvaluation(
      input,
    );
    expect(
      result.diagnosticTrace.stages.find(({ stage }) => stage === "provider_wire_validation"),
    ).toMatchObject({
      status: "pass",
      structuralProbe: {
        unknownKeyCount: 0,
        knownKeysPresent: [
          "outcome",
          "title",
          "originalProblem",
          "previousRequestSummary",
          "responseSummary",
          "performedActions",
          "currentState",
          "unresolvedQuestions",
          "circumstancesToVerify",
          "newFacts",
          "warnings",
        ],
      },
    });
  });

  it("rejects UTF-16 canonical overflow after a code-point-valid wire draft", async () => {
    mockProvider({ ...generatedDraft, title: "😀".repeat(61) });
    const result = await new OpenAiCompatibleGateway(config).generateRepeatRequestForEvaluation(
      input,
    );
    expect(result).toMatchObject({
      status: "failure",
      diagnosticTrace: { firstFailureStage: "canonical_validation" },
    });
  });

  it("rejects partial prose for a no-document outcome", async () => {
    mockProvider({ ...generatedDraft, outcome: "insufficient_history" });
    const result = await new OpenAiCompatibleGateway(config).generateRepeatRequestForEvaluation(
      input,
    );
    expect(result).toMatchObject({
      status: "failure",
      diagnosticTrace: { firstFailureStage: "canonical_validation" },
    });
  });

  it.each([
    "chat-completions",
    "responses",
  ] as const)("builds %s without backend metadata", (apiProtocol) => {
    const request = createOpenAiCompatibleRepeatRequestBody(
      {
        apiProtocol,
        model: config.model,
        maxOutputTokens: 4000,
        chatCompletionsOutputTokenParameter: "max_completion_tokens",
      },
      {
        ...input,
        response: {
          status: "received",
          text: "УО сообщила, что обращение принято в работу.",
          date: "2026-10-02",
        },
      },
    );
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain(input.previousRequestDate);
    expect(serialized).not.toContain(input.previousRequestNumber);
    expect(serialized).not.toContain("2026-10-02");
    expect(serialized).not.toContain("previousRequestDate");
    expect(serialized).not.toContain("previousRequestNumber");
    if ("input" in request) {
      expect(request.max_output_tokens).toBe(4000);
      expect(request.store).toBe(false);
      expect(request.text.format.strict).toBe(true);
      expect(JSON.parse(request.input)).toMatchObject({
        previousRequest: input.previousRequest,
        currentState: input.currentState,
        response: { status: "received", text: "УО сообщила, что обращение принято в работу." },
      });
    } else {
      expect(request.max_completion_tokens).toBe(4000);
      expect(request.response_format.json_schema.strict).toBe(true);
    }
  });

  it.each([
    "chat-completions",
    "responses",
  ] as const)("uses one %s call and renders the same draft for production and evaluation", async (apiProtocol) => {
    const fetchMock = mockProvider(generatedDraft, apiProtocol);
    const gateway = new OpenAiCompatibleGateway({ ...config, apiProtocol });
    const production = await gateway.generateRepeatRequest(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const evaluation = await gateway.generateRepeatRequestForEvaluation(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(evaluation.status).toBe("success");
    if (evaluation.status !== "success") throw new Error("Expected generation success");
    expect(evaluation.outcome).toEqual(production);
    expect(evaluation.metadata.usage).toEqual({
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
    });
    expect(evaluation.systemPromptHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evaluation.observation.draftOutcome).toBe("generated");
    if (evaluation.observation.draftOutcome !== "generated")
      throw new Error("Expected generated draft");
    expect(production).toEqual({
      status: "generated",
      result: renderRepeatRequestDraft(evaluation.observation.draft),
    });
    expect(evaluation.diagnosticTrace.status).toBe("completed");
  });

  it.each([
    "multiple_issues",
    "insufficient_history",
  ] as const)("returns %s without a partial document", async (outcome) => {
    const wireDraft = {
      ...Object.fromEntries(Object.keys(generatedDraft).map((key) => [key, null])),
      outcome,
      warnings: [],
    };
    const fetchMock = mockProvider(wireDraft);
    const gateway = new OpenAiCompatibleGateway(config);
    expect(await gateway.generateRepeatRequest(input)).toEqual({ status: outcome });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...generatedDraft, unexpected_private_key: "private-value" },
    { ...generatedDraft, title: null },
    { ...generatedDraft, originalProblem: "первая строка\nвторая строка" },
    { ...generatedDraft, outcome: "invented-outcome" },
  ])("rejects malformed drafts without retries or diagnostic text leakage", async (draft) => {
    const fetchMock = mockProvider(draft);
    const result = await new OpenAiCompatibleGateway(config).generateRepeatRequestForEvaluation(
      input,
    );
    expect(result.status).toBe("failure");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("unexpected_private_key");
    expect(JSON.stringify(result)).not.toContain(input.previousRequest);
    expect(JSON.stringify(result)).not.toContain("первая строка");
  });

  it("retains the safe repeat field path in parser diagnostics", async () => {
    mockProvider({ ...generatedDraft, responseSummary: 42 });
    const result = await new OpenAiCompatibleGateway(config).generateRepeatRequestForEvaluation(
      input,
    );
    expect(
      result.diagnosticTrace.stages.find(({ stage }) => stage === "provider_wire_validation"),
    ).toMatchObject({
      status: "fail",
      issues: [{ code: "invalid_type", path: "draft.responseSummary", expected: "string" }],
    });
  });

  it("rejects missing universal wire fields", async () => {
    mockProvider({ outcome: "insufficient_history" });
    await expect(
      new OpenAiCompatibleGateway(config).generateRepeatRequest(input),
    ).rejects.toBeInstanceOf(GenerationInvalidResponseError);
  });

  it("fails closed when response summary contradicts the backend status", async () => {
    mockProvider(generatedDraft);
    const result = await new OpenAiCompatibleGateway(config).generateRepeatRequestForEvaluation({
      ...input,
      response: { status: "not_received" },
    });
    expect(result.status).toBe("failure");
    expect(result.diagnosticTrace).toMatchObject({ firstFailureStage: "materialization" });
  });

  it("rejects a complete document overflow without truncation or retry", async () => {
    const fetchMock = mockProvider({
      ...generatedDraft,
      originalProblem: "п".repeat(800),
      previousRequestSummary: "и".repeat(1200),
      responseSummary: "о".repeat(1200),
      performedActions: "д".repeat(1000),
      currentState: "с".repeat(1600),
      unresolvedQuestions: "в".repeat(1000),
      circumstancesToVerify: "у".repeat(600),
      newFacts: "ф".repeat(1000),
    });
    const result = await new OpenAiCompatibleGateway(config).generateRepeatRequestForEvaluation(
      input,
    );
    expect(result).toMatchObject({
      status: "failure",
      diagnosticTrace: { firstFailureStage: "materialization" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect("observation" in result).toBe(false);
  });

  it("rejects invalid history before dispatch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      new OpenAiCompatibleGateway(config).generateRepeatRequest({ ...input, previousRequest: " " }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps HTTP failure usage and safe diagnostics through shared transport", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "secret-provider-message",
          usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
        }),
        { status: 429 },
      ),
    );
    const result = await new OpenAiCompatibleGateway(config).generateRepeatRequestForEvaluation(
      input,
    );
    expect(result).toMatchObject({
      status: "failure",
      failureStatus: "provider_unavailable",
      providerHttpStatus: 429,
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
      diagnosticTrace: { firstFailureStage: "http" },
    });
    expect(JSON.stringify(result)).not.toContain("secret-provider-message");
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
