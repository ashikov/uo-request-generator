import { z } from "zod";
import { generateRequestInputSchema, type GenerateRequestInput } from "./contracts.js";
import {
  primaryRequestDraftLimits,
  primaryRequestDraftSchema,
  type PrimaryRequestDraft,
} from "./primary-request-draft.js";
import { primaryRequestSubjectSchema } from "./legal-basis.js";

const hasUnicodeLengthAtMost = (value: string, maximum: number) =>
  Array.from(value).length <= maximum;

const draftString = (maxLength: number) =>
  z
    .string()
    .refine((value) => hasUnicodeLengthAtMost(value, maxLength), "Строка превышает лимит")
    .regex(/^[^\r\n]*$/u)
    .trim()
    .min(1);

export const generatedRequestDraftSchema = z
  .object({
    outcome: z.literal("generated"),
    title: draftString(primaryRequestDraftLimits.title.max),
    problem: draftString(primaryRequestDraftLimits.problem.max),
    circumstances: draftString(primaryRequestDraftLimits.circumstances.max).nullable(),
    impact: draftString(primaryRequestDraftLimits.impact.max).nullable(),
    subject: primaryRequestSubjectSchema,
    warnings: z
      .array(draftString(primaryRequestDraftLimits.warning.max))
      .max(primaryRequestDraftLimits.warnings.max),
  })
  .strict();

export const multipleIssuesRequestDraftSchema = z
  .object({ outcome: z.literal("multiple_issues") })
  .strict();

export const requestDraftSchema = z.discriminatedUnion("outcome", [
  generatedRequestDraftSchema,
  multipleIssuesRequestDraftSchema,
]);

export type GeneratedRequestDraft = z.infer<typeof generatedRequestDraftSchema>;
export type RequestDraft = z.infer<typeof requestDraftSchema>;

export const PRIMARY_REQUEST_GENERIC_ITEM = "Устранить наблюдаемую проблему";

function normalizeAuthoritativeRequestItem(value: string): string {
  const normalizedAction = value
    .replaceAll("\r\n", " ")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim()
    .replace(/^прошу\s*:\s*/iu, "");

  return normalizedAction.replace(/\p{L}/u, (letter) => {
    const uppercaseLetter = letter.toLocaleUpperCase("ru-RU");
    return uppercaseLetter.length === letter.length ? uppercaseLetter : letter;
  });
}

function buildRequestItems(input: GenerateRequestInput): [string] {
  return [
    input.desiredActions === undefined
      ? PRIMARY_REQUEST_GENERIC_ITEM
      : normalizeAuthoritativeRequestItem(input.desiredActions),
  ];
}

export function materializePrimaryRequestDraft(
  rawInput: GenerateRequestInput,
  candidate: unknown,
): PrimaryRequestDraft {
  const input = generateRequestInputSchema.parse(rawInput);
  const draft = generatedRequestDraftSchema.parse(candidate);

  return primaryRequestDraftSchema.parse({
    title: draft.title,
    problem: draft.problem,
    circumstances: draft.circumstances,
    impact: draft.impact,
    subject: draft.subject,
    requestItems: buildRequestItems(input),
    warnings: draft.warnings,
  });
}
