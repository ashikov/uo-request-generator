import {
  COMMON_LEGAL_BASIS_BLOCK,
  PRIMARY_REQUEST_SUBJECT_KINDS,
  primaryRequestDraftLimits,
  primaryRequestLegalBasisLimits,
} from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import {
  createRequestDraftJsonSchema,
  createRequestDraftSystemPrompt,
  createRequestDraftSystemPromptHash,
  REQUEST_DRAFT_DYNAMIC_BODY_MAX,
  REQUEST_DRAFT_SYSTEM_PROMPT,
} from "../src/request-draft.js";

describe("REQUEST_DRAFT_SYSTEM_PROMPT", () => {
  it("создаёт стабильный hash точного prompt", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_elevator");

    expect(createRequestDraftSystemPromptHash(prompt)).toBe(
      createRequestDraftSystemPromptHash(prompt),
    );
    expect(createRequestDraftSystemPromptHash(`${prompt} `)).not.toBe(
      createRequestDraftSystemPromptHash(prompt),
    );
  });

  it("сохраняет generative prose, non-invention и multi-location правила", () => {
    for (const fragment of [
      "description — свободное описание ситуации",
      "title",
      "problem",
      "circumstances",
      "impact",
      "warnings",
      "Не придумывай причины",
      "не превращай риск в событие",
      "несколько мест одной связанной проблемы допустимы",
      "не превращай несколько мест автоматически в multiple_issues",
      "desiredActions — authoritative требование пользователя",
      "backend сам добавит его в раздел «Прошу:»",
      "не дублируй desiredActions в problem, circumstances или impact",
    ]) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(fragment);
    }
  });

  it("не поручает provider формировать требования или техническое решение", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не придумывай технический способ устранения");
    for (const removedConcept of [
      "requestItems",
      "verificationDecision",
      "actionPlanDecision",
      "desiredActionsAllocation",
      "preliminaryCheck",
      "remedyActions",
      "resultCheck",
      "exact_fragment",
      "procedural",
    ]) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(removedConcept);
    }
  });

  it("сохраняет subject evidence gate и не раскрывает backend confirmation", () => {
    const prompt = createRequestDraftSystemPrompt(PRIMARY_REQUEST_SUBJECT_KINDS[0]);

    for (const kind of PRIMARY_REQUEST_SUBJECT_KINDS) {
      expect(prompt).toContain(`- используй kind ${kind},`);
      expect(prompt).toContain(`- для kind ${kind} evidence`);
    }
    expect(prompt).not.toContain("confirmedProblemSubject");
  });

  it("оставляет subject null без backend confirmation", () => {
    expect(createRequestDraftSystemPrompt(undefined)).toContain("- subject: укажи null");
    expect(createRequestDraftJsonSchema(undefined).properties.draft.properties.subject).toEqual({
      type: "null",
    });
  });

  it("сохраняет динамический budget и не раскрывает нормативный блок", () => {
    expect(REQUEST_DRAFT_DYNAMIC_BODY_MAX).toBe(
      primaryRequestDraftLimits.body.max -
        primaryRequestLegalBasisLimits.maximumBlockLength -
        "\n\n".length * 2,
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      `не более ${REQUEST_DRAFT_DYNAMIC_BODY_MAX} символов`,
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_LEGAL_BASIS_BLOCK);
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain("https://");
  });
});
