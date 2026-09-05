import { describe, expect, it } from "vitest";
import {
  parseRequestDraftForEvaluation,
  probeProviderResponse,
  sanitizeValidationIssues,
} from "../src/evaluation-diagnostics.js";
import { parseRequestDraft } from "../src/request-draft.js";

const generatedWireDraft = {
  outcome: "generated",
  title: "Не работает освещение",
  problem: "В помещении общего пользования не работает освещение.",
  circumstances: null,
  impact: null,
  subject: null,
  warnings: [],
} as const;

const multipleIssuesWireDraft = {
  outcome: "multiple_issues",
  title: null,
  problem: null,
  circumstances: null,
  impact: null,
  subject: null,
  warnings: [],
} as const;

function responseText(draft: unknown): string {
  return JSON.stringify({ draft });
}

describe("evaluation diagnostics", () => {
  it("сохраняет известный outcome при последующей ошибке provider wire", () => {
    const result = parseRequestDraftForEvaluation(
      JSON.stringify({ draft: { outcome: "multiple_issues", title: "лишнее поле" } }),
    );

    expect(result).toMatchObject({
      status: "failure",
      firstFailureStage: "provider_wire_validation",
      structuralProbe: {
        rootType: "object",
        draftPresence: "present",
        draftType: "object",
        knownKeysPresent: ["outcome", "title"],
        unknownKeyCount: 0,
        outcome: "multiple_issues",
      },
    });
  });

  it("не сохраняет неизвестный outcome при malformed provider wire", () => {
    const outcomeSentinel = "SECRET_UNKNOWN_OUTCOME_247";
    const result = parseRequestDraftForEvaluation(
      JSON.stringify({ draft: { outcome: outcomeSentinel } }),
    );

    expect(result).toMatchObject({
      status: "failure",
      firstFailureStage: "provider_wire_validation",
      structuralProbe: {
        rootType: "object",
        draftPresence: "present",
        draftType: "object",
        knownKeysPresent: ["outcome"],
        unknownKeyCount: 0,
      },
    });
    expect(result.structuralProbe).not.toHaveProperty("outcome");
    expect(JSON.stringify(result)).not.toContain(outcomeSentinel);
  });

  it("игнорирует inherited draft и outcome при structural probe", () => {
    const inheritedResponse: unknown = Object.create({
      draft: { outcome: "multiple_issues", title: "SECRET_INHERITED_DRAFT_247" },
    });
    const inheritedDraft: unknown = Object.create({ outcome: "multiple_issues" });

    expect(probeProviderResponse(inheritedResponse)).toEqual({
      rootType: "object",
      draftPresence: "missing",
      knownKeysPresent: [],
      unknownKeyCount: 0,
    });
    expect(probeProviderResponse({ draft: inheritedDraft })).toEqual({
      rootType: "object",
      draftPresence: "present",
      draftType: "object",
      knownKeysPresent: [],
      unknownKeyCount: 0,
    });
  });

  it("не раскрывает значения и validator details", () => {
    const scalarSentinel = "SECRET_SCALAR_247";
    const unknownKeySentinel = "SECRET_KEY_247";
    const unknownValueSentinel = "SECRET_UNKNOWN_VALUE_247";
    const evidenceSentinel = "SECRET_EVIDENCE_247";
    const pathSentinel = "SECRET_PATH_247";
    const messageSentinel = "SECRET_MESSAGE_247";
    const validationValueSentinel = "SECRET_VALIDATION_VALUE_247";
    const sentinels = [
      scalarSentinel,
      unknownKeySentinel,
      unknownValueSentinel,
      evidenceSentinel,
      pathSentinel,
      messageSentinel,
      validationValueSentinel,
    ];
    const parseResult = parseRequestDraftForEvaluation(
      responseText({
        ...generatedWireDraft,
        title: scalarSentinel,
        [unknownKeySentinel]: unknownValueSentinel,
        subject: {
          kind: "common_area_premises_lighting",
          evidence: [{ sourceField: "description", quote: evidenceSentinel }],
        },
      }),
    );
    const issues = sanitizeValidationIssues([
      {
        code: "custom",
        path: ["draft", pathSentinel],
        message: messageSentinel,
        input: validationValueSentinel,
      },
    ]);
    const serialized = JSON.stringify({ parseResult, issues });

    for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel);
    expect(issues).toEqual([{ code: "custom", path: "draft.<unknown>" }]);
  });

  it("считает deeply nested unknown keys без рекурсивного переполнения стека", () => {
    let nested: unknown = null;
    for (let index = 0; index < 10_000; index += 1) nested = { unknown: nested };

    expect(
      probeProviderResponse({ draft: { outcome: "multiple_issues" }, unknown: nested }),
    ).toMatchObject({ unknownKeyCount: 10_001 });
  });

  it("не считает subject provenance неизвестными полями", () => {
    const draft = {
      ...generatedWireDraft,
      subject: {
        kind: "common_area_premises_lighting",
        evidence: [{ sourceField: "description", quote: "не работает освещение" }],
      },
    };

    expect(probeProviderResponse({ draft })).toMatchObject({ unknownKeyCount: 0 });
  });

  it("считает удалённые procedural поля неизвестными", () => {
    expect(
      probeProviderResponse({
        draft: {
          ...generatedWireDraft,
          actionPlanDecision: { remedyActions: [{ intent: "resolve_observed_problem" }] },
        },
      }),
    ).toMatchObject({ unknownKeyCount: 3 });
  });

  it.each([
    ["not json", "json_parse"],
    ["[]", "provider_wire_validation"],
    ["{}", "provider_wire_validation"],
    ['{"draft":[]}', "provider_wire_validation"],
  ] as const)("указывает первую failing stage для %s", (text, firstFailureStage) => {
    expect(parseRequestDraftForEvaluation(text)).toMatchObject({
      status: "failure",
      firstFailureStage,
    });
  });

  it("возвращает только фактические parsing stages для generated draft", () => {
    const result = parseRequestDraftForEvaluation(responseText(generatedWireDraft));

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("Ожидался успешный parsing result");
    expect(result.stages.map(({ stage, status }) => [stage, status])).toEqual([
      ["json_parse", "pass"],
      ["provider_wire_validation", "pass"],
      ["canonical_validation", "pass"],
    ]);
  });

  it("отделяет canonical generated validation от universal provider wire", () => {
    const result = parseRequestDraftForEvaluation(
      responseText({ ...generatedWireDraft, title: null }),
    );

    expect(result).toMatchObject({
      status: "failure",
      firstFailureStage: "canonical_validation",
      structuralProbe: { outcome: "generated" },
      stages: [
        { stage: "json_parse", status: "pass" },
        { stage: "provider_wire_validation", status: "pass" },
        { stage: "canonical_validation", status: "fail" },
      ],
    });
  });

  it("канонизирует multiple_issues до минимальной внутренней формы", () => {
    const result = parseRequestDraftForEvaluation(responseText(multipleIssuesWireDraft));

    expect(result).toMatchObject({
      status: "success",
      draft: { outcome: "multiple_issues" },
      structuralProbe: { outcome: "multiple_issues" },
    });
    if (result.status !== "success") throw new Error("Ожидался успешный parsing result");
    expect(result.draft).toEqual({ outcome: "multiple_issues" });
    expect(result.stages.map(({ stage }) => stage)).toEqual([
      "json_parse",
      "provider_wire_validation",
      "canonical_validation",
    ]);
  });

  it("не обходит universal validation для malformed multiple", () => {
    expect(
      parseRequestDraftForEvaluation(
        responseText({ ...multipleIssuesWireDraft, warnings: "wrong type" }),
      ),
    ).toMatchObject({
      status: "failure",
      firstFailureStage: "provider_wire_validation",
      structuralProbe: { outcome: "multiple_issues" },
    });
  });

  it.each([
    ["generated", generatedWireDraft, true, "generated", undefined],
    ["multiple_issues", multipleIssuesWireDraft, true, "multiple_issues", undefined],
    [
      "generated с nullable title",
      { ...generatedWireDraft, title: null },
      false,
      undefined,
      "canonical_validation",
    ],
    [
      "malformed universal wire",
      { ...multipleIssuesWireDraft, warnings: "wrong type" },
      false,
      undefined,
      "provider_wire_validation",
    ],
  ] as const)("сохраняет production/evaluation parsing parity для %s", (_name, draft, accepted, outcome, failureStage) => {
    const serialized = responseText(draft);
    let productionOutcome: "generated" | "multiple_issues" | undefined;
    let productionAccepted = true;
    try {
      productionOutcome = parseRequestDraft(serialized).outcome;
    } catch {
      productionAccepted = false;
    }

    const evaluation = parseRequestDraftForEvaluation(serialized);
    expect(productionAccepted).toBe(accepted);
    expect(evaluation.status === "success").toBe(accepted);
    if (evaluation.status === "success") {
      expect(evaluation.draft.outcome).toBe(outcome);
      expect(productionOutcome).toBe(outcome);
    } else {
      expect(evaluation.firstFailureStage).toBe(failureStage);
    }
  });
});
