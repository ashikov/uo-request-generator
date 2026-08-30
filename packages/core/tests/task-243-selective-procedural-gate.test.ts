import { describe, expect, it } from "vitest";
import type { GenerateRequestInput } from "../src/contracts.js";
import type { PrimaryRequestDraft } from "../src/primary-request-draft.js";
import { renderPrimaryRequestDraft } from "../src/primary-request-draft.js";
import { scenarios } from "./fixtures.js";
import {
  materializeSelectiveDraft,
  selectiveProviderDraftSchema,
} from "./task-243-selective-procedural-gate-proof.js";

const REQUIRED_SCENARIO_IDS = [
  "only-description",
  "wording-normalization",
  "minimum-sufficient-requests",
  "simple-defect",
  "location-preservation",
  "conflicting-location",
  "impact-subject-objective",
  "impact-subject-explicit-group",
  "unconfirmed-remedy-lighting",
  "unconfirmed-remedy-door",
  "confirmed-remedy-door-handle",
  "unknown-remedy-lighting",
  "unknown-remedy-functional-defect",
  "lighting-elevator-cabin",
  "elevator-position-indicator",
] as const;

type RequiredScenarioId = (typeof REQUIRED_SCENARIO_IDS)[number];

const descriptionEvidence = (quote: string) => ({ sourceField: "description", quote }) as const;
const desiredActionsEvidence = (quote: string) =>
  ({ sourceField: "desiredActions", quote }) as const;

function required<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined) throw new TypeError(`Нет обязательного значения ${name}`);
  return value;
}

function inputFor(id: RequiredScenarioId): GenerateRequestInput {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined || scenario.expectedOutcome !== "generated") {
    throw new TypeError(`Нет generated-сценария ${id}`);
  }
  return scenario.input;
}

function establishUnknownCause(quote: string) {
  return {
    intent: "establish_unknown_cause",
    evidence: descriptionEvidence(quote),
  } as const;
}

function resolveObservedProblem(quote: string) {
  return {
    intent: "resolve_observed_problem",
    evidence: descriptionEvidence(quote),
  } as const;
}

function installObservedMissingElement(observationQuote: string, targetQuote: string) {
  return {
    intent: "install_observed_missing_element",
    observationEvidence: descriptionEvidence(observationQuote),
    targetEvidence: descriptionEvidence(targetQuote),
  } as const;
}

function performExplicitDesiredActions(desiredActions: string) {
  return {
    intent: "perform_explicit_desired_actions",
    evidence: desiredActionsEvidence(desiredActions),
  } as const;
}

function confirmProblemResolved(quote: string) {
  return {
    intent: "confirm_problem_resolved",
    evidence: descriptionEvidence(quote),
  } as const;
}

function actionPlanDecision(
  remedy:
    | ReturnType<typeof resolveObservedProblem>
    | ReturnType<typeof installObservedMissingElement>
    | ReturnType<typeof performExplicitDesiredActions>,
  preliminaryCheck: ReturnType<typeof establishUnknownCause> | null = null,
  resultCheck: ReturnType<typeof confirmProblemResolved> | null = null,
) {
  return { preliminaryCheck, remedy, resultCheck } as const;
}

function materializedPlan(
  remedy: string,
  preliminaryCheck: string | null = null,
  resultCheck: string | null = null,
) {
  return { preliminaryCheck, remedyActions: [remedy], resultCheck };
}

function expectedCause(quote: string): string {
  return `Установить причину наблюдаемой проблемы: «${quote}»`;
}

function expectedResolution(quote: string): string {
  return `Устранить наблюдаемую проблему: «${quote}»`;
}

function expectedInstallation(target: string): string {
  return `Установить отсутствующий элемент, указанный пользователем: «${target}»`;
}

function expectedResultCheck(quote: string): string {
  return `После работ проверить устранение наблюдаемой проблемы: «${quote}»`;
}

function subjectFor(
  kind: "common_area_entrance_door" | "common_area_premises_lighting" | "common_area_elevator",
  quote: string,
) {
  return { kind, evidence: [descriptionEvidence(quote)] } as const;
}

type ScenarioProof = {
  id: RequiredScenarioId;
  actionPlanDecision: ReturnType<typeof actionPlanDecision>;
  expectedActionPlan: PrimaryRequestDraft["actionPlan"];
  subject?: ReturnType<typeof subjectFor>;
  warnings?: readonly string[];
};

function fullDescription(id: RequiredScenarioId): string {
  return inputFor(id).description;
}

function explicitAction(id: RequiredScenarioId): string {
  return required(inputFor(id).desiredActions, `${id}.desiredActions`);
}

// biome-ignore format: Каждая строка независимо связывает существующий scenario с bounded decision и ожидаемым планом.
const SCENARIO_PROOFS: readonly ScenarioProof[] = [
  { id: "only-description", actionPlanDecision: actionPlanDecision(resolveObservedProblem(fullDescription("only-description")), establishUnknownCause(fullDescription("only-description")), confirmProblemResolved(fullDescription("only-description"))), expectedActionPlan: materializedPlan(expectedResolution(fullDescription("only-description")), expectedCause(fullDescription("only-description")), expectedResultCheck(fullDescription("only-description"))) },
  { id: "wording-normalization", actionPlanDecision: actionPlanDecision(resolveObservedProblem(fullDescription("wording-normalization")), establishUnknownCause(fullDescription("wording-normalization")), confirmProblemResolved(fullDescription("wording-normalization"))), expectedActionPlan: materializedPlan(expectedResolution(fullDescription("wording-normalization")), expectedCause(fullDescription("wording-normalization")), expectedResultCheck(fullDescription("wording-normalization"))), subject: subjectFor("common_area_entrance_door", fullDescription("wording-normalization")) },
  { id: "minimum-sufficient-requests", actionPlanDecision: actionPlanDecision(resolveObservedProblem("С потолка в общем коридоре капает вода."), establishUnknownCause("Источник протечки неизвестен."), confirmProblemResolved("С потолка в общем коридоре капает вода.")), expectedActionPlan: materializedPlan(expectedResolution("С потолка в общем коридоре капает вода."), expectedCause("Источник протечки неизвестен."), expectedResultCheck("С потолка в общем коридоре капает вода.")) },
  { id: "simple-defect", actionPlanDecision: actionPlanDecision(installObservedMissingElement(fullDescription("simple-defect"), "ручка")), expectedActionPlan: materializedPlan(expectedInstallation("ручка")) },
  { id: "location-preservation", actionPlanDecision: actionPlanDecision(resolveObservedProblem(fullDescription("location-preservation")), null, confirmProblemResolved(fullDescription("location-preservation"))), expectedActionPlan: materializedPlan(expectedResolution(fullDescription("location-preservation")), null, expectedResultCheck(fullDescription("location-preservation"))), subject: subjectFor("common_area_entrance_door", fullDescription("location-preservation")) },
  { id: "conflicting-location", actionPlanDecision: actionPlanDecision(resolveObservedProblem("Дверь в помещении общего пользования"), null, confirmProblemResolved("не закрывается полностью.")), expectedActionPlan: materializedPlan(expectedResolution("Дверь в помещении общего пользования"), null, expectedResultCheck("не закрывается полностью.")), subject: subjectFor("common_area_entrance_door", "Дверь в помещении общего пользования"), warnings: ["Проверьте место проблемы перед подачей заявки"] },
  { id: "impact-subject-objective", actionPlanDecision: actionPlanDecision(resolveObservedProblem(fullDescription("impact-subject-objective")), null, confirmProblemResolved(fullDescription("impact-subject-objective"))), expectedActionPlan: materializedPlan(expectedResolution(fullDescription("impact-subject-objective")), null, expectedResultCheck(fullDescription("impact-subject-objective"))) },
  { id: "impact-subject-explicit-group", actionPlanDecision: actionPlanDecision(resolveObservedProblem(fullDescription("impact-subject-explicit-group")), null, confirmProblemResolved(fullDescription("impact-subject-explicit-group"))), expectedActionPlan: materializedPlan(expectedResolution(fullDescription("impact-subject-explicit-group")), null, expectedResultCheck(fullDescription("impact-subject-explicit-group"))) },
  { id: "unconfirmed-remedy-lighting", actionPlanDecision: actionPlanDecision(performExplicitDesiredActions(explicitAction("unconfirmed-remedy-lighting"))), expectedActionPlan: materializedPlan(explicitAction("unconfirmed-remedy-lighting")) },
  { id: "unconfirmed-remedy-door", actionPlanDecision: actionPlanDecision(performExplicitDesiredActions(explicitAction("unconfirmed-remedy-door"))), expectedActionPlan: materializedPlan(explicitAction("unconfirmed-remedy-door")) },
  { id: "confirmed-remedy-door-handle", actionPlanDecision: actionPlanDecision(performExplicitDesiredActions(explicitAction("confirmed-remedy-door-handle"))), expectedActionPlan: materializedPlan(explicitAction("confirmed-remedy-door-handle")) },
  { id: "unknown-remedy-lighting", actionPlanDecision: actionPlanDecision(resolveObservedProblem("Освещение в помещении общего пользования не работает."), establishUnknownCause("Причина неизвестна."), confirmProblemResolved("Освещение в помещении общего пользования не работает.")), expectedActionPlan: materializedPlan(expectedResolution("Освещение в помещении общего пользования не работает."), expectedCause("Причина неизвестна."), expectedResultCheck("Освещение в помещении общего пользования не работает.")) },
  { id: "unknown-remedy-functional-defect", actionPlanDecision: actionPlanDecision(resolveObservedProblem("Вентиляция в помещении общего пользования не работает."), establishUnknownCause("Причина неизвестна."), confirmProblemResolved("Вентиляция в помещении общего пользования не работает.")), expectedActionPlan: materializedPlan(expectedResolution("Вентиляция в помещении общего пользования не работает."), expectedCause("Причина неизвестна."), expectedResultCheck("Вентиляция в помещении общего пользования не работает.")) },
  { id: "lighting-elevator-cabin", actionPlanDecision: actionPlanDecision(performExplicitDesiredActions(explicitAction("lighting-elevator-cabin"))), expectedActionPlan: materializedPlan(explicitAction("lighting-elevator-cabin")), subject: subjectFor("common_area_premises_lighting", fullDescription("lighting-elevator-cabin")) },
  { id: "elevator-position-indicator", actionPlanDecision: actionPlanDecision(performExplicitDesiredActions(explicitAction("elevator-position-indicator"))), expectedActionPlan: materializedPlan(explicitAction("elevator-position-indicator")), subject: subjectFor("common_area_elevator", fullDescription("elevator-position-indicator")) },
];

function candidateFor(proof: ScenarioProof) {
  const input = inputFor(proof.id);
  const location = input.location === undefined ? "" : ` Место: ${input.location}`;
  return {
    outcome: "generated",
    title: `Черновик ${proof.id}`,
    problem: `${input.description}${location}`,
    circumstances: null,
    impact: input.consequences ?? null,
    verificationDecision: null,
    subject: proof.subject ?? null,
    actionPlanDecision: proof.actionPlanDecision,
    warnings: [...(proof.warnings ?? [])],
  } as const;
}

describe("selective procedural gate", () => {
  it("сохраняет stochastic prose variants и материализует одинаковые защищённые роли", () => {
    const input = {
      description:
        "На лестничной площадке не работает освещение. Проблема наблюдается вечером. Причина неизвестна.",
    };
    const protectedDecisions = {
      verificationDecision: {
        intent: "preserve_user_stated_uncertainty",
        evidence: descriptionEvidence("Причина неизвестна."),
      },
      actionPlanDecision: actionPlanDecision(
        resolveObservedProblem("На лестничной площадке не работает освещение."),
        null,
        confirmProblemResolved("На лестничной площадке не работает освещение."),
      ),
    } as const;
    const first = {
      outcome: "generated",
      title: "Не работает освещение на лестничной площадке",
      problem: "На лестничной площадке отсутствует рабочее освещение.",
      circumstances: "Проблема наблюдается в вечернее время.",
      impact: "Вечером видимость на лестничной площадке ограничена.",
      ...protectedDecisions,
      subject: null,
      warnings: [],
    } as const;
    const second = {
      ...first,
      title: "Отсутствует освещение на лестничной площадке",
      problem: "Освещение на лестничной площадке не функционирует.",
      circumstances: "Неработающее освещение наблюдается вечером.",
      impact: "Недостаточное освещение ухудшает видимость в вечернее время.",
    } as const;

    const firstDraft = materializeSelectiveDraft(input, first);
    const secondDraft = materializeSelectiveDraft(input, second);

    for (const [candidate, draft] of [
      [first, firstDraft],
      [second, secondDraft],
    ] as const) {
      expect(draft).toMatchObject({
        title: candidate.title,
        problem: candidate.problem,
        circumstances: candidate.circumstances,
        impact: candidate.impact,
        subject: candidate.subject,
        warnings: candidate.warnings,
      });
    }
    expect(firstDraft.title).not.toBe(secondDraft.title);
    expect(firstDraft.problem).not.toBe(secondDraft.problem);
    expect(firstDraft.circumstances).not.toBe(secondDraft.circumstances);
    expect(firstDraft.impact).not.toBe(secondDraft.impact);
    expect(firstDraft.verification).toBe(secondDraft.verification);
    expect(firstDraft.actionPlan).toEqual(secondDraft.actionPlan);
  });

  it.each(SCENARIO_PROOFS)("сопоставляет $id с selective boundary", (proof) => {
    const input = inputFor(proof.id);
    const candidate = candidateFor(proof);
    const draft = materializeSelectiveDraft(input, candidate);

    expect(draft.actionPlan).toEqual(proof.expectedActionPlan);
    expect(draft.title).toBe(candidate.title);
    expect(draft.problem).toBe(candidate.problem);
    expect(draft.impact).toBe(candidate.impact);
    expect(draft.warnings).toEqual(candidate.warnings);
    expect(renderPrimaryRequestDraft(draft, input).body).toContain("Прошу:");
  });

  it("сохраняет simple-defect конкретным без предметного symptom-to-remedy mapping", () => {
    const proof = required(
      SCENARIO_PROOFS.find(({ id }) => id === "simple-defect"),
      "simple-defect proof",
    );
    const draft = materializeSelectiveDraft(inputFor(proof.id), candidateFor(proof));

    expect(draft.actionPlan).toEqual({
      preliminaryCheck: null,
      remedyActions: [expectedInstallation("ручка")],
      resultCheck: null,
    });
    expect(draft.actionPlan.remedyActions[0]).toContain("ручка");
    expect(draft.actionPlan.remedyActions[0]).not.toBe("Восстановить наблюдаемое состояние");
  });

  it("оставляет semantic relevance install decision за live gate", () => {
    const input = {
      description: "Петли входной двери исправны, ручка отсутствует.",
    };
    const candidate = {
      outcome: "generated",
      title: "На входной двери отсутствует ручка",
      problem: input.description,
      circumstances: null,
      impact: null,
      verificationDecision: null,
      subject: null,
      actionPlanDecision: actionPlanDecision(
        installObservedMissingElement(input.description, "Петли"),
      ),
      warnings: [],
    } as const;

    const draft = materializeSelectiveDraft(input, candidate);

    expect(draft.actionPlan.remedyActions).toEqual([expectedInstallation("Петли")]);
  });

  it("сохраняет полный authoritative desiredActions и нормализует только переводы строк", () => {
    const desiredActions = "Проверить причину\r\nи восстановить работу освещения.";
    const input = {
      description: "В общем коридоре не работает освещение.",
      desiredActions,
    };
    const candidate = {
      outcome: "generated",
      title: "Не работает освещение",
      problem: "В общем коридоре отсутствует освещение.",
      circumstances: null,
      impact: null,
      verificationDecision: null,
      subject: null,
      actionPlanDecision: actionPlanDecision(performExplicitDesiredActions(desiredActions)),
      warnings: [],
    } as const;

    expect(materializeSelectiveDraft(input, candidate).actionPlan).toEqual({
      preliminaryCheck: null,
      remedyActions: ["Проверить причину и восстановить работу освещения."],
      resultCheck: null,
    });
  });

  it("не изменяет desiredActions при отдельных bounded проверках", () => {
    const input = {
      description: "Освещение в общем коридоре не работает. Причина неизвестна.",
      desiredActions: "Восстановить работу освещения.",
    };
    const candidate = {
      outcome: "generated",
      title: "Не работает освещение в общем коридоре",
      problem: "В общем коридоре отсутствует рабочее освещение.",
      circumstances: null,
      impact: null,
      verificationDecision: null,
      subject: null,
      actionPlanDecision: actionPlanDecision(
        performExplicitDesiredActions(input.desiredActions),
        establishUnknownCause("Причина неизвестна."),
        confirmProblemResolved("Освещение в общем коридоре не работает."),
      ),
      warnings: [],
    } as const;

    expect(materializeSelectiveDraft(input, candidate).actionPlan).toEqual(
      materializedPlan(
        input.desiredActions,
        expectedCause("Причина неизвестна."),
        expectedResultCheck("Освещение в общем коридоре не работает."),
      ),
    );
  });

  it("материализует verification только из exact user uncertainty", () => {
    const quote = "Пользователь предполагает неисправность доводчика.";
    const input = { description: `Дверь не закрывается полностью. ${quote}` };
    const candidate = {
      outcome: "generated",
      title: "Дверь не закрывается полностью",
      problem: "Дверь не закрывается полностью.",
      circumstances: null,
      impact: null,
      verificationDecision: {
        intent: "preserve_user_stated_uncertainty",
        evidence: descriptionEvidence(quote),
      },
      subject: null,
      actionPlanDecision: actionPlanDecision(
        resolveObservedProblem("Дверь не закрывается полностью."),
      ),
      warnings: [],
    } as const;

    expect(materializeSelectiveDraft(input, candidate).verification).toBe(
      `Требует проверки указанное пользователем обстоятельство: «${quote}»`,
    );
  });

  it("явно оставляет invention в generative prose semantic, а не structural риском", () => {
    const input = { description: "На лестничной площадке не работает освещение." };
    const candidate = {
      outcome: "generated",
      title: "Не работает освещение",
      problem: "Предполагаемая неисправность выключателя.",
      circumstances: null,
      impact: "Возможно повреждение светильника.",
      verificationDecision: null,
      subject: null,
      actionPlanDecision: actionPlanDecision(resolveObservedProblem(input.description)),
      warnings: ["Проверьте техническое состояние оборудования"],
    } as const;

    expect(selectiveProviderDraftSchema.safeParse(candidate).success).toBe(true);
    const draft = materializeSelectiveDraft(input, candidate);
    expect(draft.problem).toBe(candidate.problem);
    expect(draft.impact).toBe(candidate.impact);
    expect(draft.warnings).toEqual(candidate.warnings);
  });
});
