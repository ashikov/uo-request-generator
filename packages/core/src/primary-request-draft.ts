import { z } from "zod";
import {
  generateRequestLimits,
  generateRequestResultSchema,
  type GenerateRequestInput,
  type GenerateRequestResult,
} from "./contracts.js";
import {
  COMMON_LEGAL_BASIS_BLOCK,
  primaryRequestLegalBasisLimits,
  primaryRequestSubjectSchema,
  selectSpecificLegalBasisParagraphs,
} from "./legal-basis.js";

const REQUEST_BODY_SECTION_SEPARATOR = "\n\n";

export const primaryRequestDraftLimits = {
  title: {
    max: generateRequestLimits.result.titleMax,
  },
  problem: {
    max:
      1_950 - (primaryRequestLegalBasisLimits.maximumBlockLength - COMMON_LEGAL_BASIS_BLOCK.length),
  },
  circumstances: {
    max: 600,
  },
  impact: {
    max: 500,
  },
  requestItems: {
    length: 1,
  },
  requestItem: {
    max: generateRequestLimits.desiredActions.max,
  },
  warnings: {
    max: generateRequestLimits.result.warningsMax,
  },
  warning: {
    max: generateRequestLimits.result.warningMax,
  },
  body: {
    max: generateRequestLimits.result.bodyMax,
  },
} as const;

const draftString = (maxLength: number) =>
  z
    .string()
    .regex(/^[^\r\n]*$/u)
    .trim()
    .min(1)
    .max(maxLength);

const requestItemString = draftString(primaryRequestDraftLimits.requestItem.max).refine(
  (requestItem) => !/^прошу\s*:/iu.test(requestItem),
);

type PrimaryRequestBodyParts = {
  problem: string;
  circumstances: string | null;
  impact: string | null;
  requestItems: string[];
};

function normalizeSentenceEnding(text: string): string {
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

function buildRequestBlock(requestItems: readonly string[]): string {
  return [
    "Прошу:",
    ...requestItems.map(
      (request, index) => `${String(index + 1)}. ${normalizeSentenceEnding(request)}`,
    ),
  ].join("\n");
}

function buildPrimaryRequestBody(
  draft: PrimaryRequestBodyParts,
  specificLegalBasisParagraphs: readonly string[] = [],
): string {
  return [
    normalizeSentenceEnding(draft.problem),
    draft.circumstances === null ? null : normalizeSentenceEnding(draft.circumstances),
    draft.impact === null ? null : normalizeSentenceEnding(draft.impact),
    COMMON_LEGAL_BASIS_BLOCK,
    ...specificLegalBasisParagraphs,
    buildRequestBlock(draft.requestItems),
  ]
    .filter((block): block is string => block !== null)
    .join(REQUEST_BODY_SECTION_SEPARATOR);
}

export const primaryRequestDraftSchema = z
  .object({
    title: draftString(primaryRequestDraftLimits.title.max),
    problem: draftString(primaryRequestDraftLimits.problem.max),
    circumstances: z.union([draftString(primaryRequestDraftLimits.circumstances.max), z.null()]),
    impact: z.union([draftString(primaryRequestDraftLimits.impact.max), z.null()]),
    subject: primaryRequestSubjectSchema,
    requestItems: z.array(requestItemString).length(primaryRequestDraftLimits.requestItems.length),
    warnings: z
      .array(draftString(primaryRequestDraftLimits.warning.max))
      .max(primaryRequestDraftLimits.warnings.max),
  })
  .strict()
  .superRefine((draft, context) => {
    if (
      buildPrimaryRequestBody(draft).length +
        (primaryRequestLegalBasisLimits.maximumBlockLength - COMMON_LEGAL_BASIS_BLOCK.length) >
      primaryRequestDraftLimits.body.max
    ) {
      context.addIssue({
        code: "custom",
        message: "Сформированный текст заявки превышает допустимую длину",
      });
    }
  });

export type PrimaryRequestDraft = z.infer<typeof primaryRequestDraftSchema>;

export function renderPrimaryRequestDraft(
  draft: PrimaryRequestDraft,
  input?: GenerateRequestInput,
): GenerateRequestResult {
  const validDraft = primaryRequestDraftSchema.parse(draft);
  const specificLegalBasisParagraphs = selectSpecificLegalBasisParagraphs(
    validDraft.subject,
    input,
  );

  return generateRequestResultSchema.parse({
    title: validDraft.title,
    body: buildPrimaryRequestBody(validDraft, specificLegalBasisParagraphs),
    warnings: validDraft.warnings,
  });
}
