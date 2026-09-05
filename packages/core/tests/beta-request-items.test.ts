import { describe, expect, it } from "vitest";
import {
  generateRequestLimits,
  materializePrimaryRequestDraft,
  primaryRequestDraftLimits,
  primaryRequestDraftSchema,
  renderPrimaryRequestDraft,
  type GenerateRequestInput,
} from "../src";

const GENERIC_REQUEST_ITEM = "Устранить наблюдаемую проблему";

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
