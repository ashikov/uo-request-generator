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
  verification: {
    max: 500,
  },
  actionPlan: {
    remedyActionsMin: 1,
    itemsMax: 5,
  },
  action: {
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

const actionString = draftString(primaryRequestDraftLimits.action.max).refine(
  (action) => !/^прошу\s*:/iu.test(action),
);

const actionPlanSchema = z
  .object({
    preliminaryCheck: z.union([actionString, z.null()]),
    remedyActions: z.array(actionString).min(primaryRequestDraftLimits.actionPlan.remedyActionsMin),
    resultCheck: z.union([actionString, z.null()]),
  })
  .strict()
  .superRefine((actionPlan, context) => {
    const itemCount =
      Number(actionPlan.preliminaryCheck !== null) +
      actionPlan.remedyActions.length +
      Number(actionPlan.resultCheck !== null);

    if (itemCount > primaryRequestDraftLimits.actionPlan.itemsMax) {
      context.addIssue({
        code: "custom",
        message: "Процедурный план превышает допустимое число требований",
      });
    }
  });

type PrimaryRequestActionPlan = z.infer<typeof actionPlanSchema>;

type PrimaryRequestBodyParts = {
  problem: string;
  circumstances: string | null;
  impact: string | null;
  verification: string | null;
  actionPlan: PrimaryRequestActionPlan;
};

function normalizeSentenceEnding(text: string): string {
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

function buildRequestBlock(actionPlan: PrimaryRequestActionPlan): string {
  const requestItems = [
    actionPlan.preliminaryCheck,
    ...actionPlan.remedyActions,
    actionPlan.resultCheck,
  ].filter((action): action is string => action !== null);

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
    draft.verification === null ? null : normalizeSentenceEnding(draft.verification),
    COMMON_LEGAL_BASIS_BLOCK,
    ...specificLegalBasisParagraphs,
    buildRequestBlock(draft.actionPlan),
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
    verification: z.union([draftString(primaryRequestDraftLimits.verification.max), z.null()]),
    subject: primaryRequestSubjectSchema,
    actionPlan: actionPlanSchema,
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
