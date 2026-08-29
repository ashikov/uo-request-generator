import { describe, expect, it } from "vitest";
import { type GenerateRequestInput, generateRequestInputSchema } from "../src/contracts.js";
import {
  type PrimaryRequestDraft,
  primaryRequestDraftSchema,
  renderPrimaryRequestDraft,
} from "../src/primary-request-draft.js";
import { scenarios } from "./fixtures.js";
import {
  decisionSchema,
  FIXED_TEXT,
  materializeDecision,
} from "./task-241-deterministic-evidence-gate-proof.js";

const ID = {
  only: "only-description",
  descriptionLocation: "description-location",
  consequences: "consequences",
  desiredActions: "desired-actions",
  allFields: "all-fields",
  emotional: "emotional",
  wording: "wording-normalization",
  minimum: "minimum-sufficient-requests",
  locationDeduplication: "location-action-deduplication",
  simple: "simple-defect",
  locationPreservation: "location-preservation",
  unknownLighting: "unknown-remedy-lighting",
  conflict: "conflicting-location",
  explicitGroup: "impact-subject-explicit-group",
} as const;
const INTENT = {
  restore: "restore_observed_state",
  cause: "establish_and_remove_cause",
  requested: "perform_requested_action",
} as const;
const EXPECTED_TEXT = {
  impact: "Проблема может затруднять пользование общим имуществом",
  restore: "Восстановить наблюдаемое состояние",
  establish: "Установить причину наблюдаемой проблемы",
  removeCause: "Устранить установленную причину наблюдаемой проблемы",
  resultCheck: "Проверить устранение наблюдаемой проблемы",
  locationTitle: "Проблема по указанному месту",
  locationProblem: "Наблюдаемая проблема",
  locationWarning: "Проверьте указанное место проблемы",
} as const;
type TargetId = (typeof ID)[keyof typeof ID];
type ProofSpec = {
  readonly id: TargetId;
  readonly intent: (typeof INTENT)[keyof typeof INTENT];
  readonly inferredImpact?: true;
  readonly resultCheck?: true;
  readonly locationWarning?: true;
  readonly problemQuotes?: readonly string[];
  readonly resolutionQuote?: string;
};

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new TypeError(`Нет обязательного значения ${name}`);
  return value;
}

function inputFor(id: TargetId): GenerateRequestInput {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined || scenario.expectedOutcome !== "generated") {
    throw new TypeError(`Нет generated-сценария ${id}`);
  }
  return scenario.input;
}

const descriptionEvidence = (quote: string) => ({ sourceField: "description", quote }) as const;

function assertNever(_value: never): never {
  throw new TypeError("Неподдерживаемый fixture intent");
}

function resolutionFor(intent: ProofSpec["intent"], input: GenerateRequestInput, quote: string) {
  switch (intent) {
    case INTENT.restore:
    case INTENT.cause:
      return { intent, evidence: descriptionEvidence(quote) } as const;
    case INTENT.requested:
      return {
        intent,
        evidence: {
          sourceField: "desiredActions",
          quote: required(input.desiredActions, "desiredActions"),
        },
      } as const;
    default:
      return assertNever(intent);
  }
}

function proofCase(spec: ProofSpec) {
  const input = inputFor(spec.id);
  const quotes = spec.problemQuotes ?? [input.description];
  const title = required(quotes[0], `${spec.id}.title`);
  const location = spec.locationWarning ? required(input.location, spec.id) : null;
  return {
    id: spec.id,
    input,
    decision: {
      outcome: "generated",
      titleEvidence: descriptionEvidence(title),
      problemEvidence: quotes.map(descriptionEvidence),
      inferredImpact: spec.inferredImpact
        ? { intent: "possible_use_impediment", evidence: descriptionEvidence(title) }
        : null,
      resolution: resolutionFor(spec.intent, input, spec.resolutionQuote ?? title),
      resultCheck: spec.resultCheck
        ? { intent: "confirm_problem_resolved", evidence: descriptionEvidence(title) }
        : null,
      locationWarning:
        location === null
          ? null
          : {
              intent: "check_location",
              descriptionEvidence: descriptionEvidence(input.description),
              locationEvidence: { sourceField: "location", quote: location },
            },
      subject:
        input.confirmedProblemSubject === "common_area_entrance_door"
          ? { kind: input.confirmedProblemSubject, evidence: [descriptionEvidence(title)] }
          : null,
    },
  } as const;
}

function plan(preliminaryCheck: string | null, remedy: string, resultCheck: string | null) {
  return { preliminaryCheck, remedyActions: [remedy], resultCheck };
}

// biome-ignore format: Фиксированные планы легче сравнивать построчно.
const PLAN = {
  restore: plan(null, EXPECTED_TEXT.restore, null),
  cause: plan(EXPECTED_TEXT.establish, EXPECTED_TEXT.removeCause, null),
  causeCheck: plan(EXPECTED_TEXT.establish, EXPECTED_TEXT.removeCause, EXPECTED_TEXT.resultCheck),
  desired: plan(null, "Прошу заменить повреждённый участок трубы и проверить герметичность соединений.", null),
  allFields: plan(null, "Прошу провести осмотр, откачать воду, установить и устранить причину скопления воды и обработать помещение от плесени.", null),
} as const;
type DraftOverrides = Partial<Omit<PrimaryRequestDraft, "actionPlan">>;
type ActionPlan = PrimaryRequestDraft["actionPlan"];

function expectedDraft(id: TargetId, actionPlan: ActionPlan, overrides: DraftOverrides = {}) {
  const input = inputFor(id);
  const title = overrides.title ?? input.description;
  return {
    title,
    problem: `${input.description}${input.location === undefined ? "" : ` Место: ${input.location}`}`,
    circumstances: null,
    impact: null,
    verification: null,
    subject:
      input.confirmedProblemSubject === "common_area_entrance_door"
        ? { kind: input.confirmedProblemSubject, evidence: [descriptionEvidence(title)] }
        : null,
    actionPlan,
    warnings: [],
    ...overrides,
  };
}

function acceptanceCase(spec: ProofSpec, expected: PrimaryRequestDraft) {
  return { ...proofCase(spec), expected } as const;
}

// biome-ignore format: Каждая строка связывает решение с независимо заданным полным draft.
const PROOF_CASES = [
  acceptanceCase({ id: ID.only, intent: INTENT.cause, inferredImpact: true, resultCheck: true }, expectedDraft(ID.only, PLAN.causeCheck, { impact: EXPECTED_TEXT.impact })),
  acceptanceCase({ id: ID.descriptionLocation, intent: INTENT.restore }, expectedDraft(ID.descriptionLocation, PLAN.restore)),
  acceptanceCase({ id: ID.consequences, intent: INTENT.restore }, expectedDraft(ID.consequences, PLAN.restore, { impact: "Существует риск утраты имущества из помещения." })),
  acceptanceCase({ id: ID.desiredActions, intent: INTENT.requested }, expectedDraft(ID.desiredActions, PLAN.desired)),
  acceptanceCase({ id: ID.allFields, intent: INTENT.requested }, expectedDraft(ID.allFields, PLAN.allFields, { impact: "Затопление подвала, риск появления плесени и грибка, повреждение хранящихся вещей." })),
  acceptanceCase({ id: ID.emotional, intent: INTENT.cause, problemQuotes: ["Третью неделю лифт не работает!", "Соседка на восьмом этаже еле ходит, а мы с коляской как альпинисты."] }, expectedDraft(ID.emotional, PLAN.cause, { title: "Третью неделю лифт не работает!", problem: "Третью неделю лифт не работает! Соседка на восьмом этаже еле ходит, а мы с коляской как альпинисты." })),
  acceptanceCase({ id: ID.wording, intent: INTENT.cause, resultCheck: true }, expectedDraft(ID.wording, PLAN.causeCheck)),
  acceptanceCase({ id: ID.minimum, intent: INTENT.cause, resultCheck: true, resolutionQuote: "Источник протечки неизвестен." }, expectedDraft(ID.minimum, PLAN.causeCheck)),
  acceptanceCase({ id: ID.locationDeduplication, intent: INTENT.cause, resultCheck: true, resolutionQuote: "Источник протечки неизвестен." }, expectedDraft(ID.locationDeduplication, PLAN.causeCheck)),
  acceptanceCase({ id: ID.simple, intent: INTENT.restore }, expectedDraft(ID.simple, PLAN.restore)),
  acceptanceCase({ id: ID.locationPreservation, intent: INTENT.restore }, expectedDraft(ID.locationPreservation, PLAN.restore)),
  acceptanceCase({ id: ID.unknownLighting, intent: INTENT.cause, resultCheck: true, resolutionQuote: "Причина неизвестна." }, expectedDraft(ID.unknownLighting, PLAN.causeCheck)),
  acceptanceCase({ id: ID.conflict, intent: INTENT.restore, locationWarning: true, problemQuotes: ["Дверь в помещении общего пользования", "не закрывается полностью."] }, expectedDraft(ID.conflict, PLAN.restore, { title: EXPECTED_TEXT.locationTitle, problem: `${EXPECTED_TEXT.locationProblem}. Место: подъезд 3, этаж 4`, subject: { kind: "common_area_entrance_door", evidence: [descriptionEvidence("Дверь в помещении общего пользования")] }, warnings: [`${EXPECTED_TEXT.locationWarning}: подъезд 3, этаж 4`] })),
  acceptanceCase({ id: ID.explicitGroup, intent: INTENT.restore }, expectedDraft(ID.explicitGroup, PLAN.restore, { impact: "Пожилым жильцам трудно открыть дверь." })),
] as const;

describe("решение детерминированного evidence gate", () => {
  it("сохраняет утверждённые фиксированные формулировки", () => {
    expect(FIXED_TEXT).toEqual(EXPECTED_TEXT);
  });

  it("принимает generated и multiple_issues", () => {
    const accepted: unknown[] = PROOF_CASES.map(({ decision }) => decision);
    accepted.push({ outcome: "multiple_issues" });
    for (const candidate of accepted) {
      const parsed = decisionSchema.safeParse(candidate);
      const message = parsed.success ? undefined : parsed.error.issues[0]?.message;
      expect.soft(parsed.success, message).toBe(true);
    }
  });

  it("сохраняет полный допустимый диапазон authoritative evidence", () => {
    const requestedProof = proofCase({ id: ID.desiredActions, intent: INTENT.requested });
    for (const desiredActions of ["А", "А".repeat(500)]) {
      const input = { ...requestedProof.input, desiredActions };
      const decision = {
        ...requestedProof.decision,
        resolution: {
          intent: INTENT.requested,
          evidence: { sourceField: "desiredActions", quote: desiredActions },
        },
      } as const;
      expect(materializeDecision(input, decision).actionPlan.remedyActions).toEqual([
        desiredActions,
      ]);
    }
    const multilineDesiredActions = "Проверить\nустранить";
    const multilineRequestedInput = {
      ...requestedProof.input,
      desiredActions: multilineDesiredActions,
    };
    const multilineRequestedDecision = {
      ...requestedProof.decision,
      resolution: {
        intent: INTENT.requested,
        evidence: { sourceField: "desiredActions", quote: multilineDesiredActions },
      },
    } as const;
    expect(
      materializeDecision(multilineRequestedInput, multilineRequestedDecision).actionPlan
        .remedyActions,
    ).toEqual(["Проверить устранить"]);

    const locationProof = proofCase({
      id: ID.conflict,
      intent: INTENT.restore,
      locationWarning: true,
    });
    for (const location of ["А", "А".repeat(120)]) {
      const input = { ...locationProof.input, location };
      const decision = {
        ...locationProof.decision,
        locationWarning: {
          ...locationProof.decision.locationWarning,
          locationEvidence: { sourceField: "location", quote: location },
        },
      } as const;
      expect(materializeDecision(input, decision).warnings).toEqual([
        `${EXPECTED_TEXT.locationWarning}: ${location}`,
      ]);
    }
    const multilineLocation = "подъезд 3\nэтаж 4";
    const multilineLocationInput = { ...locationProof.input, location: multilineLocation };
    const multilineLocationDecision = {
      ...locationProof.decision,
      locationWarning: {
        ...locationProof.decision.locationWarning,
        locationEvidence: { sourceField: "location", quote: multilineLocation },
      },
    } as const;
    expect(materializeDecision(multilineLocationInput, multilineLocationDecision).warnings).toEqual(
      [`${EXPECTED_TEXT.locationWarning}: подъезд 3 этаж 4`],
    );
  });
});

describe("детерминированная materialization", () => {
  it.each(PROOF_CASES)("материализует $id через неизменный renderer", (proof) => {
    const draft = materializeDecision(proof.input, proof.decision);
    const repeatedDraft = materializeDecision(proof.input, proof.decision);
    expect(draft).toEqual(proof.expected);
    expect(repeatedDraft).toEqual(draft);
    const rendered = renderPrimaryRequestDraft(draft, proof.input);
    expect(rendered).toEqual(renderPrimaryRequestDraft(proof.expected, proof.input));
    if (proof.id === ID.explicitGroup) expect(rendered.body).not.toContain("всех жильцов");
  });

  it("при check_location не переносит конфликтующее место даже из полного exact evidence", () => {
    const proof = proofCase({ id: ID.conflict, intent: INTENT.restore, locationWarning: true });
    const fullDescriptionEvidence = descriptionEvidence(proof.input.description);
    const decision = {
      ...proof.decision,
      titleEvidence: fullDescriptionEvidence,
      problemEvidence: [fullDescriptionEvidence],
    } as const;
    const draft = materializeDecision(proof.input, decision);
    expect(draft.title).toBe(EXPECTED_TEXT.locationTitle);
    expect(draft.problem).toBe(`${EXPECTED_TEXT.locationProblem}. Место: подъезд 3, этаж 4`);
    expect(draft.problem).not.toContain("втором подъезде");
  });

  it("фиксирует допустимость semantic conflict в schema без check_location", () => {
    const proof = proofCase({ id: ID.conflict, intent: INTENT.restore });
    const parsed = decisionSchema.safeParse(proof.decision);

    expect(parsed.success).toBe(true);

    const draft = materializeDecision(proof.input, proof.decision);
    expect(draft.problem).toContain("втором подъезде");
    expect(draft.problem).toContain("Место: подъезд 3, этаж 4");
    expect(draft.warnings).toEqual([]);
  });

  it.each([
    {
      name: "описание длиннее evidence quote",
      description: `На лестничной площадке не работает освещение. ${"Дополнительное наблюдение. ".repeat(12)}`,
      quote: "На лестничной площадке не работает освещение.",
    },
    {
      name: "многострочное описание",
      description: "На лестничной площадке не работает освещение.\nПроблема наблюдается вечером.",
      quote: "На лестничной площадке не работает освещение.",
    },
  ])("не создаёт location conflict: $name", ({ description, quote }) => {
    const input = generateRequestInputSchema.parse({
      description,
      location: "подъезд 2, этаж 3",
    });
    const evidence = descriptionEvidence(quote);
    const decision = {
      outcome: "generated",
      titleEvidence: evidence,
      problemEvidence: [evidence],
      inferredImpact: null,
      resolution: { intent: INTENT.restore, evidence },
      resultCheck: null,
      locationWarning: null,
      subject: null,
    } as const;

    const draft = materializeDecision(input, decision);

    expect(draft.problem).toBe(`${quote} Место: подъезд 2, этаж 3`);
    expect(draft.warnings).toEqual([]);
  });

  it("нормализует переводы строк в authoritative consequences", () => {
    const consequences =
      "Пожилым жильцам\r\nтрудно открыть дверь.\rЖильцы\nждут устранения проблемы.";
    const input = generateRequestInputSchema.parse({
      ...inputFor(ID.explicitGroup),
      consequences,
    });
    const proof = proofCase({ id: ID.explicitGroup, intent: INTENT.restore });

    const draft = materializeDecision(input, proof.decision);

    expect(draft.impact).toBe(
      "Пожилым жильцам трудно открыть дверь. Жильцы ждут устранения проблемы.",
    );
    expect(draft.impact).not.toContain("всех жильцов");
    expect(primaryRequestDraftSchema.safeParse(draft).success).toBe(true);
  });
});
