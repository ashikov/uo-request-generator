import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAiCompatibleRequestBody,
  GenerationInvalidResponseError,
  OpenAiCompatibleGateway,
} from "../src";
import {
  parseRequestDraftForEvaluation,
  probeProviderResponse,
} from "../src/evaluation-diagnostics.js";
import { parseRequestDraft } from "../src/request-draft.js";

const INPUT = {
  description: "С потолка общего коридора капает вода.",
  desiredActions: "Прекратите потоп!",
};
const DRAFT = {
  outcome: "generated",
  title: "Вода в коридоре",
  problem: INPUT.description,
  circumstances: null,
  impact: null,
  requestItem: null,
  subject: null,
  warnings: [],
};
const CONFIG = {
  apiUrl: "https://provider.example/v1/responses",
  apiKey: "test-key",
  model: "test-model",
  provider: "test-provider",
  authScheme: "Bearer",
};

function wire(requestItem: unknown) {
  return JSON.stringify({ draft: { ...DRAFT, requestItem } });
}

describe("кандидат B: provider contract и parity", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    null,
    "Принять меры для прекращения затопления",
    "А".repeat(500),
    "😀".repeat(500),
  ])("принимает string|null в общем wire parser", (requestItem) => {
    expect(parseRequestDraft(wire(requestItem))).toMatchObject({ requestItem });
  });

  it.each([
    undefined,
    false,
    42,
    [],
    {},
    "",
    "  ",
    "Осмотреть\nустранить",
    "Осмотреть\rустранить",
    "А".repeat(501),
    "😀".repeat(501),
  ])("отклоняет отсутствующее или невалидное поле", (requestItem) => {
    expect(() => parseRequestDraft(wire(requestItem))).toThrow(GenerationInvalidResponseError);
    expect(parseRequestDraftForEvaluation(wire(requestItem))).toMatchObject({
      status: "failure",
      firstFailureStage: "provider_wire_validation",
    });
  });

  it("считает requestItem известным полем без раскрытия значения в диагностике", () => {
    const sentinel = "SYNTHETIC_REQUEST_ITEM_VALUE_267";
    const probe = probeProviderResponse({ draft: { ...DRAFT, requestItem: sentinel } });
    expect(probe.knownKeysPresent).toContain("requestItem");
    expect(probe.unknownKeyCount).toBe(0);
    expect(JSON.stringify(probe)).not.toContain(sentinel);
    const rejected = parseRequestDraftForEvaluation(wire([sentinel]));
    expect(rejected).toMatchObject({
      status: "failure",
      stages: expect.arrayContaining([
        expect.objectContaining({
          issues: expect.arrayContaining([
            { code: "invalid_type", path: "draft.requestItem", expected: "string" },
          ]),
        }),
      ]),
    });
    expect(JSON.stringify(rejected)).not.toContain(sentinel);
    const accepted = parseRequestDraftForEvaluation(wire(sentinel));
    expect(JSON.stringify(accepted.stages)).not.toContain(sentinel);
  });

  describe.each(["chat-completions", "responses"] as const)("%s", (apiProtocol) => {
    it.each([
      {
        name: "provider string",
        desiredActions: INPUT.desiredActions,
        requestItem: "Принять меры для прекращения затопления",
        expected: "Принять меры для прекращения затопления",
      },
      {
        name: "abstention",
        desiredActions: " Прошу: только осмотрите\nничего пока не ремонтируйте. ",
        requestItem: null,
        expected: "Только осмотрите ничего пока не ремонтируйте.",
      },
      {
        name: "generic",
        desiredActions: undefined,
        requestItem: null,
        expected: "Устранить наблюдаемую проблему",
      },
      {
        name: "ignored string",
        desiredActions: undefined,
        requestItem: "Заменить кровлю",
        expected: "Устранить наблюдаемую проблему",
      },
      { name: "missing", desiredActions: undefined, requestItem: undefined, expected: null },
      { name: "wrong type", desiredActions: INPUT.desiredActions, requestItem: 42, expected: null },
      {
        name: "malformed prefix",
        desiredActions: INPUT.desiredActions,
        requestItem: "Прошу: остановить затопление",
        expected: null,
      },
      {
        name: "UTF-16 overflow",
        desiredActions: INPUT.desiredActions,
        requestItem: "😀".repeat(251),
        expected: null,
      },
    ])("один вызов без retry в каждом пути: $name", async ({
      desiredActions,
      requestItem,
      expected,
    }) => {
      const responseText = wire(requestItem);
      const envelope =
        apiProtocol === "responses"
          ? { status: "completed", output_text: responseText }
          : { choices: [{ message: { content: responseText } }] };
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => new Response(JSON.stringify(envelope), { status: 200 }));
      const gateway = new OpenAiCompatibleGateway({ ...CONFIG, apiProtocol });
      const input = { ...INPUT, desiredActions };
      if (expected === null) {
        await expect(gateway.generateRequest(input)).rejects.toThrow(
          GenerationInvalidResponseError,
        );
      } else {
        const production = await gateway.generateRequest(input);
        expect(production.status).toBe("generated");
        if (production.status !== "generated") throw new Error("Ожидалась заявка");
        expect(production.result.body).toContain(`Прошу:\n1. ${expected}`);
        expect(Object.keys(production.result).sort()).toEqual(["body", "title", "warnings"]);
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      const evaluation = await gateway.generateRequestForEvaluation(input);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(evaluation.status).toBe(expected === null ? "failure" : "success");
      if (evaluation.status === "success" && evaluation.observation.draftOutcome === "generated") {
        expect(evaluation.observation.draft.requestItems).toEqual([expected]);
      }
      expect(JSON.stringify(evaluation.diagnosticTrace)).not.toContain("Прекратите потоп");
    });
  });

  it("оба протокола отправляют одинаковую schema независимо от desiredActions", () => {
    const hashes = [];
    for (const apiProtocol of ["responses", "chat-completions"] as const) {
      for (const desiredActions of [undefined, INPUT.desiredActions]) {
        const request = createOpenAiCompatibleRequestBody(
          { ...CONFIG, apiProtocol, maxOutputTokens: 4000 },
          { ...INPUT, desiredActions },
        );
        const schema =
          "text" in request
            ? request.text.format.schema
            : request.response_format.json_schema.schema;
        hashes.push(createHash("sha256").update(JSON.stringify(schema)).digest("hex"));
      }
    }
    expect(new Set(hashes).size).toBe(1);
  });
});
