import { z } from "zod";
import {
  generateRequestInputSchema,
  generateRequestLimits,
  type GenerateRequestInput,
} from "../src/contracts.js";
import {
  evaluateSpecificLegalBasisSelection,
  primaryRequestSubjectSchema,
} from "../src/legal-basis.js";
import {
  type PrimaryRequestDraft,
  primaryRequestDraftLimits,
  primaryRequestDraftSchema,
} from "../src/primary-request-draft.js";

const oneLineString = (maxLength: number) =>
  z
    .string()
    .regex(/^[^\r\n]*$/u)
    .trim()
    .min(1)
    .max(maxLength);

const oneLineEvidenceQuote = z
  .string()
  .refine(
    (quote) => !quote.includes("\r") && !quote.includes("\n"),
    "Цитата должна быть однострочной",
  )
  .trim();

const evidenceFor = <SourceField extends "description" | "desiredActions">(
  sourceField: SourceField,
  quoteSchema: z.ZodString,
) => z.object({ sourceField: z.literal(sourceField), quote: quoteSchema }).strict();

const descriptionEvidenceSchema = evidenceFor("description", oneLineEvidenceQuote.min(10).max(300));
const descriptionTargetEvidenceSchema = evidenceFor(
  "description",
  oneLineEvidenceQuote.min(1).max(120),
);
const desiredActionsEvidenceSchema = evidenceFor(
  "desiredActions",
  z.string().trim().min(1).max(generateRequestLimits.desiredActions.max),
);

const verificationDecisionSchema = z
  .object({
    intent: z.literal("preserve_user_stated_uncertainty"),
    evidence: descriptionEvidenceSchema,
  })
  .strict();

const preliminaryCheckDecisionSchema = z
  .object({
    intent: z.literal("establish_unknown_cause"),
    evidence: descriptionEvidenceSchema,
  })
  .strict();

const remedyDecisionSchema = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("resolve_observed_problem"),
      evidence: descriptionEvidenceSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("install_observed_missing_element"),
      observationEvidence: descriptionEvidenceSchema,
      targetEvidence: descriptionTargetEvidenceSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("perform_explicit_desired_actions"),
      evidence: desiredActionsEvidenceSchema,
    })
    .strict(),
]);

const resultCheckDecisionSchema = z
  .object({
    intent: z.literal("confirm_problem_resolved"),
    evidence: descriptionEvidenceSchema,
  })
  .strict();

const actionPlanDecisionSchema = z
  .object({
    preliminaryCheck: preliminaryCheckDecisionSchema.nullable(),
    remedy: remedyDecisionSchema,
    resultCheck: resultCheckDecisionSchema.nullable(),
  })
  .strict();

const generatedSelectiveDraftSchema = z
  .object({
    outcome: z.literal("generated"),
    title: oneLineString(primaryRequestDraftLimits.title.max),
    problem: oneLineString(primaryRequestDraftLimits.problem.max),
    circumstances: oneLineString(primaryRequestDraftLimits.circumstances.max).nullable(),
    impact: oneLineString(primaryRequestDraftLimits.impact.max).nullable(),
    verificationDecision: verificationDecisionSchema.nullable(),
    subject: primaryRequestSubjectSchema,
    actionPlanDecision: actionPlanDecisionSchema,
    warnings: z
      .array(oneLineString(primaryRequestDraftLimits.warning.max))
      .max(primaryRequestDraftLimits.warnings.max),
  })
  .strict();

export const selectiveProviderDraftSchema = z.discriminatedUnion("outcome", [
  generatedSelectiveDraftSchema,
  z.object({ outcome: z.literal("multiple_issues") }).strict(),
]);

type GeneratedSelectiveDraft = z.infer<typeof generatedSelectiveDraftSchema>;
type DescriptionEvidence = z.infer<
  typeof descriptionEvidenceSchema | typeof descriptionTargetEvidenceSchema
>;

export class SelectiveGateRejectionError extends Error {
  override name = "SelectiveGateRejectionError";
}

function reject(message: string): never {
  throw new SelectiveGateRejectionError(message);
}

function sourceDescription(input: GenerateRequestInput): string {
  return input.description.trim();
}

function sourceDesiredActions(input: GenerateRequestInput): string {
  const desiredActions = input.desiredActions?.trim();
  return desiredActions === undefined ? reject("Отсутствует поле desiredActions") : desiredActions;
}

function validateDescriptionEvidence(
  input: GenerateRequestInput,
  evidence: DescriptionEvidence,
): void {
  if (!sourceDescription(input).includes(evidence.quote)) {
    reject("Description evidence не найдено во входе");
  }
}

function validateDecision(input: GenerateRequestInput, draft: GeneratedSelectiveDraft): void {
  if (draft.verificationDecision !== null) {
    validateDescriptionEvidence(input, draft.verificationDecision.evidence);
  }

  const { preliminaryCheck, remedy, resultCheck } = draft.actionPlanDecision;
  if (preliminaryCheck !== null) validateDescriptionEvidence(input, preliminaryCheck.evidence);
  if (resultCheck !== null) validateDescriptionEvidence(input, resultCheck.evidence);

  switch (remedy.intent) {
    case "resolve_observed_problem":
      validateDescriptionEvidence(input, remedy.evidence);
      break;
    case "install_observed_missing_element":
      validateDescriptionEvidence(input, remedy.observationEvidence);
      validateDescriptionEvidence(input, remedy.targetEvidence);
      if (!remedy.observationEvidence.quote.includes(remedy.targetEvidence.quote)) {
        reject("Target evidence не входит в observation evidence");
      }
      break;
    case "perform_explicit_desired_actions":
      if (sourceDesiredActions(input) !== remedy.evidence.quote) {
        reject("Desired actions evidence должно быть полным");
      }
      break;
  }

  if (input.desiredActions !== undefined && remedy.intent !== "perform_explicit_desired_actions") {
    reject("Явные desiredActions требуют authoritative path");
  }

  if (
    draft.verificationDecision !== null &&
    preliminaryCheck !== null &&
    draft.verificationDecision.evidence.quote === preliminaryCheck.evidence.quote
  ) {
    reject("Verification не должно точно дублировать preliminaryCheck");
  }

  if (draft.subject !== null) {
    const selection = evaluateSpecificLegalBasisSelection(draft.subject, input);
    if (selection.status !== "applied") reject("Subject не подтверждён входом");
  }
}

function normalizeAuthoritativeText(value: string): string {
  return value.replaceAll("\r\n", " ").replaceAll("\r", " ").replaceAll("\n", " ").trim();
}

function materializeVerification(
  decision: GeneratedSelectiveDraft["verificationDecision"],
): string | null {
  if (decision === null) return null;
  return `Требует проверки указанное пользователем обстоятельство: «${decision.evidence.quote}»`;
}

function materializeActionPlan(
  input: GenerateRequestInput,
  decision: GeneratedSelectiveDraft["actionPlanDecision"],
): PrimaryRequestDraft["actionPlan"] {
  const preliminaryCheck =
    decision.preliminaryCheck === null
      ? null
      : `Установить причину наблюдаемой проблемы: «${decision.preliminaryCheck.evidence.quote}»`;
  const resultCheck =
    decision.resultCheck === null
      ? null
      : `После работ проверить устранение наблюдаемой проблемы: «${decision.resultCheck.evidence.quote}»`;

  let remedy: string;
  switch (decision.remedy.intent) {
    case "resolve_observed_problem":
      remedy = `Устранить наблюдаемую проблему: «${decision.remedy.evidence.quote}»`;
      break;
    case "install_observed_missing_element":
      remedy = `Установить отсутствующий элемент, указанный пользователем: «${decision.remedy.targetEvidence.quote}»`;
      break;
    case "perform_explicit_desired_actions":
      remedy = normalizeAuthoritativeText(sourceDesiredActions(input));
      break;
  }

  return { preliminaryCheck, remedyActions: [remedy], resultCheck };
}

export function materializeSelectiveDraft(
  rawInput: GenerateRequestInput,
  candidate: unknown,
): PrimaryRequestDraft {
  const inputResult = generateRequestInputSchema.safeParse(rawInput);
  if (!inputResult.success) return reject("Вход не прошёл публичную схему");

  const decisionResult = selectiveProviderDraftSchema.safeParse(candidate);
  if (!decisionResult.success) return reject("Ответ не соответствует selective схеме");
  if (decisionResult.data.outcome === "multiple_issues") {
    return reject("Нельзя материализовать multiple_issues");
  }

  const decision = decisionResult.data;
  validateDecision(inputResult.data, decision);
  const draftResult = primaryRequestDraftSchema.safeParse({
    title: decision.title,
    problem: decision.problem,
    circumstances: decision.circumstances,
    impact: decision.impact,
    verification: materializeVerification(decision.verificationDecision),
    subject: decision.subject,
    actionPlan: materializeActionPlan(inputResult.data, decision.actionPlanDecision),
    warnings: decision.warnings,
  });

  return draftResult.success
    ? draftResult.data
    : reject("Материализованный draft не прошёл PrimaryRequestDraft schema");
}
