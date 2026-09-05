import {
  type ConfirmedProblemSubject,
  PRIMARY_REQUEST_SUBJECT_EVIDENCE_SOURCE_FIELDS,
  PRIMARY_REQUEST_SUBJECT_KINDS,
  primaryRequestDraftLimits,
  primaryRequestSubjectLimits,
} from "@uo-request-generator/core";

const ONE_LINE_NON_BLANK_PATTERN = "^[^\\r\\n]*\\S[^\\r\\n]*$";

const draftString = (maxLength: number) => ({
  type: "string" as const,
  minLength: 1,
  maxLength,
  pattern: ONE_LINE_NON_BLANK_PATTERN,
});

const nullableDraftString = (maxLength: number) => ({
  type: ["string", "null"] as const,
  minLength: 1,
  maxLength,
  pattern: ONE_LINE_NON_BLANK_PATTERN,
});

const disabledSubject = { type: "null" } as const;
const inferredSubject = {
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...PRIMARY_REQUEST_SUBJECT_KINDS] },
        evidence: {
          type: "array",
          minItems: primaryRequestSubjectLimits.evidence.min,
          maxItems: primaryRequestSubjectLimits.evidence.max,
          items: {
            type: "object",
            properties: {
              sourceField: {
                type: "string",
                enum: [...PRIMARY_REQUEST_SUBJECT_EVIDENCE_SOURCE_FIELDS],
              },
              quote: {
                type: "string",
                minLength: primaryRequestSubjectLimits.quote.min,
                maxLength: primaryRequestSubjectLimits.quote.max,
              },
            },
            required: ["sourceField", "quote"],
            additionalProperties: false,
          },
        },
      },
      required: ["kind", "evidence"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
} as const;

const impactDescription =
  '<impact-role source="consequences" occurrence="exactly-once" preservation="semantic-over-lexical" paraphrase="natural-when-needed" natural-wording="preserve" subject-expansion="forbidden"> Помещай сюда весь смысл явно переданных consequences ровно один раз. Сохраняй фактический смысл, конкретность, объём и уже естественную формулировку. Перефразируй только контекстно неестественную формулировку, не добавляя исполнителя, группы людей, обстоятельства или последствия.';

function universalDraftSchema(subject: typeof disabledSubject | typeof inferredSubject) {
  return {
    type: "object",
    properties: {
      outcome: { type: "string", enum: ["generated", "multiple_issues"] },
      title: nullableDraftString(primaryRequestDraftLimits.title.max),
      problem: nullableDraftString(primaryRequestDraftLimits.problem.max),
      circumstances: nullableDraftString(primaryRequestDraftLimits.circumstances.max),
      impact: {
        ...nullableDraftString(primaryRequestDraftLimits.impact.max),
        description: impactDescription,
      },
      subject,
      warnings: {
        type: "array",
        maxItems: primaryRequestDraftLimits.warnings.max,
        items: draftString(primaryRequestDraftLimits.warning.max),
      },
    },
    required: ["outcome", "title", "problem", "circumstances", "impact", "subject", "warnings"],
    additionalProperties: false,
  } as const;
}

export function createRequestDraftJsonSchema(
  confirmedProblemSubject: ConfirmedProblemSubject | undefined,
) {
  const subject = confirmedProblemSubject === undefined ? disabledSubject : inferredSubject;
  return {
    type: "object",
    properties: {
      draft: universalDraftSchema(subject),
    },
    required: ["draft"],
    additionalProperties: false,
  } as const;
}

export const REQUEST_DRAFT_JSON_SCHEMA = createRequestDraftJsonSchema(undefined);
