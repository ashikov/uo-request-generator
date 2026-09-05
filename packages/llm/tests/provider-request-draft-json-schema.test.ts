import {
  PRIMARY_REQUEST_SUBJECT_EVIDENCE_SOURCE_FIELDS,
  PRIMARY_REQUEST_SUBJECT_KINDS,
  primaryRequestDraftLimits,
  primaryRequestSubjectLimits,
} from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import { createRequestDraftJsonSchema, REQUEST_DRAFT_JSON_SCHEMA } from "../src/request-draft.js";

describe("provider RequestDraft JSON Schema", () => {
  it("задаёт один строгий универсальный объект без полей готового документа", () => {
    const draftSchema = REQUEST_DRAFT_JSON_SCHEMA.properties.draft;

    expect(draftSchema.additionalProperties).toBe(false);
    expect(draftSchema.required).toEqual([
      "outcome",
      "title",
      "problem",
      "circumstances",
      "impact",
      "subject",
      "warnings",
    ]);
    expect(Object.keys(draftSchema.properties)).toEqual(draftSchema.required);
    expect(JSON.stringify(draftSchema)).not.toContain("requestItems");
    expect(JSON.stringify(draftSchema)).not.toContain("actionPlan");
    expect(draftSchema.properties.title).toMatchObject({
      type: ["string", "null"],
      maxLength: primaryRequestDraftLimits.title.max,
    });
  });

  it("сохраняет совместимый provider subject schema без regex для evidence quote", () => {
    const subjectSchema = createRequestDraftJsonSchema(PRIMARY_REQUEST_SUBJECT_KINDS[0]).properties
      .draft.properties.subject;
    if (!("anyOf" in subjectSchema)) throw new Error("Ожидалась включённая subject schema");
    const enabledSubject = subjectSchema.anyOf[0];

    expect(enabledSubject.additionalProperties).toBe(false);
    expect(enabledSubject.properties.kind.enum).toEqual([...PRIMARY_REQUEST_SUBJECT_KINDS]);
    expect(enabledSubject.properties.evidence).toMatchObject({
      minItems: primaryRequestSubjectLimits.evidence.min,
      maxItems: primaryRequestSubjectLimits.evidence.max,
    });
    expect(enabledSubject.properties.evidence.items.properties.sourceField.enum).toEqual([
      ...PRIMARY_REQUEST_SUBJECT_EVIDENCE_SOURCE_FIELDS,
    ]);
    expect(enabledSubject.properties.evidence.items.properties.quote).toEqual({
      type: "string",
      minLength: primaryRequestSubjectLimits.quote.min,
      maxLength: primaryRequestSubjectLimits.quote.max,
    });
  });

  it("отключает subject без backend confirmation", () => {
    expect(REQUEST_DRAFT_JSON_SCHEMA.properties.draft.properties.subject).toEqual({ type: "null" });
  });

  it("не переключает схему по desiredActions", () => {
    expect(createRequestDraftJsonSchema(undefined)).toEqual(REQUEST_DRAFT_JSON_SCHEMA);
    expect(createRequestDraftJsonSchema(PRIMARY_REQUEST_SUBJECT_KINDS[0])).toEqual(
      createRequestDraftJsonSchema(PRIMARY_REQUEST_SUBJECT_KINDS.at(-1)),
    );
  });
});
