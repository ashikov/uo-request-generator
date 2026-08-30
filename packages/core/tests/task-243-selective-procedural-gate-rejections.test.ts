import { describe, expect, it } from "vitest";
import { scenarios } from "./fixtures.js";
import {
  materializeSelectiveDraft,
  selectiveProviderDraftSchema,
  SelectiveGateRejectionError,
} from "./task-243-selective-procedural-gate-proof.js";

const BASE_INPUT = scenarios.find(({ id }) => id === "only-description")?.input;
if (BASE_INPUT === undefined) throw new TypeError("Нет scenario only-description");

const descriptionEvidence = (quote: string) => ({ sourceField: "description", quote }) as const;
const BASE = {
  outcome: "generated",
  title: "Не работает освещение",
  problem: "На лестничной площадке не работает освещение.",
  circumstances: null,
  impact: null,
  verificationDecision: null,
  subject: null,
  actionPlanDecision: {
    preliminaryCheck: null,
    remedy: {
      intent: "resolve_observed_problem",
      evidence: descriptionEvidence(BASE_INPUT.description),
    },
    resultCheck: null,
  },
  warnings: [],
} as const;

// biome-ignore format: Каждая строка изолирует один запрещённый provider-facing slot или неизвестное решение.
const structuralRejections = [
  ["неизвестный outcome", { outcome: "partial" }],
  ["неполный generated", { outcome: "generated", title: "Черновик" }],
  ["provider-authored actionPlan", { ...BASE, actionPlan: { preliminaryCheck: null, remedyActions: ["Смазать и отрегулировать механизм"], resultCheck: null } }],
  ["provider-authored verification", { ...BASE, verification: "Проверить неисправность выключателя" }],
  ["произвольный providerText", { ...BASE, providerText: "Заменить проводку" }],
  ["неизвестный remedy intent", { ...BASE, actionPlanDecision: { ...BASE.actionPlanDecision, remedy: { intent: "replace_wiring" } } }],
  ["repair method рядом с bounded remedy", { ...BASE, actionPlanDecision: { ...BASE.actionPlanDecision, remedy: { ...BASE.actionPlanDecision.remedy, methodText: "Заменить выключатель" } } }],
  ["component рядом с preliminary decision", { ...BASE, actionPlanDecision: { ...BASE.actionPlanDecision, preliminaryCheck: { intent: "establish_unknown_cause", evidence: descriptionEvidence(BASE_INPUT.description), component: "электропроводка" } } }],
  ["free text рядом с result decision", { ...BASE, actionPlanDecision: { ...BASE.actionPlanDecision, resultCheck: { intent: "confirm_problem_resolved", evidence: descriptionEvidence(BASE_INPUT.description), providerText: "Проверить автомат" } } }],
  ["free install method", { ...BASE, actionPlanDecision: { ...BASE.actionPlanDecision, remedy: { intent: "install_observed_missing_element", observationEvidence: descriptionEvidence(BASE_INPUT.description), targetEvidence: descriptionEvidence("освещение"), repairMethod: "заменить светильник" } } }],
  ["legacy remedyActions", { ...BASE, remedyActions: ["Отремонтировать петли"] }],
  ["лишнее поле multiple_issues", { outcome: "multiple_issues", reason: "две проблемы" }],
] as const;

function explicitCandidate(desiredActions: string) {
  return {
    ...BASE,
    actionPlanDecision: {
      preliminaryCheck: null,
      remedy: {
        intent: "perform_explicit_desired_actions",
        evidence: { sourceField: "desiredActions", quote: desiredActions },
      },
      resultCheck: null,
    },
  } as const;
}

describe("selective procedural gate rejection matrix", () => {
  it("отклоняет free procedural prose, unknown intents и лишние поля", () => {
    for (const [name, candidate] of structuralRejections) {
      expect.soft(selectiveProviderDraftSchema.safeParse(candidate).success, name).toBe(false);
    }
  });

  it("отклоняет evidence, которое не подтверждено исходным полем", () => {
    const candidates = [
      {
        name: "другой регистр",
        input: BASE_INPUT,
        candidate: {
          ...BASE,
          actionPlanDecision: {
            ...BASE.actionPlanDecision,
            remedy: {
              ...BASE.actionPlanDecision.remedy,
              evidence: descriptionEvidence(BASE_INPUT.description.toLocaleLowerCase("ru")),
            },
          },
        },
      },
      {
        name: "несуществующая description quote",
        input: BASE_INPUT,
        candidate: {
          ...BASE,
          actionPlanDecision: {
            ...BASE.actionPlanDecision,
            remedy: {
              ...BASE.actionPlanDecision.remedy,
              evidence: descriptionEvidence("Неисправен выключатель освещения."),
            },
          },
        },
      },
      {
        name: "explicit path без desiredActions",
        input: BASE_INPUT,
        candidate: explicitCandidate("Восстановить освещение."),
      },
      {
        name: "частичное desiredActions",
        input: {
          ...BASE_INPUT,
          desiredActions: "Проверить причину и восстановить освещение.",
        },
        candidate: explicitCandidate("Восстановить освещение."),
      },
      {
        name: "generic remedy при authoritative desiredActions",
        input: { ...BASE_INPUT, desiredActions: "Восстановить освещение." },
        candidate: BASE,
      },
      {
        name: "install target вне observation excerpt",
        input: {
          description: "На входной двери отсутствует ручка. Рядом установлен доводчик.",
        },
        candidate: {
          ...BASE,
          problem: "На входной двери отсутствует ручка.",
          actionPlanDecision: {
            preliminaryCheck: null,
            remedy: {
              intent: "install_observed_missing_element",
              observationEvidence: descriptionEvidence("На входной двери отсутствует ручка."),
              targetEvidence: descriptionEvidence("доводчик"),
            },
            resultCheck: null,
          },
        },
      },
      {
        name: "install target отсутствует во входе",
        input: { description: "На входной двери отсутствует ручка." },
        candidate: {
          ...BASE,
          problem: "На входной двери отсутствует ручка.",
          actionPlanDecision: {
            preliminaryCheck: null,
            remedy: {
              intent: "install_observed_missing_element",
              observationEvidence: descriptionEvidence("На входной двери отсутствует ручка."),
              targetEvidence: descriptionEvidence("доводчик"),
            },
            resultCheck: null,
          },
        },
      },
    ] as const;

    for (const { name, input, candidate } of candidates) {
      expect(() => materializeSelectiveDraft(input, candidate), name).toThrow(
        SelectiveGateRejectionError,
      );
    }
  });

  it("отклоняет точное дублирование verification и preliminaryCheck", () => {
    const quote = BASE_INPUT.description;
    const candidate = {
      ...BASE,
      verificationDecision: {
        intent: "preserve_user_stated_uncertainty",
        evidence: descriptionEvidence(quote),
      },
      actionPlanDecision: {
        ...BASE.actionPlanDecision,
        preliminaryCheck: {
          intent: "establish_unknown_cause",
          evidence: descriptionEvidence(quote),
        },
      },
    } as const;

    expect(() => materializeSelectiveDraft(BASE_INPUT, candidate)).toThrow(
      SelectiveGateRejectionError,
    );
  });

  it("отклоняет subject, который не проходит существующий evidence gate", () => {
    const input = {
      description: "Дверь помещения общего пользования не закрывается полностью.",
      confirmedProblemSubject: "common_area_entrance_door" as const,
    };
    const candidate = {
      ...BASE,
      problem: input.description,
      subject: {
        kind: "common_area_premises_lighting" as const,
        evidence: [descriptionEvidence(input.description)],
      },
      actionPlanDecision: {
        ...BASE.actionPlanDecision,
        remedy: {
          ...BASE.actionPlanDecision.remedy,
          evidence: descriptionEvidence(input.description),
        },
      },
    } as const;

    expect(() => materializeSelectiveDraft(input, candidate)).toThrow(SelectiveGateRejectionError);
  });

  it("не материализует multiple_issues в частичный draft", () => {
    expect(selectiveProviderDraftSchema.safeParse({ outcome: "multiple_issues" }).success).toBe(
      true,
    );
    expect(() => materializeSelectiveDraft(BASE_INPUT, { outcome: "multiple_issues" })).toThrow(
      SelectiveGateRejectionError,
    );
  });
});
