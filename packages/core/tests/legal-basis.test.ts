import { describe, expect, it } from "vitest";
import {
  COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
  COMMON_AREA_ROOF_LEGAL_BASIS_MODULE,
  COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
  COMMON_LEGAL_BASIS_BLOCK,
  generateRequestLimits,
  primaryRequestLegalBasisLimits,
  primaryRequestDraftSchema,
  evaluateSpecificLegalBasisSelection,
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
const ELEVATOR_CABIN_LIGHTING_INPUT = {
  description: "В кабине лифта не работает освещение.",
  location: "второй подъезд",
  consequences: "В кабине темно.",
  desiredActions: "Восстановить освещение.",
} satisfies GenerateRequestInput;
const CONFIRMED_ELEVATOR_CABIN_LIGHTING_INPUT = {
  ...ELEVATOR_CABIN_LIGHTING_INPUT,
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

const ROOF_INPUT = {
  description: "На кровле многоквартирного дома обнаружена протечка.",
  confirmedProblemSubject: "common_area_roof",
} satisfies GenerateRequestInput;
const ROOF_SUBJECT: Exclude<PrimaryRequestDraft["subject"], null> = {
  kind: "common_area_roof",
  evidence: [{ sourceField: "description", quote: ROOF_INPUT.description }],
};

const VENTILATION_INPUT = {
  description: "Общедомовой вентиляционный канал, обслуживающий помещения подъезда, не работает.",
  confirmedProblemSubject: "common_area_ventilation",
} satisfies GenerateRequestInput;
const VENTILATION_SUBJECT: Exclude<PrimaryRequestDraft["subject"], null> = {
  kind: "common_area_ventilation",
  evidence: [{ sourceField: "description", quote: VENTILATION_INPUT.description }],
};

const ELEVATOR_INPUT = {
  description: "Лифт в многоквартирном доме не реагирует на вызов с первого этажа.",
  confirmedProblemSubject: "common_area_elevator",
} satisfies GenerateRequestInput;
const ELEVATOR_SUBJECT: Exclude<PrimaryRequestDraft["subject"], null> = {
  kind: "common_area_elevator",
  evidence: [{ sourceField: "description", quote: ELEVATOR_INPUT.description }],
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
    "Согласно подпункту «а» пункта 2 и пунктам 7 и 11 Правил содержания общего имущества в многоквартирном доме, утверждённых постановлением Правительства РФ от 13.08.2006 № 491, к помещениям общего пользования отнесены в том числе лифты, осветительные установки таких помещений входят в состав внутридомовой системы электроснабжения, а содержание общего имущества включает обеспечение готовности такого электрооборудования.";

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
          "Только осветительные установки внутри помещений общего пользования многоквартирного дома, включая освещение в кабине лифта. Не применяется к освещению внутри квартиры, придомовой территории, улицы или фасада. Не подтверждает неисправность лифта или конкретную техническую причину отсутствия света.",
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
      verifiedAt: "2026-08-23",
    });
  });

  it("сохраняет lighting module для подтверждённого отсутствия освещения в кабине лифта", () => {
    const draft = createLightingDraft({
      title: "Не работает освещение в кабине лифта",
      problem: ELEVATOR_CABIN_LIGHTING_INPUT.description,
      subject: {
        kind: "common_area_premises_lighting",
        evidence: [
          {
            sourceField: "description",
            quote: ELEVATOR_CABIN_LIGHTING_INPUT.description,
          },
        ],
      },
      actionPlan: {
        preliminaryCheck: "При необходимости установить причину отсутствия освещения",
        remedyActions: [ELEVATOR_CABIN_LIGHTING_INPUT.desiredActions],
        resultCheck: "Проверить работу освещения после восстановления",
      },
    });

    const result = renderPrimaryRequestDraft(draft, CONFIRMED_ELEVATOR_CABIN_LIGHTING_INPUT);

    expect(result.body).toContain(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).not.toContain(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).not.toContain("заменить лампу");
    expect(result.body).not.toContain("неисправность проводки");
  });

  it("остаётся fail closed для кабины лифта без подтверждённого lighting subject", () => {
    const result = renderPrimaryRequestDraft(
      createLightingDraft({
        problem: ELEVATOR_CABIN_LIGHTING_INPUT.description,
        subject: {
          kind: "common_area_premises_lighting",
          evidence: [
            {
              sourceField: "description",
              quote: ELEVATOR_CABIN_LIGHTING_INPUT.description,
            },
          ],
        },
      }),
      ELEVATOR_CABIN_LIGHTING_INPUT,
    );

    expect(result.body).not.toContain(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).not.toContain(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0]);
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
    expect(result.body).not.toContain(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.verifiedAt);
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
    "Подпункт «г» пункта 11 Правил содержания общего имущества в многоквартирном доме, утверждённых постановлением Правительства РФ от 13.08.2006 № 491, относит уборку и санитарно-гигиеническую очистку помещений общего пользования к содержанию общего имущества. Подпункт «а» пункта 2 Правил относит к ним помещения, не являющиеся частями квартир и предназначенные для обслуживания более одного помещения в многоквартирном доме.";

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
          "Только уборка помещений общего пользования многоквартирного дома. Для отдельных объектов охватывает только уборку кабины лифта, протирку дверных коробок, полотен, доводчиков и ручек входной двери общего пользования и уборку стены в подъезде или на лестничной клетке. Постановление № 290 не применяется в случаях, урегулированных постановлением № 360; модуль не определяет территориальный режим. Правила № 170 не устанавливают немедленный срок удаления каждого загрязнения, а пункт 3.2.7 прямо упоминает обметание стен только при использовании централизованных вакуумных систем. Не применяется к другим поверхностям и элементам только по факту их расположения в общем помещении, к уборке внутри квартиры, придомовой территории, контейнерной площадки или вывозу твёрдых коммунальных отходов.",
      },
      paragraphs: [paragraph],
      sources: [
        {
          id: "ru-government-decree-491-common-property-rules",
          title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
          officialUrl: "https://government.ru/docs/all/57158/",
          provisions: [
            "подпункт «а» пункта 2",
            "подпункт «в» пункта 2",
            "подпункт «г» пункта 2",
            "подпункт «г» пункта 11",
          ],
          edition: "с изменениями от 07.03.2025 № 293",
          validThrough: "2027-12-31",
        },
        {
          id: "ru-government-decree-290-minimum-works",
          title: "Постановление Правительства Российской Федерации от 03.04.2013 № 290",
          officialUrl: "https://government.ru/docs/all/86860/",
          provisions: ["пункт 23"],
          edition: "с изменениями от 07.03.2025 № 293",
          validThrough: "2029-09-01",
        },
        {
          id: "ru-gosstroy-decree-170-housing-operation-rules",
          title: "Постановление Госстроя Российской Федерации от 27.09.2003 № 170",
          officialUrl: "https://mintrud.gov.ru/docs/government/postan/111",
          provisions: ["пункт 3.2.2", "пункт 3.2.7"],
          edition: "с учётом решения Верховного Суда РФ от 22.06.2022 № АКПИ22-375",
          validThrough: null,
        },
        {
          id: "ru-government-decree-360-new-territories-housing-rules",
          title: "Постановление Правительства Российской Федерации от 07.03.2023 № 360",
          officialUrl: "https://publication.pravo.gov.ru/document/0001202303100025",
          provisions: ["пункт 1", "подпункт «в» пункта 2"],
          edition: "с изменениями от 15.02.2025 № 167",
          validThrough: "2028-01-01",
        },
      ],
      verifiedAt: "2026-08-24",
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
    "common_area_entrance_door",
    "common_area_elevator",
  ] as const)("fail closed при independently inferred cleaning и backend-подтверждении %s", (confirmedProblemSubject) => {
    const input = {
      description: "На входной двери загрязнение. Дверь открывается и закрывается нормально.",
      confirmedProblemSubject,
    } satisfies GenerateRequestInput;
    const subject = {
      kind: "common_area_premises_cleaning" as const,
      evidence: [{ sourceField: "description" as const, quote: input.description }],
    };

    expect(evaluateSpecificLegalBasisSelection(subject, input)).toEqual({
      status: "subject_kind_mismatch",
    });

    const result = renderPrimaryRequestDraft(createCleaningDraft({ subject }), input);

    expect(result.body).not.toContain(paragraph);
    expect(result.body).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).not.toContain(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0]);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
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

  it.each([
    [
      "загрязнение в кабине исправного лифта",
      {
        description:
          "В кабине грузового лифта несколько дней остаётся загрязнение и неприятный запах. Сам лифт работает.",
        location: "второй подъезд",
        desiredActions: "Убрать загрязнение из кабины грузового лифта.",
      },
      "В кабине грузового лифта несколько дней остаётся загрязнение и неприятный запах. Сам лифт работает.",
      "Убрать загрязнение из кабины грузового лифта.",
    ],
    [
      "загрязнение на исправной входной двери",
      {
        description:
          "На входной двери несколько дней остаётся загрязнение и неприятный запах. Дверь открывается и закрывается нормально.",
        location: "второй подъезд",
        desiredActions: "Очистить входную дверь от загрязнения.",
      },
      "На входной двери несколько дней остаётся загрязнение и неприятный запах. Дверь открывается и закрывается нормально.",
      "Очистить входную дверь от загрязнения.",
    ],
    [
      "загрязнение стены в подъезде",
      {
        description: "На стене в подъезде несколько дней остаётся загрязнение и неприятный запах.",
        location: "второй подъезд",
        desiredActions: "Очистить стену от загрязнения.",
      },
      "На стене в подъезде несколько дней остаётся загрязнение и неприятный запах.",
      "Очистить стену от загрязнения.",
    ],
  ])("подключает cleaning module при загрязнении элемента общего имущества: %s", (_caseName, input, descriptionQuote, desiredActionQuote) => {
    const confirmedInput = {
      ...input,
      confirmedProblemSubject: "common_area_premises_cleaning" as const,
    };
    const result = renderPrimaryRequestDraft(
      createCleaningDraft({
        title: "Не удалено загрязнение в помещении общего пользования",
        problem: input.description,
        subject: {
          kind: "common_area_premises_cleaning",
          evidence: [
            { sourceField: "description", quote: descriptionQuote },
            { sourceField: "desiredActions", quote: desiredActionQuote },
          ],
        },
      }),
      confirmedInput,
    );

    expect(result.body.split(paragraph)).toHaveLength(2);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не выводит URL, metadata и процедурные действия из нормативного модуля", () => {
    const result = renderPrimaryRequestDraft(createCleaningDraft(), CONFIRMED_CLEANING_INPUT);
    const serializedModule = JSON.stringify(COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE);

    expect(result.body).not.toContain("government.ru");
    expect(result.body).not.toContain("2026-08-24");
    expect(result.body).not.toContain("common-area-cleaning");
    expect(serializedModule).not.toContain("actionPlan");
    expect(serializedModule).not.toContain("remedyActions");
  });

  it("учитывает cleaning module в максимальном budget и применяет не более одного модуля", () => {
    const specificModules = [
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
      COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
      COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
      COMMON_AREA_ROOF_LEGAL_BASIS_MODULE,
      COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
    ];
    const expectedMaximumSpecificLength = Math.max(
      ...specificModules.map((module) => module.paragraphs.join("\n\n").length),
    );
    const result = renderPrimaryRequestDraft(createCleaningDraft(), CONFIRMED_CLEANING_INPUT);

    expect(primaryRequestLegalBasisLimits.maximumBlockLength).toBe(
      COMMON_LEGAL_BASIS_BLOCK.length + "\n\n".length + expectedMaximumSpecificLength,
    );
    expect(result.body.length).toBeLessThanOrEqual(generateRequestLimits.result.bodyMax);
    expect(specificModules.filter((module) => result.body.includes(module.paragraphs[0]))).toEqual([
      COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
    ]);
  });
});

describe("нормативный модуль кровли многоквартирного дома", () => {
  const paragraph =
    "Крыша многоквартирного дома относится к общему имуществу. По постановлению Правительства РФ от 13.08.2006 № 491 общее имущество должно содержаться в состоянии, обеспечивающем соблюдение характеристик надёжности и безопасности многоквартирного дома и безопасность для жизни и здоровья граждан.";

  function createRoofDraft(overrides: Partial<PrimaryRequestDraft> = {}): PrimaryRequestDraft {
    return createDraft({
      title: "Проблема с кровлей дома",
      problem: ROOF_INPUT.description,
      subject: ROOF_SUBJECT,
      actionPlan: {
        preliminaryCheck: "Проверить состояние кровли",
        remedyActions: ["Устранить выявленное нарушение"],
        resultCheck: null,
      },
      ...overrides,
    });
  }

  it("хранит стабильный id, точный текст, применимость и metadata первичного источника", () => {
    expect(COMMON_AREA_ROOF_LEGAL_BASIS_MODULE).toEqual({
      id: "common-area-roof",
      applicability: {
        subject: "common_area_roof",
        requiresExplicitUserConfirmation: true,
        requiresVerifiedInputEvidence: true,
        limitation:
          "Только явно подтверждённая проблема крыши или кровли многоквартирного дома. Протечка, мокрый потолок, пятно или сырость без установленного пользователем источника воды не подтверждают применимость модуля.",
      },
      paragraphs: [paragraph],
      sources: [
        {
          id: "ru-government-decree-491-common-property-rules",
          title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
          officialUrl: "https://government.ru/docs/all/57158/",
          provisions: ["подпункт «б» пункта 2", "подпункты «а» и «б» пункта 10"],
          edition: "с изменениями от 07.03.2025 № 293",
          validThrough: "2027-12-31",
        },
      ],
      verifiedAt: "2026-08-17",
    });
  });

  it("добавляет специальный абзац ровно один раз между общими основаниями и просьбой", () => {
    const result = renderPrimaryRequestDraft(createRoofDraft(), ROOF_INPUT);

    expect(result.body.split(paragraph)).toHaveLength(2);
    expect(result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK)).toBeLessThan(
      result.body.indexOf(paragraph),
    );
    expect(result.body.indexOf(paragraph)).toBeLessThan(result.body.indexOf("Прошу:"));
  });

  it.each([
    ["без явного подтверждения", { description: ROOF_INPUT.description }],
    [
      "при несовпадении подтверждения",
      {
        description: ROOF_INPUT.description,
        confirmedProblemSubject: "common_area_premises_cleaning" as const,
      },
    ],
    [
      "при несовпавшей дословной цитате",
      {
        description: "На крыше многоквартирного дома требуется проверка.",
        confirmedProblemSubject: "common_area_roof" as const,
      },
    ],
  ])("не подключает модуль %s", (_caseName, input) => {
    const result = renderPrimaryRequestDraft(createRoofDraft(), input);

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it.each([
    "На потолке мокрое пятно.",
    "С потолка капает вода.",
    "После дождя появилась сырость.",
  ])("не подключает модуль при неподтверждённом источнике воды: %s", (description) => {
    const result = renderPrimaryRequestDraft(
      createRoofDraft({ problem: description, subject: null }),
      { description, confirmedProblemSubject: "common_area_roof" },
    );

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не считает LLM subject достаточным без подтверждения пользователя", () => {
    const result = renderPrimaryRequestDraft(createRoofDraft());

    expect(result.body).not.toContain(paragraph);
  });

  it("не выводит URL, metadata, причины протечки и процедурные действия из модуля", () => {
    const result = renderPrimaryRequestDraft(createRoofDraft(), ROOF_INPUT);
    const serializedModule = JSON.stringify(COMMON_AREA_ROOF_LEGAL_BASIS_MODULE);

    expect(result.body).not.toContain("government.ru");
    expect(result.body).not.toContain("2026-08-17");
    expect(result.body).not.toContain("common-area-roof");
    expect(paragraph).not.toContain("повреждение кровельного покрытия");
    expect(paragraph).not.toContain("водосток");
    expect(paragraph).not.toContain("способ ремонта");
    expect(serializedModule).not.toContain("actionPlan");
    expect(serializedModule).not.toContain("remedyActions");
    expect(serializedModule).not.toContain("03.04.2013 № 290");
  });

  it("учитывает roof module в максимальном legal basis budget без изменения bodyMax", () => {
    const specificModules = [
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
      COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
      COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
      COMMON_AREA_ROOF_LEGAL_BASIS_MODULE,
      COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
    ];
    const expectedMaximumSpecificLength = Math.max(
      ...specificModules.map((module) => module.paragraphs.join("\n\n").length),
    );

    expect(primaryRequestLegalBasisLimits.maximumBlockLength).toBe(
      COMMON_LEGAL_BASIS_BLOCK.length + "\n\n".length + expectedMaximumSpecificLength,
    );
    expect(
      renderPrimaryRequestDraft(createRoofDraft(), ROOF_INPUT).body.length,
    ).toBeLessThanOrEqual(generateRequestLimits.result.bodyMax);
  });
});

describe("нормативный модуль вентиляции общего имущества", () => {
  const paragraph =
    "Оборудование системы вентиляции, находящееся в многоквартирном доме и обслуживающее более одного помещения, относится к общему имуществу. По постановлению Правительства РФ от 13.08.2006 № 491 такое общее имущество должно содержаться в состоянии, обеспечивающем соблюдение характеристик надёжности и безопасности дома, а его содержание включает осмотр для своевременного выявления несоответствий установленным требованиям.";

  function createVentilationDraft(
    overrides: Partial<PrimaryRequestDraft> = {},
  ): PrimaryRequestDraft {
    return createDraft({
      title: "Проблема с общедомовой вентиляцией",
      problem: VENTILATION_INPUT.description,
      subject: VENTILATION_SUBJECT,
      actionPlan: {
        preliminaryCheck: "Проверить состояние общедомовой вентиляции",
        remedyActions: ["Восстановить работоспособность общедомовой вентиляции"],
        resultCheck: null,
      },
      ...overrides,
    });
  }

  it("хранит стабильный id, точный текст, применимость и metadata первичного источника", () => {
    expect(COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE).toEqual({
      id: "common-area-ventilation",
      applicability: {
        subject: "common_area_ventilation",
        requiresExplicitUserConfirmation: true,
        requiresVerifiedInputEvidence: true,
        limitation:
          "Только система вентиляции или её элементы, входящие в состав общего имущества многоквартирного дома и обслуживающие более одного помещения. Не применяется к вентиляции внутри одной квартиры, дымовым каналам, газовому оборудованию и симптомам без прямо подтверждённой связи с вентиляцией.",
      },
      paragraphs: [paragraph],
      sources: [
        {
          id: "ru-government-decree-491-common-property-rules",
          title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
          officialUrl: "https://government.ru/docs/all/57158/",
          provisions: ["подпункт «д» пункта 2", "подпункт «а» пункта 10", "подпункт «а» пункта 11"],
          edition: "с изменениями от 07.03.2025 № 293",
          validThrough: "2027-12-31",
        },
      ],
      verifiedAt: "2026-08-17",
    });
  });

  it("добавляет специальный абзац ровно один раз между общими основаниями и просьбой", () => {
    const result = renderPrimaryRequestDraft(createVentilationDraft(), VENTILATION_INPUT);

    expect(result.body.split(paragraph)).toHaveLength(2);
    expect(result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK)).toBeLessThan(
      result.body.indexOf(paragraph),
    );
    expect(result.body.indexOf(paragraph)).toBeLessThan(result.body.indexOf("Прошу:"));
  });

  it.each([
    ["без явного подтверждения", { description: VENTILATION_INPUT.description }],
    [
      "при несовпадении подтверждения",
      {
        description: VENTILATION_INPUT.description,
        confirmedProblemSubject: "common_area_roof" as const,
      },
    ],
    [
      "при несовпавшей дословной цитате",
      {
        description: "Система вентиляции помещения общего пользования требует проверки.",
        confirmedProblemSubject: "common_area_ventilation" as const,
      },
    ],
  ])("не подключает модуль %s", (_caseName, input) => {
    const result = renderPrimaryRequestDraft(createVentilationDraft(), input);

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it.each([
    "В подъезде душно.",
    "В общем коридоре очень жарко.",
    "В холле появился запах.",
    "На лестничной площадке высокая влажность.",
  ])("не подключает модуль по одному симптому: %s", (description) => {
    const result = renderPrimaryRequestDraft(
      createVentilationDraft({ problem: description, subject: null }),
      { description, confirmedProblemSubject: "common_area_ventilation" },
    );

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не считает LLM subject достаточным без подтверждения пользователя", () => {
    const result = renderPrimaryRequestDraft(createVentilationDraft());

    expect(result.body).not.toContain(paragraph);
  });

  it("не подключает модуль для несвязанного или внутриквартирного сценария", () => {
    for (const description of [
      "В квартире не работает вытяжной вентилятор.",
      "На лестничной площадке не работает освещение.",
    ]) {
      const result = renderPrimaryRequestDraft(
        createVentilationDraft({ problem: description, subject: null }),
        { description, confirmedProblemSubject: "common_area_ventilation" },
      );

      expect(result.body).not.toContain(paragraph);
      expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
    }
  });

  it("не выводит URL, metadata, диагностику и процедурные действия из модуля", () => {
    const result = renderPrimaryRequestDraft(createVentilationDraft(), VENTILATION_INPUT);
    const serializedModule = JSON.stringify(COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE);

    expect(result.body).not.toContain("government.ru");
    expect(result.body).not.toContain("2026-08-17");
    expect(result.body).not.toContain("common-area-ventilation");
    expect(paragraph).not.toContain("засор");
    expect(paragraph).not.toContain("дефект");
    expect(paragraph).not.toContain("воздухообмен");
    expect(serializedModule).not.toContain("actionPlan");
    expect(serializedModule).not.toContain("remedyActions");
    expect(serializedModule).not.toContain("03.04.2013 № 290");
  });

  it("учитывает ventilation module в максимальном budget и применяет не более одного модуля", () => {
    const specificModules = [
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
      COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
      COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
      COMMON_AREA_ROOF_LEGAL_BASIS_MODULE,
      COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
    ];
    const expectedMaximumSpecificLength = Math.max(
      ...specificModules.map((module) => module.paragraphs.join("\n\n").length),
    );
    const result = renderPrimaryRequestDraft(createVentilationDraft(), VENTILATION_INPUT);

    expect(primaryRequestLegalBasisLimits.maximumBlockLength).toBe(
      COMMON_LEGAL_BASIS_BLOCK.length + "\n\n".length + expectedMaximumSpecificLength,
    );
    expect(result.body.length).toBeLessThanOrEqual(generateRequestLimits.result.bodyMax);
    expect(specificModules.filter((module) => result.body.includes(module.paragraphs[0]))).toEqual([
      COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
    ]);
  });
});

describe("нормативный модуль лифта общего имущества", () => {
  const paragraph =
    "Лифты и лифтовые шахты входят в состав общего имущества многоквартирного дома. Такое имущество должно содержаться в состоянии, обеспечивающем надёжность и безопасность дома и безопасность для жизни и здоровья граждан.";

  function createElevatorDraft(overrides: Partial<PrimaryRequestDraft> = {}): PrimaryRequestDraft {
    return createDraft({
      title: "Лифт не реагирует на вызов",
      problem: ELEVATOR_INPUT.description,
      subject: ELEVATOR_SUBJECT,
      actionPlan: {
        preliminaryCheck: "Проверить работу лифта",
        remedyActions: ["Восстановить работоспособность лифта"],
        resultCheck: null,
      },
      ...overrides,
    });
  }

  it("хранит стабильный id, точный текст, применимость и metadata первичного источника", () => {
    expect(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE).toEqual({
      id: "common-area-elevator",
      applicability: {
        subject: "common_area_elevator",
        requiresExplicitUserConfirmation: true,
        requiresVerifiedInputEvidence: true,
        limitation:
          "Только явно подтверждённая пользователем проблема лифта, лифтовой шахты или лифтового оборудования, относящегося к общему имуществу МКД. Не устанавливает техническую причину, неисправность, аварийность, необходимость работ или их исполнителя.",
      },
      paragraphs: [paragraph],
      sources: [
        {
          id: "ru-government-decree-491-common-property-rules",
          title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
          officialUrl: "https://government.ru/docs/all/57158/",
          provisions: ["подпункт «а» пункта 2", "подпункты «а» и «б» пункта 10"],
          edition: "с изменениями от 07.03.2025 № 293",
          validThrough: "2027-12-31",
        },
      ],
      verifiedAt: "2026-08-17",
    });
  });

  it("добавляет специальный абзац ровно один раз между общими основаниями и просьбой", () => {
    const result = renderPrimaryRequestDraft(createElevatorDraft(), ELEVATOR_INPUT);

    expect(result.body.split(paragraph)).toHaveLength(2);
    expect(result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK)).toBeLessThan(
      result.body.indexOf(paragraph),
    );
    expect(result.body.indexOf(paragraph)).toBeLessThan(result.body.indexOf("Прошу:"));
  });

  it("выбирает elevator module для подтверждённого индикатора с проверяемым evidence", () => {
    const input = {
      description: "На первом этаже не работает индикатор положения лифта.",
      location: "второй подъезд",
      consequences: "Из-за этого не видно, на каком этаже находится лифт.",
      desiredActions: "Восстановить работу индикатора.",
      confirmedProblemSubject: "common_area_elevator" as const,
    };
    const subject = {
      kind: "common_area_elevator" as const,
      evidence: [{ sourceField: "description" as const, quote: input.description }],
    };

    expect(evaluateSpecificLegalBasisSelection(subject, input)).toEqual({
      status: "applied",
      module: COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
    });
    expect(renderPrimaryRequestDraft(createElevatorDraft({ subject }), input).body).toContain(
      paragraph,
    );
  });

  it.each([
    ["input_unavailable", ELEVATOR_SUBJECT, undefined],
    ["confirmation_absent", ELEVATOR_SUBJECT, { description: ELEVATOR_INPUT.description }],
    ["subject_absent", null, ELEVATOR_INPUT],
    [
      "subject_kind_mismatch",
      ELEVATOR_SUBJECT,
      {
        description: ELEVATOR_INPUT.description,
        confirmedProblemSubject: "common_area_roof" as const,
      },
    ],
    [
      "evidence_unverifiable",
      ELEVATOR_SUBJECT,
      {
        description: "Лифт в подъезде остановился между этажами.",
        confirmedProblemSubject: "common_area_elevator" as const,
      },
    ],
  ])("диагностирует неприменение без пользовательского текста: %s", (status, subject, input) => {
    const selection = evaluateSpecificLegalBasisSelection(subject, input);

    expect(selection).toEqual({ status });
    expect(JSON.stringify(selection)).not.toContain(ELEVATOR_INPUT.description);
  });

  it.each([
    ["без явного подтверждения", { description: ELEVATOR_INPUT.description }],
    [
      "при несовпадении подтверждения",
      {
        description: ELEVATOR_INPUT.description,
        confirmedProblemSubject: "common_area_roof" as const,
      },
    ],
    [
      "при несовпавшей дословной цитате",
      {
        description: "Лифт в подъезде остановился между этажами.",
        confirmedProblemSubject: "common_area_elevator" as const,
      },
    ],
  ])("не подключает модуль %s", (_caseName, input) => {
    const result = renderPrimaryRequestDraft(createElevatorDraft(), input);

    expect(result.body).not.toContain(paragraph);
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("не подключает модуль, когда provider вернул null", () => {
    const result = renderPrimaryRequestDraft(
      createElevatorDraft({ subject: null }),
      ELEVATOR_INPUT,
    );

    expect(result.body).not.toContain(paragraph);
  });

  it.each([
    "В подъезде слышен скрежет.",
    "В лифтовом холле не работает освещение.",
    "На лестничной площадке слышен шум.",
  ])("не подключает модуль по косвенному или несвязанному признаку: %s", (description) => {
    const result = renderPrimaryRequestDraft(
      createElevatorDraft({ problem: description, subject: null }),
      { description, confirmedProblemSubject: "common_area_elevator" },
    );

    expect(result.body).not.toContain(paragraph);
  });

  it("не выводит URL, metadata, диагностику или процедурные действия из модуля", () => {
    const result = renderPrimaryRequestDraft(createElevatorDraft(), ELEVATOR_INPUT);
    const serializedModule = JSON.stringify(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE);

    expect(result.body).not.toContain("government.ru");
    expect(result.body).not.toContain("2026-08-17");
    expect(result.body).not.toContain("common-area-elevator");
    expect(paragraph).not.toContain("неисправность");
    expect(paragraph).not.toContain("аварийность");
    expect(paragraph).not.toContain("ремонт");
    expect(serializedModule).not.toContain("actionPlan");
    expect(serializedModule).not.toContain("29.12.2025 № 564-ФЗ");
  });

  it("учитывает elevator module в максимальном budget и применяет не более одного модуля", () => {
    const specificModules = [
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
      COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
      COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
      COMMON_AREA_ROOF_LEGAL_BASIS_MODULE,
      COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
    ];
    const expectedMaximumSpecificLength = Math.max(
      ...specificModules.map((module) => module.paragraphs.join("\n\n").length),
    );
    const result = renderPrimaryRequestDraft(createElevatorDraft(), ELEVATOR_INPUT);

    expect(primaryRequestLegalBasisLimits.maximumBlockLength).toBe(
      COMMON_LEGAL_BASIS_BLOCK.length + "\n\n".length + expectedMaximumSpecificLength,
    );
    expect(result.body.length).toBeLessThanOrEqual(generateRequestLimits.result.bodyMax);
    expect(specificModules.filter((module) => result.body.includes(module.paragraphs[0]))).toEqual([
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
    ]);
  });
});
