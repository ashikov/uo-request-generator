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
const desiredActionSourceSchema = z.discriminatedUnion("selection", [
  z
    .object({
      sourceField: z.literal("desiredActions"),
      selection: z.literal("whole"),
    })
    .strict(),
  z
    .object({
      sourceField: z.literal("desiredActions"),
      selection: z.literal("exact_fragment"),
      quote: z
        .string()
        .min(1)
        .max(generateRequestLimits.desiredActions.max)
        .refine((value) => value.trim().length > 0),
    })
    .strict(),
]);

const explicitDesiredActionDecisionSchema = z
  .object({
    intent: z.literal("use_explicit_desired_action"),
    source: desiredActionSourceSchema,
  })
  .strict();

const verificationDecisionSchema = z
  .object({
    intent: z.literal("preserve_user_stated_uncertainty"),
    evidence: descriptionEvidenceSchema,
  })
  .strict();

const preliminaryCheckDecisionSchema = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("establish_unknown_cause"),
      evidence: descriptionEvidenceSchema,
    })
    .strict(),
  explicitDesiredActionDecisionSchema,
]);

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
  explicitDesiredActionDecisionSchema,
]);

const resultCheckDecisionSchema = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("confirm_problem_resolved"),
      evidence: descriptionEvidenceSchema,
    })
    .strict(),
  explicitDesiredActionDecisionSchema,
]);

const actionPlanDecisionSchema = z
  .object({
    preliminaryCheck: preliminaryCheckDecisionSchema.nullable(),
    remedyActions: z.array(remedyDecisionSchema).min(1),
    resultCheck: resultCheckDecisionSchema.nullable(),
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
        message: "Слишком много пунктов procedural plan",
      });
    }
  });

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
type ExplicitDesiredActionDecision = z.infer<typeof explicitDesiredActionDecisionSchema>;

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
  const desiredActions = input.desiredActions;
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

function isExplicitDesiredActionDecision(
  decision:
    | GeneratedSelectiveDraft["actionPlanDecision"]["preliminaryCheck"]
    | GeneratedSelectiveDraft["actionPlanDecision"]["remedyActions"][number]
    | GeneratedSelectiveDraft["actionPlanDecision"]["resultCheck"],
): decision is ExplicitDesiredActionDecision {
  return decision?.intent === "use_explicit_desired_action";
}

function selectDesiredActionSource(
  input: GenerateRequestInput,
  decision: ExplicitDesiredActionDecision,
): string {
  const source = sourceDesiredActions(input);
  if (decision.source.selection === "whole") return source;

  const start = source.indexOf(decision.source.quote);
  if (start === -1) reject("Desired actions fragment не найден во входе");
  return source.slice(start, start + decision.source.quote.length);
}

function validateProceduralDecision(
  input: GenerateRequestInput,
  decision:
    | NonNullable<GeneratedSelectiveDraft["actionPlanDecision"]["preliminaryCheck"]>
    | GeneratedSelectiveDraft["actionPlanDecision"]["remedyActions"][number]
    | NonNullable<GeneratedSelectiveDraft["actionPlanDecision"]["resultCheck"]>,
): void {
  switch (decision.intent) {
    case "establish_unknown_cause":
    case "resolve_observed_problem":
    case "confirm_problem_resolved":
      validateDescriptionEvidence(input, decision.evidence);
      break;
    case "install_observed_missing_element":
      validateDescriptionEvidence(input, decision.observationEvidence);
      validateDescriptionEvidence(input, decision.targetEvidence);
      if (!decision.observationEvidence.quote.includes(decision.targetEvidence.quote)) {
        reject("Target evidence не входит в observation evidence");
      }
      break;
    case "use_explicit_desired_action":
      selectDesiredActionSource(input, decision);
      break;
  }
}

function validateDecision(input: GenerateRequestInput, draft: GeneratedSelectiveDraft): void {
  if (draft.verificationDecision !== null) {
    validateDescriptionEvidence(input, draft.verificationDecision.evidence);
  }

  const { preliminaryCheck, remedyActions, resultCheck } = draft.actionPlanDecision;
  if (preliminaryCheck !== null) validateProceduralDecision(input, preliminaryCheck);
  for (const remedy of remedyActions) validateProceduralDecision(input, remedy);
  if (resultCheck !== null) validateProceduralDecision(input, resultCheck);

  const proceduralDecisions = [preliminaryCheck, ...remedyActions, resultCheck];
  const hasExplicitDesiredAction = proceduralDecisions.some(isExplicitDesiredActionDecision);
  if (input.desiredActions !== undefined && !hasExplicitDesiredAction) {
    reject("Явные desiredActions требуют source-bound allocation");
  }

  if (draft.subject !== null) {
    const selection = evaluateSpecificLegalBasisSelection(draft.subject, input);
    if (selection.status !== "applied") reject("Subject не подтверждён входом");
  }
}

function normalizeAuthoritativeAction(value: string): string {
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
  const preliminaryCheck = materializePreliminaryCheck(input, decision.preliminaryCheck);
  const remedyActions = decision.remedyActions.map((remedy) => materializeRemedy(input, remedy));
  const resultCheck = materializeResultCheck(input, decision.resultCheck);

  return { preliminaryCheck, remedyActions, resultCheck };
}

function materializePreliminaryCheck(
  input: GenerateRequestInput,
  decision: GeneratedSelectiveDraft["actionPlanDecision"]["preliminaryCheck"],
): string | null {
  if (decision === null) return null;
  if (decision.intent === "use_explicit_desired_action") {
    return normalizeAuthoritativeAction(selectDesiredActionSource(input, decision));
  }
  return `Установить причину наблюдаемой проблемы: «${decision.evidence.quote}»`;
}

function materializeRemedy(
  input: GenerateRequestInput,
  decision: GeneratedSelectiveDraft["actionPlanDecision"]["remedyActions"][number],
): string {
  switch (decision.intent) {
    case "resolve_observed_problem":
      return `Устранить наблюдаемую проблему: «${decision.evidence.quote}»`;
    case "install_observed_missing_element":
      return `Установить отсутствующий элемент, указанный пользователем: «${decision.targetEvidence.quote}»`;
    case "use_explicit_desired_action":
      return normalizeAuthoritativeAction(selectDesiredActionSource(input, decision));
  }
}

function materializeResultCheck(
  input: GenerateRequestInput,
  decision: GeneratedSelectiveDraft["actionPlanDecision"]["resultCheck"],
): string | null {
  if (decision === null) return null;
  if (decision.intent === "use_explicit_desired_action") {
    return normalizeAuthoritativeAction(selectDesiredActionSource(input, decision));
  }
  return `После работ проверить устранение наблюдаемой проблемы: «${decision.evidence.quote}»`;
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
