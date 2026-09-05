import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOpenAiCompatibleRequestBody } from "../src";
import {
  createRequestDraftJsonSchema,
  createRequestDraftSystemPrompt,
  parseRequestDraft,
} from "../src/request-draft.js";

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

function responseSchemaFor(desiredActions?: string) {
  const body = createOpenAiCompatibleRequestBody(
    {
      apiProtocol: "responses",
      model: "test-model",
      maxOutputTokens: 1_000,
    },
    {
      description: "В помещении общего пользования не работает освещение.",
      ...(desiredActions === undefined ? {} : { desiredActions }),
    },
  );

  if (!("text" in body)) throw new TypeError("Ожидался Responses request body");
  return body.text.format.schema;
}

describe("beta provider response contract", () => {
  it("не содержит procedural и allocation fields", () => {
    const serialized = JSON.stringify(createRequestDraftJsonSchema(undefined));

    for (const removedField of [
      "verificationDecision",
      "actionPlanDecision",
      "desiredActionsAllocation",
      "preliminaryCheck",
      "remedyActions",
      "resultCheck",
      "resolve_observed_problem",
      "exact_fragments",
    ]) {
      expect(serialized).not.toContain(removedField);
    }
    expect(
      Object.keys(createRequestDraftJsonSchema(undefined).properties.draft.properties),
    ).toEqual(["outcome", "title", "problem", "circumstances", "impact", "subject", "warnings"]);
  });

  it("использует byte-identical schema независимо от наличия desiredActions", () => {
    const withoutDesiredActions = JSON.stringify(responseSchemaFor());
    const withDesiredActions = JSON.stringify(responseSchemaFor("Восстановить освещение."));

    expect(withDesiredActions).toBe(withoutDesiredActions);
    expect(createHash("sha256").update(withDesiredActions).digest("hex")).toBe(
      createHash("sha256").update(withoutDesiredActions).digest("hex"),
    );
  });

  it("строго разбирает generated и канонизирует multiple_issues", () => {
    expect(parseRequestDraft(responseText(generatedWireDraft))).toEqual(generatedWireDraft);
    expect(parseRequestDraft(responseText(multipleIssuesWireDraft))).toEqual({
      outcome: "multiple_issues",
    });
  });

  it.each([
    { ...generatedWireDraft, extra: "provider-authored request item" },
    { ...generatedWireDraft, title: null },
    { ...generatedWireDraft, warnings: [""] },
    { ...generatedWireDraft, actionPlanDecision: null },
    { ...multipleIssuesWireDraft, outcome: "unknown" },
  ])("отклоняет malformed wire %#", (draft) => {
    expect(() => parseRequestDraft(responseText(draft))).toThrow();
  });

  it("сохраняет subject enabled/disabled boundary", () => {
    const disabledSubject =
      createRequestDraftJsonSchema(undefined).properties.draft.properties.subject;
    const enabledSubject = createRequestDraftJsonSchema("common_area_premises_lighting").properties
      .draft.properties.subject;

    expect(disabledSubject).toEqual({ type: "null" });
    expect(JSON.stringify(enabledSubject)).toContain("common_area_premises_lighting");
  });

  it("prompt оставляет desiredActions authoritative context, но не поручает модели требования", () => {
    const prompt = createRequestDraftSystemPrompt(undefined);

    expect(prompt).toContain("desiredActions — authoritative требование пользователя");
    expect(prompt).toContain("backend сам добавит его в раздел «Прошу:»");
    expect(prompt).toContain("не дублируй desiredActions в problem, circumstances или impact");
    expect(prompt).toContain("Не придумывай технический способ устранения");
    expect(prompt).not.toContain("необходимого действия");

    for (const removedRule of [
      "verificationDecision",
      "actionPlanDecision",
      "desiredActionsAllocation",
      "preliminaryCheck",
      "remedyActions",
      "resultCheck",
      "exact_fragment",
      "procedural",
      "resolve_observed_problem",
    ]) {
      expect(prompt).not.toContain(removedRule);
    }
  });
});
