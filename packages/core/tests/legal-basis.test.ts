import { describe, expect, it } from "vitest";
import {
  COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
  COMMON_LEGAL_BASIS_BLOCK,
  generateRequestLimits,
  primaryRequestLegalBasisLimits,
  primaryRequestDraftSchema,
  renderPrimaryRequestDraft,
  type GenerateRequestInput,
  type PrimaryRequestDraft,
} from "../src";

const DOOR_INPUT = {
  description: "Входная дверь подъезда не закрывается полностью.",
} satisfies GenerateRequestInput;
const CONFIRMED_DOOR_INPUT = {
  ...DOOR_INPUT,
  confirmedProblemSubject: "common_area_entrance_door",
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

const LIGHTING_INPUT = {
  description: "В общем коридоре многоквартирного дома не работает освещение.",
} satisfies GenerateRequestInput;
const CONFIRMED_LIGHTING_INPUT = {
  ...LIGHTING_INPUT,
  confirmedProblemSubject: "common_area_premises_lighting",
} satisfies GenerateRequestInput;
const LIGHTING_SUBJECT: Exclude<PrimaryRequestDraft["subject"], null> = {
  kind: "common_area_premises_lighting",
  evidence: [
    {
      sourceField: "description",
      quote: LIGHTING_INPUT.description,
    },
  ],
};

const CLEANING_INPUT = {
  description: "В подъезде многоквартирного дома не выполнена уборка лестничной площадки.",
} satisfies GenerateRequestInput;
const CONFIRMED_CLEANING_INPUT = {
  ...CLEANING_INPUT,
  confirmedProblemSubject: "common_area_premises_cleaning",
} satisfies GenerateRequestInput;
const CLEANING_SUBJECT: Exclude<PrimaryRequestDraft["subject"], null> = {
  kind: "common_area_premises_cleaning",
  evidence: [
    {
      sourceField: "description",
      quote: CLEANING_INPUT.description,
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
        requiresExplicitUserConfirmation: true,
        requiresVerifiedInputEvidence: true,
        limitation: expect.stringContaining("помещения общего пользования"),
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
    ]);
  });

  it("добавляет предметный абзац ровно один раз при явном подтверждении и evidence", () => {
    const result = renderPrimaryRequestDraft(createDraft(), CONFIRMED_DOOR_INPUT);
    const paragraph = COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0];

    expect(result.body.split(paragraph)).toHaveLength(2);
  });

  it("сохраняет общий и предметный нормативные абзацы в стабильном порядке", () => {
    const result = renderPrimaryRequestDraft(createDraft(), CONFIRMED_DOOR_INPUT);
    const paragraph = COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0];

    expect(result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK)).toBeLessThan(
      result.body.indexOf(paragraph),
    );
    expect(result.body.indexOf(paragraph)).toBeLessThan(result.body.indexOf("Прошу:"));
  });

  it("не подключает модуль без совпавшего с исходным вводом evidence", () => {
    const result = renderPrimaryRequestDraft(createDraft(), {
      description: "На лестничной площадке не работает освещение.",
      confirmedProblemSubject: "common_area_entrance_door",
    });

    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не подключает модуль для двери квартиры по точной цитате provider", () => {
    const result = renderPrimaryRequestDraft(
      createDraft({
        subject: {
          kind: "common_area_entrance_door",
          evidence: [{ sourceField: "description", quote: "Дверь квартиры" }],
        },
      }),
      { description: "Дверь квартиры не закрывается." },
    );

    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не подключает модуль по семантически бессмысленной точной цитате", () => {
    const meaninglessInput = { description: "аааааааааа" };
    const result = renderPrimaryRequestDraft(
      createDraft({
        subject: {
          kind: "common_area_entrance_door",
          evidence: [{ sourceField: "description", quote: meaninglessInput.description }],
        },
      }),
      meaninglessInput,
    );

    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не считает model kind и точное provenance evidence достаточным backend gate", () => {
    const result = renderPrimaryRequestDraft(createDraft(), DOOR_INPUT);

    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it.each([
    {
      description: "Дверь квартиры не закрывается.",
      confirmedProblemSubject: undefined,
      expected: false,
    },
    {
      description: "Дверь шкафа сломана.",
      confirmedProblemSubject: undefined,
      expected: false,
    },
    {
      description: "aaaaaaaaaa",
      confirmedProblemSubject: undefined,
      expected: false,
    },
    {
      description: "Входная дверь подъезда не закрывается.",
      confirmedProblemSubject: "common_area_entrance_door",
      expected: true,
    },
    {
      description: "Дверь помещения общего пользования не закрывается.",
      confirmedProblemSubject: "common_area_entrance_door",
      expected: true,
    },
  ] as const)("adversarial gate: $description, explicit confirmation=$confirmedProblemSubject", ({
    description,
    confirmedProblemSubject,
    expected,
  }) => {
    const result = renderPrimaryRequestDraft(
      createDraft({
        subject: {
          kind: "common_area_entrance_door",
          evidence: [{ sourceField: "description", quote: description }],
        },
      }),
      {
        description,
        ...(confirmedProblemSubject === undefined ? {} : { confirmedProblemSubject }),
      },
    );

    expect(result.body.includes(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0])).toBe(expected);
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
    const result = renderPrimaryRequestDraft(createDraft(), CONFIRMED_DOOR_INPUT);
    const serializedModule = JSON.stringify(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE);

    expect(serializedModule).not.toContain("actionPlan");
    expect(serializedModule).not.toContain("preliminaryCheck");
    expect(serializedModule).not.toContain("remedyActions");
    expect(serializedModule).not.toContain("resultCheck");
    expect(result.body).not.toContain("government.ru");
    expect(result.body).not.toContain("2026-08-15");
    expect(result.body).not.toContain("common-area-door");
  });

  it("не возвращает специальные требования постановления № 290 без отдельного gate", () => {
    const paragraph = COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0];
    const serializedModule = JSON.stringify(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE);

    expect(paragraph).toContain("постановлению Правительства РФ от 13.08.2006 № 491");
    expect(paragraph).not.toContain("плотности притворов");
    expect(paragraph).not.toContain("работоспособности фурнитуры");
    expect(paragraph).not.toContain("восстановительные работы");
    expect(serializedModule).not.toContain("03.04.2013 № 290");
    expect(serializedModule).not.toContain("ru-government-decree-290");
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
    expect(() =>
      renderPrimaryRequestDraft(draftFittingWithoutModule, CONFIRMED_DOOR_INPUT),
    ).toThrow();
    expect(draftFittingWithoutModule.problem).toHaveLength(oldMaximumProblemLength);
  });
});

describe("нормативный модуль освещения помещений общего пользования", () => {
  const paragraph =
    "Согласно пунктам 7 и 11 Правил содержания общего имущества в многоквартирном доме, утверждённых постановлением Правительства РФ от 13.08.2006 № 491, осветительные установки помещений общего пользования входят в состав внутридомовой системы электроснабжения, а содержание общего имущества включает обеспечение готовности такого электрооборудования.";

  function createLightingDraft(overrides: Partial<PrimaryRequestDraft> = {}): PrimaryRequestDraft {
    return createDraft({
      title: "Не работает освещение в общем коридоре",
      problem: LIGHTING_INPUT.description,
      subject: LIGHTING_SUBJECT,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Восстановить освещение в общем коридоре"],
        resultCheck: null,
      },
      ...overrides,
    });
  }

  it("хранит стабильный id, точный текст и metadata официального источника", () => {
    expect(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE).toEqual({
      id: "common-area-lighting",
      applicability: {
        subject: "common_area_premises_lighting",
        requiresExplicitUserConfirmation: true,
        requiresVerifiedInputEvidence: true,
        limitation:
          "Только осветительные установки внутри помещений общего пользования многоквартирного дома. Не применяется к освещению внутри квартиры, придомовой территории, улицы или фасада.",
      },
      paragraphs: [paragraph],
      sources: [
        {
          id: "ru-government-decree-491-common-property-rules",
          title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
          officialUrl: "https://government.ru/docs/all/57158/",
          provisions: ["подпункт «а» пункта 2", "пункт 7", "подпункт «б» пункта 11"],
          edition: "с изменениями от 07.03.2025 № 293",
          validThrough: "2027-12-31",
        },
      ],
      verifiedAt: "2026-08-16",
    });
  });

  it("добавляет предметный абзац ровно один раз после общих оснований", () => {
    const result = renderPrimaryRequestDraft(createLightingDraft(), CONFIRMED_LIGHTING_INPUT);

    expect(result.body.split(paragraph)).toHaveLength(2);
    expect(result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK)).toBeLessThan(
      result.body.indexOf(paragraph),
    );
    expect(result.body.indexOf(paragraph)).toBeLessThan(result.body.indexOf("Прошу:"));
  });

  it("не подключает модуль без явного подтверждения пользователя", () => {
    const result = renderPrimaryRequestDraft(createLightingDraft(), LIGHTING_INPUT);

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не подключает модуль при недостаточном evidence", () => {
    const result = renderPrimaryRequestDraft(createLightingDraft(), {
      description: "На лестничной площадке многоквартирного дома темно.",
      confirmedProblemSubject: "common_area_premises_lighting",
    });

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не подключает модуль при противоречии подтверждения и structured subject", () => {
    const result = renderPrimaryRequestDraft(createLightingDraft(), {
      ...LIGHTING_INPUT,
      confirmedProblemSubject: "common_area_entrance_door",
    });

    expect(result.body).not.toContain(paragraph);
    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it.each([
    "В квартире не работает освещение.",
    "Во дворе многоквартирного дома не работает освещение.",
    "На фасаде многоквартирного дома не работает освещение.",
  ])("не считает LLM kind и точное evidence достаточными для иной области: %s", (description) => {
    const result = renderPrimaryRequestDraft(
      createLightingDraft({
        problem: description,
        subject: {
          kind: "common_area_premises_lighting",
          evidence: [{ sourceField: "description", quote: description }],
        },
      }),
      { description },
    );

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it.each([
    "В квартире не работает освещение.",
    "Во дворе многоквартирного дома не работает освещение.",
    "На фасаде многоквартирного дома не работает освещение.",
  ])("не считает ошибочный пользовательский выбор достаточным при subject: null: %s", (description) => {
    const result = renderPrimaryRequestDraft(
      createLightingDraft({ subject: null, problem: description }),
      { description, confirmedProblemSubject: "common_area_premises_lighting" },
    );

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не считает одной LLM-категории достаточной", () => {
    const result = renderPrimaryRequestDraft(createLightingDraft());

    expect(result.body).not.toContain(paragraph);
  });

  it("не использует совпадение слов в пользовательском тексте как gate", () => {
    const result = renderPrimaryRequestDraft(
      createLightingDraft({ subject: null }),
      CONFIRMED_LIGHTING_INPUT,
    );

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не выводит URL, metadata и причины неисправности в пользовательский body", () => {
    const result = renderPrimaryRequestDraft(createLightingDraft(), CONFIRMED_LIGHTING_INPUT);

    expect(result.body).not.toContain("government.ru");
    expect(result.body).not.toContain("2026-08-16");
    expect(result.body).not.toContain("common-area-lighting");
    expect(result.body).not.toContain("ламп");
    expect(result.body).not.toContain("проводк");
    expect(result.body).not.toContain("автомат");
    expect(result.body).not.toContain("светильник");
  });

  it("сохраняет дверной модуль и общий сценарий без предметного модуля", () => {
    const doorResult = renderPrimaryRequestDraft(createDraft(), CONFIRMED_DOOR_INPUT);
    const commonResult = renderPrimaryRequestDraft(createLightingDraft({ subject: null }), {
      description: "В общем коридоре многоквартирного дома скользкий пол.",
    });

    expect(doorResult.body).toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(commonResult.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
    expect(commonResult.body).not.toContain(paragraph);
  });

  it("учитывает самый длинный предметный текст в budget без усечения", () => {
    const minimalDraft = createLightingDraft({
      problem: "а.",
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["б."],
        resultCheck: null,
      },
    });
    const minimalBodyLength = renderPrimaryRequestDraft(minimalDraft).body.length;
    const maximumProblemWithoutSpecificBasis =
      generateRequestLimits.result.bodyMax - minimalBodyLength + minimalDraft.problem.length;
    const draftFittingWithoutModule = createLightingDraft({
      problem: `${"а".repeat(maximumProblemWithoutSpecificBasis - 1)}.`,
      actionPlan: minimalDraft.actionPlan,
    });

    expect(primaryRequestDraftSchema.safeParse(draftFittingWithoutModule).success).toBe(false);
    expect(() =>
      renderPrimaryRequestDraft(draftFittingWithoutModule, CONFIRMED_LIGHTING_INPUT),
    ).toThrow();
    expect(draftFittingWithoutModule.problem).toHaveLength(maximumProblemWithoutSpecificBasis);
  });
});

describe("нормативный модуль уборки помещений общего пользования", () => {
  const paragraph =
    "Согласно подпункту «а» пункта 2 и подпункту «г» пункта 11 Правил содержания общего имущества в многоквартирном доме, утверждённых постановлением Правительства РФ от 13.08.2006 № 491, помещения, не являющиеся частями квартир и предназначенные для обслуживания более одного помещения, относятся к помещениям общего пользования, а содержание общего имущества включает уборку и санитарно-гигиеническую очистку таких помещений.";

  function createCleaningDraft(overrides: Partial<PrimaryRequestDraft> = {}): PrimaryRequestDraft {
    return createDraft({
      title: "Не выполнена уборка подъезда",
      problem: CLEANING_INPUT.description,
      subject: CLEANING_SUBJECT,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Выполнить уборку лестничной площадки"],
        resultCheck: null,
      },
      ...overrides,
    });
  }

  it("хранит стабильный id, точный текст, применимость и metadata первичного источника", () => {
    expect(COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE).toEqual({
      id: "common-area-cleaning",
      applicability: {
        subject: "common_area_premises_cleaning",
        requiresExplicitUserConfirmation: true,
        requiresVerifiedInputEvidence: true,
        limitation:
          "Только уборка помещений общего пользования многоквартирного дома. Не применяется к уборке внутри квартиры, придомовой территории, контейнерной площадки или вывозу твёрдых коммунальных отходов.",
      },
      paragraphs: [paragraph],
      sources: [
        {
          id: "ru-government-decree-491-common-property-rules",
          title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
          officialUrl: "https://government.ru/docs/all/57158/",
          provisions: ["подпункт «а» пункта 2", "подпункт «г» пункта 11"],
          edition: "с изменениями от 07.03.2025 № 293",
          validThrough: "2027-12-31",
        },
      ],
      verifiedAt: "2026-08-17",
    });
  });

  it("добавляет специальный абзац ровно один раз между общими основаниями и просьбой", () => {
    const result = renderPrimaryRequestDraft(createCleaningDraft(), CONFIRMED_CLEANING_INPUT);

    expect(result.body.split(paragraph)).toHaveLength(2);
    expect(result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK)).toBeLessThan(
      result.body.indexOf(paragraph),
    );
    expect(result.body.indexOf(paragraph)).toBeLessThan(result.body.indexOf("Прошу:"));
  });

  it.each([
    ["без подтверждения", CLEANING_INPUT],
    [
      "при несовпадении subject",
      { ...CLEANING_INPUT, confirmedProblemSubject: "common_area_premises_lighting" as const },
    ],
    [
      "при неподтверждаемом evidence",
      {
        description: "В подъезде требуется уборка коридора.",
        confirmedProblemSubject: "common_area_premises_cleaning" as const,
      },
    ],
  ])("не подключает модуль %s", (_caseName, input) => {
    const result = renderPrimaryRequestDraft(createCleaningDraft(), input);

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не считает LLM subject сам по себе достаточным", () => {
    const result = renderPrimaryRequestDraft(createCleaningDraft());

    expect(result.body).not.toContain(paragraph);
  });

  it.each([
    "В квартире требуется уборка пола.",
    "На придомовой территории требуется уборка.",
    "На контейнерной площадке скопился мусор.",
    "Необходимо организовать вывоз ТКО.",
    "В подъезде не работает освещение.",
  ])("не подключает cleaning module вне области применимости: %s", (description) => {
    const result = renderPrimaryRequestDraft(
      createCleaningDraft({ problem: description, subject: null }),
      { description, confirmedProblemSubject: "common_area_premises_cleaning" },
    );

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не выводит URL, metadata и процедурные действия из нормативного модуля", () => {
    const result = renderPrimaryRequestDraft(createCleaningDraft(), CONFIRMED_CLEANING_INPUT);
    const serializedModule = JSON.stringify(COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE);

    expect(result.body).not.toContain("government.ru");
    expect(result.body).not.toContain("2026-08-17");
    expect(result.body).not.toContain("common-area-cleaning");
    expect(serializedModule).not.toContain("actionPlan");
    expect(serializedModule).not.toContain("remedyActions");
  });

  it("учитывает новый максимальный legal block в budget без усечения", () => {
    const expectedMaximumBlock = [COMMON_LEGAL_BASIS_BLOCK, paragraph].join("\n\n");
    const minimalDraft = createCleaningDraft({
      problem: "а.",
      actionPlan: { preliminaryCheck: null, remedyActions: ["б."], resultCheck: null },
    });
    const minimalBodyLength = renderPrimaryRequestDraft(minimalDraft).body.length;
    const maximumProblemWithoutSpecificBasis =
      generateRequestLimits.result.bodyMax - minimalBodyLength + minimalDraft.problem.length;
    const draftFittingWithoutModule = createCleaningDraft({
      problem: `${"а".repeat(maximumProblemWithoutSpecificBasis - 1)}.`,
      actionPlan: minimalDraft.actionPlan,
    });

    expect(primaryRequestLegalBasisLimits.maximumBlockLength).toBe(expectedMaximumBlock.length);
    expect(primaryRequestDraftSchema.safeParse(draftFittingWithoutModule).success).toBe(false);
    expect(() =>
      renderPrimaryRequestDraft(draftFittingWithoutModule, CONFIRMED_CLEANING_INPUT),
    ).toThrow();
    expect(draftFittingWithoutModule.problem).toHaveLength(maximumProblemWithoutSpecificBasis);
  });
});
