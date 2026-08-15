import { describe, expect, it } from "vitest";
import {
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  COMMON_LEGAL_BASIS_BLOCK,
  generateRequestLimits,
  primaryRequestDraftSchema,
  renderPrimaryRequestDraft,
  type GenerateRequestInput,
  type PrimaryRequestDraft,
} from "../src";

const DOOR_INPUT = {
  description: "Входная дверь подъезда не закрывается полностью.",
} satisfies GenerateRequestInput;

const DOOR_SUBJECT: Exclude<PrimaryRequestDraft["subject"], null> = {
  kind: "common_area_entrance_door",
  evidence: [
    {
      sourceField: "description",
      quote: "Входная дверь подъезда",
    },
  ],
};

function createDraft(overrides: Partial<PrimaryRequestDraft> = {}): PrimaryRequestDraft {
  return {
    title: "Не закрывается входная дверь",
    problem: "Входная дверь подъезда не закрывается полностью.",
    circumstances: null,
    impact: null,
    verification: null,
    subject: DOOR_SUBJECT,
    actionPlan: {
      preliminaryCheck: null,
      remedyActions: ["Восстановить нормальное закрывание двери"],
      resultCheck: "После работ проверить полное закрывание двери",
    },
    warnings: [],
    ...overrides,
  };
}

describe("нормативный модуль двери общего пользования", () => {
  it("хранит стабильный id, область применимости и metadata официальных источников", () => {
    expect(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE).toMatchObject({
      id: "common-area-door",
      applicability: {
        subject: "common_area_entrance_door",
        requiresVerifiedInputEvidence: true,
      },
      verifiedAt: "2026-08-15",
    });
    expect(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs).toHaveLength(1);
    expect(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.sources).toEqual([
      expect.objectContaining({
        id: "ru-government-decree-491-common-property-rules",
        officialUrl: "https://government.ru/docs/all/57158/",
        provisions: ["подпункт «г» пункта 2", "пункт 10"],
        edition: "с изменениями от 07.03.2025 № 293",
        validThrough: "2027-12-31",
      }),
      expect.objectContaining({
        id: "ru-government-decree-290-minimum-work-list",
        officialUrl: "https://government.ru/docs/all/86860/",
        provisions: ["пункт 13 Минимального перечня"],
        edition: "с изменениями от 07.03.2025 № 293",
        validThrough: "2029-09-01",
      }),
    ]);
  });

  it("добавляет предметный абзац ровно один раз при подтверждённом evidence", () => {
    const result = renderPrimaryRequestDraft(createDraft(), DOOR_INPUT);
    const paragraph = COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0];

    expect(result.body.split(paragraph)).toHaveLength(2);
  });

  it("сохраняет общий и предметный нормативные абзацы в стабильном порядке", () => {
    const result = renderPrimaryRequestDraft(createDraft(), DOOR_INPUT);
    const paragraph = COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0];

    expect(result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK)).toBeLessThan(
      result.body.indexOf(paragraph),
    );
    expect(result.body.indexOf(paragraph)).toBeLessThan(result.body.indexOf("Прошу:"));
  });

  it("не подключает модуль без совпавшего с исходным вводом evidence", () => {
    const result = renderPrimaryRequestDraft(createDraft(), {
      description: "На лестничной площадке не работает освещение.",
    });

    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не считает одной LLM-категории достаточной без исходного ввода", () => {
    const result = renderPrimaryRequestDraft(createDraft());

    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
  });

  it("не добавляет модуль в несвязанный сценарий", () => {
    const result = renderPrimaryRequestDraft(
      createDraft({
        title: "Не работает освещение",
        problem: "На лестничной площадке не работает освещение.",
        subject: null,
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Восстановить освещение"],
          resultCheck: null,
        },
      }),
      { description: "На лестничной площадке не работает освещение." },
    );

    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не содержит процедурного плана и не выводит developer metadata в body", () => {
    const result = renderPrimaryRequestDraft(createDraft(), DOOR_INPUT);
    const serializedModule = JSON.stringify(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE);

    expect(serializedModule).not.toContain("actionPlan");
    expect(serializedModule).not.toContain("preliminaryCheck");
    expect(serializedModule).not.toContain("remedyActions");
    expect(serializedModule).not.toContain("resultCheck");
    expect(result.body).not.toContain("government.ru");
    expect(result.body).not.toContain("2026-08-15");
    expect(result.body).not.toContain("common-area-door");
  });

  it("отклоняет draft, который помещался бы без предметного абзаца, без усечения", () => {
    const paragraph = COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0];
    const minimalDraft = createDraft({
      problem: "а.",
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["б."],
        resultCheck: null,
      },
    });
    const minimalBodyLength = renderPrimaryRequestDraft(minimalDraft).body.length;
    const oldMaximumProblemLength =
      generateRequestLimits.result.bodyMax - minimalBodyLength + minimalDraft.problem.length;
    const draftFittingWithoutModule = createDraft({
      problem: `${"а".repeat(oldMaximumProblemLength - 1)}.`,
      actionPlan: minimalDraft.actionPlan,
    });

    const bodyLengthWithoutModule =
      draftFittingWithoutModule.problem.length +
      "\n\n".length +
      COMMON_LEGAL_BASIS_BLOCK.length +
      "\n\n".length +
      "Прошу:\n1. б.".length;

    expect(bodyLengthWithoutModule).toBe(generateRequestLimits.result.bodyMax);
    expect(paragraph.length).toBeGreaterThan(0);
    expect(primaryRequestDraftSchema.safeParse(draftFittingWithoutModule).success).toBe(false);
    expect(() => renderPrimaryRequestDraft(draftFittingWithoutModule, DOOR_INPUT)).toThrow();
    expect(draftFittingWithoutModule.problem).toHaveLength(oldMaximumProblemLength);
  });
});
