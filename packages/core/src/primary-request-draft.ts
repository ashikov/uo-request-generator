import { z } from "zod";
import {
  generateRequestLimits,
  generateRequestResultSchema,
  type GenerateRequestResult,
} from "./contracts.js";

const REQUEST_BODY_SECTION_SEPARATOR = "\n\n";

export const COMMON_LEGAL_BASIS_BLOCK = [
  "В соответствии с частями 1 и 2.3 статьи 161 Жилищного кодекса РФ управление многоквартирным домом должно обеспечивать благоприятные и безопасные условия проживания граждан, а управляющая организация несёт ответственность за надлежащее содержание общего имущества.",
  "Подпункт «з» пункта 4 Правил осуществления деятельности по управлению многоквартирными домами, утверждённых постановлением Правительства РФ от 15.05.2013 № 416, предусматривает приём и рассмотрение заявок, предложений и обращений собственников и пользователей помещений.",
].join(REQUEST_BODY_SECTION_SEPARATOR);

export const primaryRequestDraftLimits = {
  title: {
    max: generateRequestLimits.result.titleMax,
  },
  problem: {
    max: 1_950,
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

function buildRequestBlock(actionPlan: PrimaryRequestActionPlan): string {
  const requestItems = [
    actionPlan.preliminaryCheck,
    ...actionPlan.remedyActions,
    actionPlan.resultCheck,
  ].filter((action): action is string => action !== null);

  return [
    "Прошу:",
    ...requestItems.map((request, index) => `${String(index + 1)}. ${request}`),
  ].join("\n");
}

function buildPrimaryRequestBody(draft: PrimaryRequestBodyParts): string {
  return [
    draft.problem,
    draft.circumstances,
    draft.impact,
    draft.verification,
    COMMON_LEGAL_BASIS_BLOCK,
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
    actionPlan: actionPlanSchema,
    warnings: z
      .array(draftString(primaryRequestDraftLimits.warning.max))
      .max(primaryRequestDraftLimits.warnings.max),
  })
  .strict()
  .superRefine((draft, context) => {
    if (buildPrimaryRequestBody(draft).length > primaryRequestDraftLimits.body.max) {
      context.addIssue({
        code: "custom",
        message: "Сформированный текст заявки превышает допустимую длину",
      });
    }
  });

export type PrimaryRequestDraft = z.infer<typeof primaryRequestDraftSchema>;

export function renderPrimaryRequestDraft(draft: PrimaryRequestDraft): GenerateRequestResult {
  const validDraft = primaryRequestDraftSchema.parse(draft);

  return generateRequestResultSchema.parse({
    title: validDraft.title,
    body: buildPrimaryRequestBody(validDraft),
    warnings: validDraft.warnings,
  });
}
