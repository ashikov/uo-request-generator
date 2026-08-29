import { describe, expect, it } from "vitest";
import { type GenerateRequestInput, generateRequestLimits } from "../src/contracts.js";
import { scenarios } from "./fixtures.js";
import {
  decisionSchema,
  materializeDecision,
  ProofRejectionError,
} from "./task-241-deterministic-evidence-gate-proof.js";

const ID = {
  only: "only-description",
  desiredActions: "desired-actions",
  consequences: "consequences",
  conflict: "conflicting-location",
} as const;
type TargetId = (typeof ID)[keyof typeof ID];

function inputFor(id: TargetId): GenerateRequestInput {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined || scenario.expectedOutcome !== "generated") {
    throw new TypeError(`Нет generated-сценария ${id}`);
  }
  return scenario.input;
}

const descriptionEvidence = (quote: string) => ({ sourceField: "description", quote }) as const;
const BASE_INPUT = inputFor(ID.only);
const BASE = {
  outcome: "generated",
  titleEvidence: descriptionEvidence(BASE_INPUT.description),
  problemEvidence: [descriptionEvidence(BASE_INPUT.description)],
  inferredImpact: null,
  resolution: {
    intent: "restore_observed_state",
    evidence: descriptionEvidence(BASE_INPUT.description),
  },
  resultCheck: null,
  locationWarning: null,
  subject: null,
} as const;

function decisionWithQuote(quote: string) {
  const evidence = descriptionEvidence(quote);
  return {
    ...BASE,
    titleEvidence: evidence,
    problemEvidence: [evidence],
    resolution: { ...BASE.resolution, evidence },
  } as const;
}

const REQUESTED_INPUT = inputFor(ID.desiredActions);
const REQUESTED = {
  ...BASE,
  titleEvidence: descriptionEvidence(REQUESTED_INPUT.description),
  problemEvidence: [descriptionEvidence(REQUESTED_INPUT.description)],
  resolution: {
    intent: "perform_requested_action",
    evidence: {
      sourceField: "desiredActions",
      quote: REQUESTED_INPUT.desiredActions,
    },
  },
} as const;
const CONSEQUENCES_INPUT = inputFor(ID.consequences);
const CONSEQUENCES = {
  ...BASE,
  titleEvidence: descriptionEvidence(CONSEQUENCES_INPUT.description),
  problemEvidence: [descriptionEvidence(CONSEQUENCES_INPUT.description)],
  resolution: {
    intent: "restore_observed_state",
    evidence: descriptionEvidence(CONSEQUENCES_INPUT.description),
  },
  subject: {
    kind: "common_area_entrance_door",
    evidence: [descriptionEvidence(CONSEQUENCES_INPUT.description)],
  },
} as const;
const CONFLICT_INPUT = inputFor(ID.conflict);
const CONFLICT_TITLE = "Дверь в помещении общего пользования";
const CONFLICT = {
  ...BASE,
  titleEvidence: descriptionEvidence(CONFLICT_TITLE),
  problemEvidence: [
    descriptionEvidence(CONFLICT_TITLE),
    descriptionEvidence("не закрывается полностью."),
  ],
  resolution: {
    intent: "restore_observed_state",
    evidence: descriptionEvidence(CONFLICT_TITLE),
  },
  locationWarning: {
    intent: "check_location",
    descriptionEvidence: descriptionEvidence(CONFLICT_INPUT.description),
    locationEvidence: { sourceField: "location", quote: CONFLICT_INPUT.location },
  },
  subject: {
    kind: "common_area_entrance_door",
    evidence: [descriptionEvidence(CONFLICT_TITLE)],
  },
} as const;
const LONG_TITLE = descriptionEvidence("а".repeat(generateRequestLimits.result.titleMax + 1));

// biome-ignore format: Каждая строка изолирует одно нарушение строгой provider-facing схемы.
const structuralRejections = [
  ["неизвестный outcome", { outcome: "partial" }],
  ["неизвестный intent", { ...BASE, resolution: { intent: "replace_wiring" } }],
  ["произвольный providerText", { ...BASE, providerText: "свободный текст" }],
  ["legacy title", { ...BASE, title: "Свободный заголовок" }],
  ["legacy problem", { ...BASE, problem: "Свободное описание проблемы" }],
  ["legacy circumstances", { ...BASE, circumstances: "Свободные обстоятельства" }],
  ["legacy impact", { ...BASE, impact: "Свободное описание последствий" }],
  ["legacy verification", { ...BASE, verification: "Свободная проверка" }],
  ["legacy actionPlan", { ...BASE, actionPlan: { remedyActions: ["Свободное действие"] } }],
  ["legacy warnings", { ...BASE, warnings: ["Свободное предупреждение"] }],
  ["лишнее поле multiple_issues", { outcome: "multiple_issues", reason: "две проблемы" }],
  ["неполный generated", { outcome: "generated", titleEvidence: BASE.titleEvidence }],
  ["пустой problemEvidence", { ...BASE, problemEvidence: [] }],
  ["пустая цитата", { ...BASE, titleEvidence: descriptionEvidence(" ") }],
  ["короткая цитата", { ...BASE, titleEvidence: descriptionEvidence("коротко") }],
  ["цитата с переводом строки", { ...BASE, titleEvidence: descriptionEvidence("На лестничной\nплощадке") }],
  ["цитата длиннее лимита", { ...BASE, resolution: { intent: "restore_observed_state", evidence: descriptionEvidence("а".repeat(301)) } }],
  ["четыре problemEvidence", { ...BASE, problemEvidence: ["первая цитата", "вторая цитата", "третья цитата", "четвёртая цитата"].map(descriptionEvidence) }],
  ["повтор problemEvidence", { ...BASE, problemEvidence: [BASE.titleEvidence, BASE.titleEvidence] }],
  ["titleEvidence вне problemEvidence", { ...BASE, titleEvidence: descriptionEvidence("Другая точная цитата") }],
  ["titleEvidence длиннее лимита", { ...BASE, titleEvidence: LONG_TITLE, problemEvidence: [LONG_TITLE] }],
  ["source-role mismatch", { ...BASE, resolution: { intent: "restore_observed_state", evidence: { sourceField: "desiredActions", quote: BASE_INPUT.description } } }],
  ["неверный sourceField warning", { ...BASE, locationWarning: { intent: "check_location", descriptionEvidence: BASE.titleEvidence, locationEvidence: BASE.titleEvidence } }],
  ["лишнее поле evidence", { ...BASE, titleEvidence: { ...BASE.titleEvidence, normalized: true } }],
] as const;

// biome-ignore format: Каждая строка изолирует одно нарушение provenance или source authority.
const evidenceRejections = [
  ["несовпадение регистра", BASE_INPUT, decisionWithQuote(BASE_INPUT.description.toLocaleLowerCase("ru"))],
  ["несовпадение пунктуации", BASE_INPUT, decisionWithQuote(`${BASE_INPUT.description.slice(0, -1)}!`)],
  ["неверное sourceField", BASE_INPUT, { ...BASE, titleEvidence: { sourceField: "location", quote: BASE_INPUT.description } }],
  ["неполное desiredActions", REQUESTED_INPUT, { ...REQUESTED, resolution: { intent: "perform_requested_action", evidence: { sourceField: "desiredActions", quote: "Прошу заменить повреждённый участок трубы" } } }],
  ["неполное location", CONFLICT_INPUT, { ...CONFLICT, locationWarning: { ...CONFLICT.locationWarning, locationEvidence: { sourceField: "location", quote: "подъезд 3" } } }],
  ["несовпавшее description в warning", CONFLICT_INPUT, { ...CONFLICT, locationWarning: { ...CONFLICT.locationWarning, descriptionEvidence: descriptionEvidence("Другая неподтверждённая проблема") } }],
  ["perform_requested_action без desiredActions", BASE_INPUT, { ...BASE, resolution: { intent: "perform_requested_action", evidence: { sourceField: "desiredActions", quote: "Выполнить действие" } } }],
  ["check_location без location", BASE_INPUT, { ...BASE, locationWarning: { intent: "check_location", descriptionEvidence: BASE.titleEvidence, locationEvidence: { sourceField: "location", quote: "подъезд 1" } } }],
  ["subject противоречит подтверждению", CONSEQUENCES_INPUT, { ...CONSEQUENCES, subject: { kind: "common_area_premises_lighting", evidence: [descriptionEvidence(CONSEQUENCES_INPUT.description)] } }],
  ["inferredImpact противоречит consequences", CONSEQUENCES_INPUT, { ...CONSEQUENCES, inferredImpact: { intent: "possible_use_impediment", evidence: CONSEQUENCES.titleEvidence } }],
  ["сокращённое описание без warning", CONFLICT_INPUT, { ...CONFLICT, locationWarning: null }],
] as const;

// biome-ignore format: Каждая строка переносит исторический failure в его прежнюю свободную роль.
const observedFailures = [
  ["unsupported component in preliminaryCheck", { ...BASE, actionPlan: { preliminaryCheck: "Осмотреть осветительные приборы и электропроводку", remedyActions: ["Восстановить освещение"], resultCheck: null } }],
  ["unsupported concrete diagnostic operation", { ...BASE, actionPlan: { preliminaryCheck: "Проверить электропроводку измерительным прибором", remedyActions: ["Восстановить освещение"], resultCheck: null } }],
  ["unsupported concrete remedyAction", { ...BASE, actionPlan: { preliminaryCheck: null, remedyActions: ["Смазать и отрегулировать механизм"], resultCheck: null } }],
  ["duplication verification and preliminaryCheck", { ...BASE, verification: "Установить причину проблемы", actionPlan: { preliminaryCheck: "Установить причину проблемы", remedyActions: ["Устранить причину"], resultCheck: null } }],
  ["location mixing", { ...CONFLICT, problem: `${CONFLICT_INPUT.description} Место: ${CONFLICT_INPUT.location}` }],
  ["affected-group expansion", { ...CONSEQUENCES, impact: "Проблема затрагивает всех жильцов" }],
] as const;

describe("отклонения детерминированного evidence gate", () => {
  it("отклоняет неизвестные варианты, legacy prose и лишние поля", () => {
    for (const [name, candidate] of structuralRejections) {
      expect.soft(decisionSchema.safeParse(candidate).success, name).toBe(false);
    }
    for (const [name, candidate] of observedFailures) {
      const parsed = decisionSchema.safeParse(candidate);
      expect.soft(parsed.success, name).toBe(false);
    }
  });

  it("отклоняет неподтверждённое evidence типизированной ошибкой", () => {
    for (const [name, input, candidate] of evidenceRejections) {
      expect(() => materializeDecision(input, candidate), name).toThrow(ProofRejectionError);
    }
  });

  it("не материализует outcome multiple_issues", () => {
    expect(() => materializeDecision(BASE_INPUT, { outcome: "multiple_issues" })).toThrow(
      ProofRejectionError,
    );
  });
});
