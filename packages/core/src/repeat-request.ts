import { z } from "zod";
import { COMMON_LEGAL_BASIS_BLOCK } from "./legal-basis.js";

export const repeatRequestLimits = {
  previousRequest: { min: 10, max: 2000 },
  currentState: { min: 10, max: 2000 },
  responseText: { max: 2000 },
  previousRequestNumber: { max: 80 },
  performedActions: { max: 1000 },
  unresolvedQuestions: { max: 1000 },
  newFacts: { max: 1000 },
  location: { max: 120 },
  desiredActions: { max: 500 },
  total: { max: 7000 },
  result: { titleMax: 120, bodyMax: 8000, warningsMax: 5, warningMax: 200 },
} as const;

export const repeatRequestDraftLimits = {
  title: { max: repeatRequestLimits.result.titleMax },
  originalProblem: { max: 800 },
  previousRequestSummary: { max: 1200 },
  responseSummary: { max: 1200 },
  performedActions: { max: 1000 },
  currentState: { max: 1600 },
  unresolvedQuestions: { max: 1000 },
  circumstancesToVerify: { max: 600 },
  newFacts: { max: 1000 },
  requestItems: { length: 1 },
  requestItem: { max: repeatRequestLimits.desiredActions.max },
  warnings: { max: repeatRequestLimits.result.warningsMax },
  warning: { max: repeatRequestLimits.result.warningMax },
  body: { max: repeatRequestLimits.result.bodyMax },
} as const;

const sourceText = (max: number, min = 1) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length >= min, "Недостаточно содержательных символов");

const requestNumberSchema = sourceText(repeatRequestLimits.previousRequestNumber.max).regex(
  /^[^\p{Cc}\p{Zl}\p{Zp}]*$/u,
  "Номер обращения не должен содержать управляющие символы или переводы строк",
);
const requestDateSchema = z.iso.date();
const locationSchema = sourceText(repeatRequestLimits.location.max);
const responseStatusSchema = z.enum(["not_received", "unknown", "received"]);

const responseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_received") }).strict(),
  z.object({ status: z.literal("unknown") }).strict(),
  z
    .object({
      status: z.literal("received"),
      text: sourceText(repeatRequestLimits.responseText.max),
      date: requestDateSchema.optional(),
    })
    .strict(),
]);

export const repeatRequestInputSchema = z
  .object({
    previousRequest: sourceText(
      repeatRequestLimits.previousRequest.max,
      repeatRequestLimits.previousRequest.min,
    ),
    currentState: sourceText(
      repeatRequestLimits.currentState.max,
      repeatRequestLimits.currentState.min,
    ),
    response: responseSchema,
    previousRequestDate: requestDateSchema.optional(),
    previousRequestNumber: requestNumberSchema.optional(),
    performedActions: sourceText(repeatRequestLimits.performedActions.max).optional(),
    unresolvedQuestions: sourceText(repeatRequestLimits.unresolvedQuestions.max).optional(),
    newFacts: sourceText(repeatRequestLimits.newFacts.max).optional(),
    location: locationSchema.optional(),
    desiredActions: sourceText(repeatRequestLimits.desiredActions.max)
      .refine(
        (value) => value.trim().replace(/^прошу\s*:\s*/iu, "") !== "",
        "Желаемые действия должны содержать текст после «Прошу:»",
      )
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const sourceLength =
      input.previousRequest.length +
      input.currentState.length +
      (input.previousRequestDate?.length ?? 0) +
      (input.previousRequestNumber?.length ?? 0) +
      (input.performedActions?.length ?? 0) +
      (input.unresolvedQuestions?.length ?? 0) +
      (input.newFacts?.length ?? 0) +
      (input.location?.length ?? 0) +
      (input.desiredActions?.length ?? 0) +
      (input.response.status === "received"
        ? input.response.text.length + (input.response.date?.length ?? 0)
        : 0);
    if (sourceLength > repeatRequestLimits.total.max) {
      context.addIssue({ code: "custom", message: "История обращения превышает общий лимит" });
    }
  });

export type RepeatRequestInput = z.infer<typeof repeatRequestInputSchema>;

const draftText = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[^\r\n\u2028\u2029]*$/u)
    .trim()
    .min(1);

const repeatRequestNarrativeShape = {
  title: draftText(repeatRequestDraftLimits.title.max),
  originalProblem: draftText(repeatRequestDraftLimits.originalProblem.max),
  previousRequestSummary: draftText(repeatRequestDraftLimits.previousRequestSummary.max),
  responseSummary: draftText(repeatRequestDraftLimits.responseSummary.max).nullable(),
  performedActions: draftText(repeatRequestDraftLimits.performedActions.max).nullable(),
  currentState: draftText(repeatRequestDraftLimits.currentState.max),
  unresolvedQuestions: draftText(repeatRequestDraftLimits.unresolvedQuestions.max).nullable(),
  circumstancesToVerify: draftText(repeatRequestDraftLimits.circumstancesToVerify.max).nullable(),
  newFacts: draftText(repeatRequestDraftLimits.newFacts.max).nullable(),
  warnings: z
    .array(draftText(repeatRequestDraftLimits.warning.max))
    .max(repeatRequestDraftLimits.warnings.max),
};

export const generatedRepeatRequestDraftSchema = z
  .object({ outcome: z.literal("generated"), ...repeatRequestNarrativeShape })
  .strict();

export const repeatRequestProviderDraftSchema = z.discriminatedUnion("outcome", [
  generatedRepeatRequestDraftSchema,
  z.object({ outcome: z.literal("multiple_issues") }).strict(),
  z.object({ outcome: z.literal("insufficient_history") }).strict(),
]);

export type GeneratedRepeatRequestDraft = z.infer<typeof generatedRepeatRequestDraftSchema>;
export type RepeatRequestProviderDraft = z.infer<typeof repeatRequestProviderDraftSchema>;

const repeatRequestDraftBaseSchema = z
  .object({
    ...repeatRequestNarrativeShape,
    previousRequestDate: requestDateSchema.optional(),
    previousRequestNumber: requestNumberSchema.optional(),
    responseStatus: responseStatusSchema,
    responseDate: requestDateSchema.optional(),
    location: locationSchema.optional(),
    requestItems: z.tuple([
      draftText(repeatRequestDraftLimits.requestItem.max).refine(
        (requestItem) => !/^прошу\s*:/iu.test(requestItem),
      ),
    ]),
  })
  .strict()
  .superRefine((draft, context) => {
    if ((draft.responseStatus === "received") !== (draft.responseSummary !== null)) {
      context.addIssue({
        code: "custom",
        path: ["responseSummary"],
        message: "Содержание ответа не соответствует его статусу",
      });
    }
    if (draft.responseStatus !== "received" && draft.responseDate !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["responseDate"],
        message: "Дата ответа допустима только для полученного ответа",
      });
    }
  });

type RepeatRequestBodyParts = z.infer<typeof repeatRequestDraftBaseSchema>;

function sentence(text: string): string {
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

function buildRepeatRequestBody(draft: RepeatRequestBodyParts): string {
  const previousRequestMetadata = [
    draft.previousRequestDate === undefined ? null : `дата ${draft.previousRequestDate}`,
    draft.previousRequestNumber === undefined ? null : `номер ${draft.previousRequestNumber}`,
  ].filter((part): part is string => part !== null);
  const previousRequestBlock = [
    "Предыдущее обращение:",
    previousRequestMetadata.length === 0 ? null : `${previousRequestMetadata.join(", ")}.`,
    sentence(draft.previousRequestSummary),
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
  const responseBlock =
    draft.responseStatus === "received"
      ? sentence(
          `Ответ УО${draft.responseDate === undefined ? "" : ` от ${draft.responseDate}`}: ${draft.responseSummary}`,
        )
      : draft.responseStatus === "not_received"
        ? "Ответ на предыдущее обращение не получен."
        : "Сведения об ответе на предыдущее обращение отсутствуют.";

  // Нормативный блок пока используется только offline до закрытия gate из REPEAT_REQUEST.md.
  return [
    sentence(draft.originalProblem),
    previousRequestBlock,
    responseBlock,
    draft.performedActions === null
      ? null
      : sentence(`Выполненные действия: ${draft.performedActions}`),
    sentence(`Текущее состояние: ${draft.currentState}`),
    draft.unresolvedQuestions === null
      ? null
      : sentence(`Нерешённые вопросы: ${draft.unresolvedQuestions}`),
    draft.circumstancesToVerify === null
      ? null
      : sentence(`Требует уточнения: ${draft.circumstancesToVerify}`),
    draft.newFacts === null ? null : sentence(`Новые обстоятельства: ${draft.newFacts}`),
    draft.location === undefined
      ? null
      : sentence(
          `Дополнительно указанное место: ${draft.location.trim().replace(/\r\n|\r|\n/gu, " ")}`,
        ),
    COMMON_LEGAL_BASIS_BLOCK,
    `Прошу:\n1. ${sentence(draft.requestItems[0])}`,
  ]
    .filter((block): block is string => block !== null)
    .join("\n\n");
}

export const repeatRequestDraftSchema = repeatRequestDraftBaseSchema.superRefine(
  (draft, context) => {
    if (buildRepeatRequestBody(draft).length > repeatRequestLimits.result.bodyMax) {
      context.addIssue({ code: "custom", message: "Текст повторного обращения превышает лимит" });
    }
  },
);

export type RepeatRequestDraft = z.infer<typeof repeatRequestDraftSchema>;

export const repeatRequestResultSchema = z
  .object({
    title: z.string().min(1).max(repeatRequestLimits.result.titleMax),
    body: z.string().min(1).max(repeatRequestLimits.result.bodyMax),
    warnings: z
      .array(z.string().min(1).max(repeatRequestLimits.result.warningMax))
      .max(repeatRequestLimits.result.warningsMax),
  })
  .strict();

export type RepeatRequestResult = z.infer<typeof repeatRequestResultSchema>;

export const REPEAT_REQUEST_GENERIC_ITEM =
  "Повторно рассмотреть описанную проблему с учётом результата предыдущего обращения, сообщить о результатах рассмотрения и при подтверждении нерешённой проблемы принять меры по её устранению";

function normalizeRequestItem(value: string): string {
  return value
    .replace(/\r\n|\r|\n/gu, " ")
    .trim()
    .replace(/^прошу\s*:\s*/iu, "")
    .replace(/\p{L}/u, (letter) => {
      const uppercaseLetter = letter.toLocaleUpperCase("ru-RU");
      return uppercaseLetter.length === letter.length ? uppercaseLetter : letter;
    });
}

export function materializeRepeatRequestDraft(
  rawInput: RepeatRequestInput,
  candidate: unknown,
): RepeatRequestDraft {
  const input = repeatRequestInputSchema.parse(rawInput);
  const draft = generatedRepeatRequestDraftSchema.parse(candidate);

  return repeatRequestDraftSchema.parse({
    title: draft.title,
    originalProblem: draft.originalProblem,
    previousRequestSummary: draft.previousRequestSummary,
    responseSummary: draft.responseSummary,
    performedActions: draft.performedActions,
    currentState: draft.currentState,
    unresolvedQuestions: draft.unresolvedQuestions,
    circumstancesToVerify: draft.circumstancesToVerify,
    newFacts: draft.newFacts,
    warnings: draft.warnings,
    ...(input.previousRequestDate === undefined
      ? {}
      : { previousRequestDate: input.previousRequestDate }),
    ...(input.previousRequestNumber === undefined
      ? {}
      : { previousRequestNumber: input.previousRequestNumber }),
    responseStatus: input.response.status,
    ...(input.response.status === "received" && input.response.date !== undefined
      ? { responseDate: input.response.date }
      : {}),
    ...(input.location === undefined ? {} : { location: input.location }),
    requestItems: [
      input.desiredActions === undefined
        ? REPEAT_REQUEST_GENERIC_ITEM
        : normalizeRequestItem(input.desiredActions),
    ],
  });
}

export function renderRepeatRequestDraft(draft: RepeatRequestDraft): RepeatRequestResult {
  const validDraft = repeatRequestDraftSchema.parse(draft);
  return repeatRequestResultSchema.parse({
    title: validDraft.title,
    body: buildRepeatRequestBody(validDraft),
    warnings: validDraft.warnings,
  });
}
