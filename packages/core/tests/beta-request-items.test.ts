import { describe, expect, it } from "vitest";
import {
  generateRequestLimits,
  CONFIRMED_PROBLEM_SUBJECT_KINDS,
  evaluateSpecificLegalBasisSelection,
  materializePrimaryRequestDraft,
  primaryRequestDraftLimits,
  primaryRequestDraftSchema,
  renderPrimaryRequestDraft,
  type GenerateRequestInput,
} from "../src";
import { scenarios } from "./fixtures.js";

const GENERIC_REQUEST_ITEM =
  "Проверить описанную проблему и при её подтверждении принять меры по устранению";

function generatedDraft(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "generated",
    title: "Не работает освещение",
    problem: "В помещении общего пользования не работает освещение.",
    circumstances: null,
    impact: null,
    subject: null,
    warnings: [],
    ...overrides,
  };
}

function materialize(input: GenerateRequestInput, overrides: Record<string, unknown> = {}) {
  return materializePrimaryRequestDraft(input, generatedDraft(overrides));
}

describe("beta request items", () => {
  it("формирует один безопасный generic request item без desiredActions", () => {
    const draft = materialize({
      description: "В помещении общего пользования не работает освещение.",
    });

    expect(draft).toMatchObject({ requestItems: [GENERIC_REQUEST_ITEM] });
    expect(Object.keys(draft)).toEqual([
      "title",
      "problem",
      "circumstances",
      "impact",
      "subject",
      "requestItems",
      "warnings",
    ]);
  });

  it.each(
    CONFIRMED_PROBLEM_SUBJECT_KINDS,
  )("не превращает согласованно ошибочный %s и дословную цитату в технический факт", (kind) => {
    const input = {
      description: "На стене заметно пятно воды. Источник неизвестен.",
      confirmedProblemSubject: kind,
    } satisfies GenerateRequestInput;
    const subject = {
      kind,
      evidence: [{ sourceField: "description" as const, quote: input.description }],
    };

    expect(evaluateSpecificLegalBasisSelection(subject, input).status).toBe("applied");
    expect(materialize(input, { subject }).requestItems).toEqual([GENERIC_REQUEST_ITEM]);
  });

  it.each([
    "working-elevator-noise",
    "lighting-elevator-cabin",
    "cleaning-entrance-door-mistaken-door-confirmation",
    "cleaning-elevator-cabin-mistaken-elevator-confirmation",
    "insufficient-enrichment-evidence",
  ])("сохраняет безопасное требование для отрицательного контроля %s", (id) => {
    const scenario = scenarios.find((scenario) => scenario.id === id);
    if (scenario === undefined) throw new Error(`Не найден сценарий ${id}`);
    const { desiredActions: _desiredActions, ...input } = scenario.input;
    const kind = input.confirmedProblemSubject;
    const subject =
      kind === undefined
        ? null
        : {
            kind,
            evidence: [{ sourceField: "description", quote: input.description }],
          };

    expect(materialize(input, { subject }).requestItems).toEqual([GENERIC_REQUEST_ITEM]);
  });

  it.each([
    "На потолке пятно воды, источник неизвестен.",
    "В помещении душно, причина неизвестна.",
  ])("не устанавливает источник воды или техническую причину: %s", (description) => {
    expect(materialize({ description }).requestItems).toEqual([GENERIC_REQUEST_ITEM]);
  });

  it.each([
    null,
    {
      kind: "common_area_roof",
      evidence: [{ sourceField: "description", quote: "На кровле обнаружена протечка" }],
    },
    {
      kind: "common_area_elevator",
      evidence: [{ sourceField: "description", quote: "На стене заметно пятно воды" }],
    },
  ])("использует fallback при отсутствующем, непроверяемом или несовпадающем subject %#", (subject) => {
    const draft = materialize(
      {
        description: "На стене заметно пятно воды, источник неизвестен.",
        confirmedProblemSubject: "common_area_roof",
      },
      { subject },
    );

    expect(draft.requestItems).toEqual([GENERIC_REQUEST_ITEM]);
  });

  it("не использует генеративные поля как доказательство для требования", () => {
    const input = { description: "В помещении душно, причина неизвестна." };
    const draft = materialize(input, {
      title: "Неисправна вентиляция",
      problem: "Сломалась общедомовая вентиляция.",
      circumstances: "Необходим ремонт вентиляционного канала.",
      impact: "Необходимо заменить оборудование.",
    });

    expect(draft.requestItems).toEqual([GENERIC_REQUEST_ITEM]);
  });

  it.each([
    "fallback",
    "explicit",
  ] as const)("сохраняет полный body на границе 2500/2501 для %s", (mode) => {
    const input = {
      description: "В общем коридоре не работает освещение.",
      confirmedProblemSubject: "common_area_premises_lighting",
      location: "М".repeat(generateRequestLimits.location.max),
      ...(mode === "explicit" ? { desiredActions: "Д".repeat(500) } : {}),
    } satisfies GenerateRequestInput;
    const overrides = {
      problem: `${"П".repeat(mode === "fallback" ? 400 : 1)}.`,
      circumstances: "О".repeat(600),
      impact: "И.",
      subject: {
        kind: input.confirmedProblemSubject,
        evidence: [{ sourceField: "description", quote: input.description }],
      },
    };
    const initialBody = renderPrimaryRequestDraft(materialize(input, overrides), input).body;
    const impact = `${"И".repeat(2500 - initialBody.length + 1)}.`;
    const draft = materialize(input, { ...overrides, impact });

    expect(renderPrimaryRequestDraft(draft, input).body).toHaveLength(2500);
    expect(draft.requestItems).toEqual([input.desiredActions ?? GENERIC_REQUEST_ITEM]);
    const overflowingDraft = materialize(input, { ...overrides, impact: `И${impact}` });
    expect(() => renderPrimaryRequestDraft(overflowingDraft, input)).toThrow();
    expect(overflowingDraft.impact).toBe(`И${impact}`);
  });

  it("сохраняет одно explicit desiredActions как единственный request item", () => {
    const draft = materialize({
      description: "В помещении общего пользования не работает освещение.",
      desiredActions: "Восстановить освещение.",
    });

    expect(draft).toMatchObject({ requestItems: ["Восстановить освещение."] });
  });

  it("не сегментирует составное explicit desiredActions", () => {
    const desiredActions =
      "Проверить источник воды, устранить причину и после работ проверить прекращение течи.";
    const draft = materialize({
      description: "С потолка в общем коридоре капает вода.",
      desiredActions,
    });

    expect(draft).toMatchObject({ requestItems: [desiredActions] });
  });

  it("сохраняет отрицание и не добавляет generic remedy рядом с explicit intent", () => {
    const desiredActions = "Только провести осмотр, работы пока не выполнять.";
    const draft = materialize({
      description: "В помещении общего пользования слышен посторонний шум.",
      desiredActions,
    });

    expect(draft).toMatchObject({ requestItems: [desiredActions] });
    expect(JSON.stringify(draft)).toContain("не выполнять");
    expect(JSON.stringify(draft)).not.toContain(GENERIC_REQUEST_ITEM);
  });

  it.each([
    {
      name: "presentation prefix",
      desiredActions: "  Прошу: восстановить освещение.  ",
      expected: "Восстановить освещение.",
    },
    {
      name: "multiline conditions",
      desiredActions:
        "проверить источник воды\r\nпосле осмотра устранить причину\rпри необходимости проверить результат",
      expected:
        "Проверить источник воды после осмотра устранить причину при необходимости проверить результат",
    },
    {
      name: "leading punctuation",
      desiredActions: "«только осмотреть, работы не выполнять».\n",
      expected: "«Только осмотреть, работы не выполнять».",
    },
  ])("применяет только безопасную presentation normalization: $name", ({
    desiredActions,
    expected,
  }) => {
    const draft = materialize({
      description: "В помещении общего пользования слышен посторонний шум.",
      desiredActions,
    });

    expect(draft).toMatchObject({ requestItems: [expected] });
  });

  it("сохраняет long-but-valid desiredActions целиком", () => {
    const desiredActions = "В".repeat(generateRequestLimits.desiredActions.max);
    const draft = materialize({
      description: "В помещении общего пользования не работает освещение.",
      desiredActions,
    });

    expect(draft).toMatchObject({ requestItems: [desiredActions] });
    expect(renderPrimaryRequestDraft(draft).body).toContain(desiredActions);
  });

  it("отклоняет превышение body budget без усечения explicit desiredActions", () => {
    const desiredActions = "В".repeat(generateRequestLimits.desiredActions.max);
    const input = {
      description: "В помещении общего пользования не работает освещение.",
      desiredActions,
    } satisfies GenerateRequestInput;

    expect(() =>
      materialize(input, {
        problem: "П".repeat(primaryRequestDraftLimits.problem.max),
      }),
    ).toThrow();
    expect(input.desiredActions).toBe(desiredActions);
  });

  it("renderer формирует ровно один завершающий блок «Прошу:»", () => {
    const draft = materialize({
      description: "В помещении общего пользования не работает освещение.",
      desiredActions: "Только провести осмотр, работы пока не выполнять.",
    });
    const result = renderPrimaryRequestDraft(draft);

    expect(result.body.match(/^Прошу:$/gmu)).toHaveLength(1);
    expect(result.body).toContain("Прошу:\n1. Только провести осмотр, работы пока не выполнять.");
    expect(result.body.endsWith("Только провести осмотр, работы пока не выполнять.")).toBe(true);
  });

  it("PrimaryRequestDraft требует ровно один request item и не принимает legacy ontology", () => {
    const base = {
      title: "Не работает освещение",
      problem: "В помещении общего пользования не работает освещение.",
      circumstances: null,
      impact: null,
      subject: null,
      warnings: [],
    };

    expect(primaryRequestDraftSchema.safeParse({ ...base, requestItems: [] }).success).toBe(false);
    expect(
      primaryRequestDraftSchema.safeParse({ ...base, requestItems: [GENERIC_REQUEST_ITEM] })
        .success,
    ).toBe(true);
    expect(
      primaryRequestDraftSchema.safeParse({
        ...base,
        requestItems: [GENERIC_REQUEST_ITEM, "Проверить результат"],
      }).success,
    ).toBe(false);
    expect(
      primaryRequestDraftSchema.safeParse({
        ...base,
        requestItems: [GENERIC_REQUEST_ITEM],
        verification: null,
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: [GENERIC_REQUEST_ITEM],
          resultCheck: null,
        },
      }).success,
    ).toBe(false);
  });
});
