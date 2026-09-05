import { primaryRequestDraftLimits, primaryRequestSubjectSchema } from "@uo-request-generator/core";
import { z } from "zod";

const hasUnicodeLengthAtMost = (value: string, maximum: number) =>
  Array.from(value).length <= maximum;

const oneLineString = (maxLength: number) =>
  z
    .string()
    .refine((value) => hasUnicodeLengthAtMost(value, maxLength), "Строка превышает лимит")
    .regex(/^[^\r\n]*$/u)
    .trim()
    .min(1);

const providerDraftFields = {
  title: oneLineString(primaryRequestDraftLimits.title.max),
  problem: oneLineString(primaryRequestDraftLimits.problem.max),
  circumstances: oneLineString(primaryRequestDraftLimits.circumstances.max).nullable(),
  impact: oneLineString(primaryRequestDraftLimits.impact.max).nullable(),
  subject: primaryRequestSubjectSchema,
  warnings: z
    .array(oneLineString(primaryRequestDraftLimits.warning.max))
    .max(primaryRequestDraftLimits.warnings.max),
};

export const generatedProviderDraftSchema = z
  .object({
    outcome: z.literal("generated"),
    ...providerDraftFields,
  })
  .strict();

const universalProviderDraftSchema = z
  .object({
    outcome: z.enum(["generated", "multiple_issues"]),
    title: providerDraftFields.title.nullable(),
    problem: providerDraftFields.problem.nullable(),
    circumstances: providerDraftFields.circumstances,
    impact: providerDraftFields.impact,
    subject: providerDraftFields.subject,
    warnings: providerDraftFields.warnings,
  })
  .strict();

export const multipleIssuesProviderDraftSchema = z
  .object({ outcome: z.literal("multiple_issues") })
  .strict();

export const providerRequestDraftResponseSchema = z
  .object({ draft: universalProviderDraftSchema })
  .strict();

export type ProviderGeneratedDraft = z.infer<typeof generatedProviderDraftSchema>;
export type ProviderRequestDraft =
  | ProviderGeneratedDraft
  | z.infer<typeof multipleIssuesProviderDraftSchema>;
