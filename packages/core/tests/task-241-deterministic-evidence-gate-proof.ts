import { z } from "zod";
import { type GenerateRequestInput, generateRequestLimits } from "../src/contracts.js";
import {
  evaluateSpecificLegalBasisSelection,
  primaryRequestSubjectSchema,
} from "../src/legal-basis.js";
import {
  type PrimaryRequestDraft,
  primaryRequestDraftSchema,
} from "../src/primary-request-draft.js";

export const FIXED_TEXT = {
  impact: "Проблема может затруднять пользование общим имуществом",
  install: "Установить отсутствующий элемент",
  restore: "Восстановить наблюдаемое состояние",
  establish: "Установить причину наблюдаемой проблемы",
  removeCause: "Устранить установленную причину наблюдаемой проблемы",
  resultCheck: "Проверить устранение наблюдаемой проблемы",
  locationTitle: "Проблема по указанному месту",
  locationProblem: "Наблюдаемая проблема",
  locationWarning: "Проверьте указанное место проблемы",
} as const;

type EvidenceSourceField = "description" | "desiredActions" | "location";
const oneLineEvidenceQuoteSchema = z
  .string()
  .refine(
    (quote) => !quote.includes("\r") && !quote.includes("\n"),
    "Цитата должна быть однострочной",
  )
  .trim();
const authoritativeEvidenceQuoteSchema = z.string().trim();
const evidenceFor = <SourceField extends EvidenceSourceField>(
  sourceField: SourceField,
  quoteSchema: z.ZodString,
) => z.object({ sourceField: z.literal(sourceField), quote: quoteSchema }).strict();
const descriptionEvidenceSchema = evidenceFor(
  "description",
  oneLineEvidenceQuoteSchema.min(10).max(300),
);
const desiredActionsEvidenceSchema = evidenceFor(
  "desiredActions",
  authoritativeEvidenceQuoteSchema.min(1).max(generateRequestLimits.desiredActions.max),
);
const locationEvidenceSchema = evidenceFor(
  "location",
  authoritativeEvidenceQuoteSchema.min(1).max(generateRequestLimits.location.max),
);
const titleEvidenceSchema = descriptionEvidenceSchema.refine(
  ({ quote }) => quote.length <= generateRequestLimits.result.titleMax,
  "Цитата заголовка превышает лимит",
);
const resolutionSchema = z.discriminatedUnion("intent", [
  z
    .object({
      intent: z.literal("install_observed_missing_element"),
      evidence: descriptionEvidenceSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("restore_observed_state"),
      evidence: descriptionEvidenceSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("establish_and_remove_cause"),
      evidence: descriptionEvidenceSchema,
    })
    .strict(),
  z
    .object({
      intent: z.literal("perform_requested_action"),
      evidence: desiredActionsEvidenceSchema,
    })
    .strict(),
]);
const inferredImpactSchema = z
  .object({
    intent: z.literal("possible_use_impediment"),
    evidence: descriptionEvidenceSchema,
  })
  .strict();
const resultCheckSchema = z
  .object({
    intent: z.literal("confirm_problem_resolved"),
    evidence: descriptionEvidenceSchema,
  })
  .strict();
const locationWarningSchema = z
  .object({
    intent: z.literal("check_location"),
    descriptionEvidence: descriptionEvidenceSchema,
    locationEvidence: locationEvidenceSchema,
  })
  .strict();
const generatedDecisionSchema = z
  .object({
    outcome: z.literal("generated"),
    titleEvidence: titleEvidenceSchema,
    problemEvidence: z.array(descriptionEvidenceSchema).min(1).max(3),
    inferredImpact: inferredImpactSchema.nullable(),
    resolution: resolutionSchema,
    resultCheck: resultCheckSchema.nullable(),
    locationWarning: locationWarningSchema.nullable(),
    subject: primaryRequestSubjectSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    const problemQuotes = decision.problemEvidence.map(({ quote }) => quote);
    if (new Set(problemQuotes).size !== problemQuotes.length) {
      context.addIssue({
        code: "custom",
        path: ["problemEvidence"],
        message: "Цитаты повторяются",
      });
    }
    if (!problemQuotes.includes(decision.titleEvidence.quote)) {
      context.addIssue({
        code: "custom",
        path: ["titleEvidence"],
        message: "Заголовок не входит в проблему",
      });
    }
  });

export const decisionSchema = z.discriminatedUnion("outcome", [
  generatedDecisionSchema,
  z.object({ outcome: z.literal("multiple_issues") }).strict(),
]);
type Decision = z.infer<typeof decisionSchema>;
type GeneratedDecision = Extract<Decision, { outcome: "generated" }>;
type RoleEvidence = z.infer<
  | typeof descriptionEvidenceSchema
  | typeof desiredActionsEvidenceSchema
  | typeof locationEvidenceSchema
>;

export class ProofRejectionError extends Error {
  override name = "ProofRejectionError";
}

function reject(message: string): never {
  throw new ProofRejectionError(message);
}

function sourceText(input: GenerateRequestInput, sourceField: EvidenceSourceField): string {
  const value = input[sourceField]?.trim();
  return value === undefined ? reject(`Отсутствует поле ${sourceField}`) : value;
}

function normalizeAuthoritativeText(value: string): string {
  return value.replaceAll("\r\n", " ").replaceAll("\r", " ").replaceAll("\n", " ").trim();
}

function validateEvidence(input: GenerateRequestInput, evidence: RoleEvidence): void {
  if (!sourceText(input, evidence.sourceField).includes(evidence.quote)) {
    reject(`Evidence не найдено в ${evidence.sourceField}`);
  }
}

function validateDecision(input: GenerateRequestInput, decision: GeneratedDecision): void {
  validateEvidence(input, decision.titleEvidence);
  for (const evidence of decision.problemEvidence) validateEvidence(input, evidence);
  if (decision.inferredImpact !== null) validateEvidence(input, decision.inferredImpact.evidence);
  validateEvidence(input, decision.resolution.evidence);
  if (decision.resultCheck !== null) validateEvidence(input, decision.resultCheck.evidence);
  const keepsCompleteDescription = decision.problemEvidence.some(
    ({ quote }) => quote === input.description.trim(),
  );
  if (
    input.location !== undefined &&
    !keepsCompleteDescription &&
    decision.locationWarning === null
  ) {
    reject("Сокращённое описание с location требует warning");
  }
  if (decision.locationWarning !== null) {
    validateEvidence(input, decision.locationWarning.descriptionEvidence);
    validateEvidence(input, decision.locationWarning.locationEvidence);
    if (sourceText(input, "location") !== decision.locationWarning.locationEvidence.quote) {
      reject("Location evidence должно быть полным");
    }
  }
  if (
    decision.resolution.intent === "perform_requested_action" &&
    sourceText(input, "desiredActions") !== decision.resolution.evidence.quote
  ) {
    reject("Desired actions evidence должно быть полным");
  }
  if (input.consequences !== undefined && decision.inferredImpact !== null) {
    reject("Явные последствия исключают inferred impact");
  }
  if (decision.subject !== null) {
    const selection = evaluateSpecificLegalBasisSelection(decision.subject, input);
    if (selection.status !== "applied") reject("Subject не подтверждён входом");
  }
}

function assertNever(_value: never): never {
  return reject("Неподдерживаемый resolution intent");
}

function materializeResolution(resolution: GeneratedDecision["resolution"]) {
  switch (resolution.intent) {
    case "install_observed_missing_element":
      return { preliminaryCheck: null, remedyActions: [FIXED_TEXT.install] };
    case "restore_observed_state":
      return { preliminaryCheck: null, remedyActions: [FIXED_TEXT.restore] };
    case "establish_and_remove_cause":
      return { preliminaryCheck: FIXED_TEXT.establish, remedyActions: [FIXED_TEXT.removeCause] };
    case "perform_requested_action":
      return {
        preliminaryCheck: null,
        remedyActions: [normalizeAuthoritativeText(resolution.evidence.quote)],
      };
    default:
      return assertNever(resolution);
  }
}

function parseGeneratedDecision(candidate: unknown): GeneratedDecision {
  const parsed = decisionSchema.safeParse(candidate);
  if (!parsed.success) return reject("Решение не соответствует закрытой схеме");
  if (parsed.data.outcome === "multiple_issues")
    return reject("Нельзя материализовать несколько проблем");
  return parsed.data;
}

export function materializeDecision(
  input: GenerateRequestInput,
  candidate: unknown,
): PrimaryRequestDraft {
  const decision = parseGeneratedDecision(candidate);
  validateDecision(input, decision);
  const location =
    input.location === undefined ? undefined : normalizeAuthoritativeText(input.location);
  const locationSuffix =
    location === undefined || location.length === 0 ? "" : ` Место: ${location}`;
  const usesSafeLocationFallback = decision.locationWarning !== null;
  const resolution = materializeResolution(decision.resolution);
  const draft = primaryRequestDraftSchema.safeParse({
    title: usesSafeLocationFallback ? FIXED_TEXT.locationTitle : decision.titleEvidence.quote,
    problem: usesSafeLocationFallback
      ? `${FIXED_TEXT.locationProblem}.${locationSuffix}`
      : `${decision.problemEvidence.map(({ quote }) => quote).join(" ")}${locationSuffix}`,
    circumstances: null,
    impact:
      input.consequences?.trim() ?? (decision.inferredImpact === null ? null : FIXED_TEXT.impact),
    verification: null,
    subject: decision.subject,
    actionPlan: {
      ...resolution,
      resultCheck: decision.resultCheck === null ? null : FIXED_TEXT.resultCheck,
    },
    warnings:
      decision.locationWarning === null
        ? []
        : [
            `${FIXED_TEXT.locationWarning}: ${normalizeAuthoritativeText(
              sourceText(input, "location"),
            )}`,
          ],
  });
  return draft.success ? draft.data : reject("Материализованный draft не прошёл схему");
}
