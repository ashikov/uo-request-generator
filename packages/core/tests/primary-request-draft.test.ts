import { describe, expect, it } from "vitest";
import {
  COMMON_LEGAL_BASIS_BLOCK,
  generateRequestLimits,
  primaryRequestDraftLimits,
  primaryRequestDraftSchema,
  renderPrimaryRequestDraft,
  type PrimaryRequestDraft,
} from "../src";
import {
  assumedCauseDraft,
  detailedEntranceDoorDraft,
  diagnosticActionSeparatedFromRemedyDraft,
  explicitPreliminaryCheckDraft,
  explicitResultCheckDraft,
  functionalDoorDraft,
  leakingCeilingDraft,
  minimalEntranceDoorDraft,
} from "./primary-request-draft.fixtures.js";

const HOUSING_CODE_BASIS =
  "В соответствии с частями 1 и 2.3 статьи 161 Жилищного кодекса РФ управление многоквартирным домом должно обеспечивать благоприятные и безопасные условия проживания граждан, а управляющая организация несёт ответственность за надлежащее содержание общего имущества.";
const MANAGEMENT_RULES_BASIS =
  "Подпункт «з» пункта 4 Правил осуществления деятельности по управлению многоквартирными домами, утверждённых постановлением Правительства РФ от 15.05.2013 № 416, предусматривает приём и рассмотрение заявок, предложений и обращений собственников и пользователей помещений.";
const BODY_LIMIT_INPUT = { description: "а".repeat(10), isCommonAreaDoor: true };
const BODY_LIMIT_SUBJECT: Exclude<PrimaryRequestDraft["subject"], null> = {
  kind: "common_area_entrance_door",
  evidence: [{ sourceField: "description", quote: BODY_LIMIT_INPUT.description }],
};

function createDraft(overrides: Partial<PrimaryRequestDraft> = {}): PrimaryRequestDraft {
  return {
    title: "Не работает освещение",
    problem: "В общем коридоре не работает освещение.",
    circumstances: null,
    impact: null,
    verification: null,
    subject: null,
    actionPlan: {
      preliminaryCheck: null,
      remedyActions: ["Восстановить освещение"],
      resultCheck: null,
    },
    warnings: [],
    ...overrides,
  };
}

function buildDraftAtBodyLimit(): PrimaryRequestDraft {
  let draft = createDraft({
    problem: "а",
    circumstances: "б",
    impact: "в",
    verification: "г",
    subject: BODY_LIMIT_SUBJECT,
    actionPlan: {
      preliminaryCheck: "д",
      remedyActions: ["е", "ж", "з"],
      resultCheck: "и",
    },
  });
  let remaining =
    generateRequestLimits.result.bodyMax -
    renderPrimaryRequestDraft(draft, BODY_LIMIT_INPUT).body.length;
  const stringFields = ["problem", "circumstances", "impact", "verification"] as const;

  for (const field of stringFields) {
    const max = primaryRequestDraftLimits[field].max;
    const addition = Math.min(remaining, max - 1);
    draft = { ...draft, [field]: `${draft[field] ?? ""}${"а".repeat(addition)}` };
    remaining -= addition;
  }

  const actionPlan = {
    ...draft.actionPlan,
    remedyActions: [...draft.actionPlan.remedyActions],
  };
  for (const field of ["preliminaryCheck", "resultCheck"] as const) {
    const value = actionPlan[field] ?? "";
    const addition = Math.min(remaining, primaryRequestDraftLimits.action.max - value.length);
    actionPlan[field] = `${value}${"а".repeat(addition)}`;
    remaining -= addition;
  }

  for (let index = 0; index < actionPlan.remedyActions.length && remaining > 0; index += 1) {
    const action = actionPlan.remedyActions[index] ?? "";
    const addition = Math.min(remaining, primaryRequestDraftLimits.action.max - action.length);
    actionPlan.remedyActions[index] = `${action}${"а".repeat(addition)}`;
    remaining -= addition;
  }

  expect(remaining).toBe(0);
  return { ...draft, actionPlan };
}

describe("primaryRequestDraftSchema", () => {
  it("принимает строгий расширенный черновик со всеми смысловыми ролями", () => {
    const result = primaryRequestDraftSchema.safeParse(detailedEntranceDoorDraft);

    expect(result.success).toBe(true);
    expect(Object.keys(result.success ? result.data : {})).toEqual([
      "title",
      "problem",
      "circumstances",
      "impact",
      "verification",
      "subject",
      "actionPlan",
      "warnings",
    ]);
  });

  it("требует явные nullable-роли и отклоняет лишние поля", () => {
    const missingCircumstances = { ...minimalEntranceDoorDraft };
    Reflect.deleteProperty(missingCircumstances, "circumstances");

    expect(primaryRequestDraftSchema.safeParse(missingCircumstances).success).toBe(false);
    expect(
      primaryRequestDraftSchema.safeParse({
        ...minimalEntranceDoorDraft,
        legalBasis: "Нормативный текст",
      }).success,
    ).toBe(false);
  });

  it("строго отклоняет legacy-поля inspection и actions без compatibility fallback", () => {
    const legacyActionPlanDraft = {
      ...minimalEntranceDoorDraft,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Установить ручку на входную дверь"],
        resultCheck: null,
        inspection: null,
        actions: ["Установить ручку на входную дверь"],
      },
    };

    expect(primaryRequestDraftSchema.safeParse(legacyActionPlanDraft).success).toBe(false);
  });

  it("отделяет нормативный блок от структуры и синтетических данных черновика", () => {
    const parsedDraft = primaryRequestDraftSchema.parse(detailedEntranceDoorDraft);
    const serializedFixtures = JSON.stringify([
      detailedEntranceDoorDraft,
      minimalEntranceDoorDraft,
      assumedCauseDraft,
    ]);

    expect(Object.keys(parsedDraft)).not.toContain("legalBasis");
    expect(serializedFixtures).not.toContain(COMMON_LEGAL_BASIS_BLOCK);
    expect(serializedFixtures).not.toContain("http://");
    expect(serializedFixtures).not.toContain("https://");
  });

  it.each([
    ["title", "title", primaryRequestDraftLimits.title.max],
    ["problem", "problem", primaryRequestDraftLimits.problem.max],
    ["circumstances", "circumstances", primaryRequestDraftLimits.circumstances.max],
    ["impact", "impact", primaryRequestDraftLimits.impact.max],
    ["verification", "verification", primaryRequestDraftLimits.verification.max],
  ] as const)("принимает %s на точном лимите и отклоняет превышение", (_name, field, max) => {
    const otherFields =
      field === "problem"
        ? {
            circumstances: null,
            impact: null,
            verification: null,
            actionPlan: { preliminaryCheck: null, remedyActions: ["."], resultCheck: null },
          }
        : {};
    const exact = createDraft({ ...otherFields, [field]: `${"а".repeat(max - 1)}.` });
    const tooLong = createDraft({ ...otherFields, [field]: "а".repeat(max + 1) });

    expect(primaryRequestDraftSchema.safeParse(exact).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(tooLong).success).toBe(false);
  });

  it("проверяет точный лимит процедурного действия и предупреждения", () => {
    expect(
      primaryRequestDraftSchema.safeParse(
        createDraft({
          actionPlan: {
            preliminaryCheck: "а".repeat(primaryRequestDraftLimits.action.max),
            remedyActions: ["б".repeat(primaryRequestDraftLimits.action.max)],
            resultCheck: "в".repeat(primaryRequestDraftLimits.action.max),
          },
          warnings: ["б".repeat(primaryRequestDraftLimits.warning.max)],
        }),
      ).success,
    ).toBe(true);
    expect(
      primaryRequestDraftSchema.safeParse(
        createDraft({
          actionPlan: {
            preliminaryCheck: null,
            remedyActions: ["а".repeat(primaryRequestDraftLimits.action.max + 1)],
            resultCheck: null,
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      primaryRequestDraftSchema.safeParse(
        createDraft({
          actionPlan: {
            preliminaryCheck: "а".repeat(primaryRequestDraftLimits.action.max + 1),
            remedyActions: ["Восстановить освещение"],
            resultCheck: null,
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      primaryRequestDraftSchema.safeParse(
        createDraft({
          actionPlan: {
            preliminaryCheck: null,
            remedyActions: ["Восстановить освещение"],
            resultCheck: "а".repeat(primaryRequestDraftLimits.action.max + 1),
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      primaryRequestDraftSchema.safeParse(
        createDraft({ warnings: ["а".repeat(primaryRequestDraftLimits.warning.max + 1)] }),
      ).success,
    ).toBe(false);
  });

  it("принимает от одного до пяти итоговых пунктов и отклоняет шестой без усечения", () => {
    const oneRequest = createDraft({
      actionPlan: { preliminaryCheck: null, remedyActions: ["Одно действие"], resultCheck: null },
    });
    const fiveRequests = createDraft({
      actionPlan: {
        preliminaryCheck: "Предварительная проверка",
        remedyActions: ["Первое действие", "Второе действие", "Третье действие"],
        resultCheck: "Проверка результата",
      },
    });
    const sixRequests = createDraft({
      actionPlan: {
        preliminaryCheck: "Предварительная проверка",
        remedyActions: ["Первое", "Второе", "Третье", "Четвёртое"],
        resultCheck: "Проверка результата",
      },
    });

    expect(primaryRequestDraftSchema.safeParse(oneRequest).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(fiveRequests).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(sixRequests).success).toBe(false);
    expect([
      sixRequests.actionPlan.preliminaryCheck,
      ...sixRequests.actionPlan.remedyActions,
      sixRequests.actionPlan.resultCheck,
    ]).toHaveLength(6);
  });

  it("принимает пять предупреждений и отклоняет шестое", () => {
    const fiveWarnings = createDraft({
      warnings: Array.from({ length: 5 }, (_, index) => `Предупреждение ${index + 1}`),
    });
    const sixWarnings = createDraft({
      warnings: Array.from({ length: 6 }, (_, index) => `Предупреждение ${index + 1}`),
    });

    expect(primaryRequestDraftSchema.safeParse(fiveWarnings).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(sixWarnings).success).toBe(false);
  });

  it.each([
    ["problem", { problem: "Не работает\nосвещение" }],
    ["circumstances", { circumstances: "Дверь открыта\r\nи закреплена" }],
    ["impact", { impact: "Проход\nзатруднён" }],
    ["verification", { verification: "Проверить\rдоводчик" }],
    [
      "preliminaryCheck",
      {
        actionPlan: {
          preliminaryCheck: "Проверить\nосвещение",
          remedyActions: ["Восстановить освещение"],
          resultCheck: null,
        },
      },
    ],
    [
      "remedyActions",
      {
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Проверить\nосвещение"],
          resultCheck: null,
        },
      },
    ],
    [
      "resultCheck",
      {
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Восстановить освещение"],
          resultCheck: "Проверить\nрезультат",
        },
      },
    ],
    ["warnings", { warnings: ["Не указано\nвремя"] }],
  ])("отклоняет перевод строки в поле %s", (_field, overrides) => {
    expect(primaryRequestDraftSchema.safeParse(createDraft(overrides)).success).toBe(false);
  });

  it("принимает body ровно на итоговом лимите и отклоняет превышение на символ", () => {
    const exact = buildDraftAtBodyLimit();
    const tooLong = {
      ...exact,
      verification: `${exact.verification ?? ""}а`,
    };

    expect(renderPrimaryRequestDraft(exact, BODY_LIMIT_INPUT).body).toHaveLength(
      generateRequestLimits.result.bodyMax,
    );
    expect(primaryRequestDraftSchema.safeParse(tooLong).success).toBe(false);
    expect(() => renderPrimaryRequestDraft(tooLong)).toThrow();
  });
});

describe("renderPrimaryRequestDraft", () => {
  it("собирает подробную заявку в стабильном порядке без домысливания", () => {
    const result = renderPrimaryRequestDraft(detailedEntranceDoorDraft);
    const problemPosition = result.body.indexOf(detailedEntranceDoorDraft.problem);
    const circumstancesPosition = result.body.indexOf(
      detailedEntranceDoorDraft.circumstances ?? "",
    );
    const impactPosition = result.body.indexOf(detailedEntranceDoorDraft.impact ?? "");
    const legalPosition = result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK);
    const requestBlockPosition = result.body.indexOf("Прошу:");

    expect(problemPosition).toBeLessThan(circumstancesPosition);
    expect(circumstancesPosition).toBeLessThan(impactPosition);
    expect(impactPosition).toBeLessThan(legalPosition);
    expect(legalPosition).toBeLessThan(requestBlockPosition);
    expect(result.body).toContain("дверь оставляют открытой");
    expect(result.body).toContain("фиксируют ограничителем");
    expect(result.body).toContain("дополнительную нагрузку на доводчик");
    expect(result.body).not.toContain("доводчик повреждён");
    expect(detailedEntranceDoorDraft.actionPlan).toEqual({
      preliminaryCheck:
        "Проверить состояние доводчика, ограничителя, креплений двери и связанных элементов",
      remedyActions: ["Установить и закрепить ручку на входной двери"],
      resultCheck: "После работ проверить нормальное открывание и закрывание двери",
    });
    expect(result.body).toContain(
      "Прошу:\n1. Проверить состояние доводчика, ограничителя, креплений двери и связанных элементов",
    );
    expect(result.body).toContain("2. Установить и закрепить ручку на входной двери");
    expect(result.body).toContain(
      "3. После работ проверить нормальное открывание и закрывание двери",
    );
    expect(result.body).not.toContain("Устранить выявленные повреждения");
    expect(result.body).not.toContain("preliminaryCheck");
    expect(result.body).not.toContain("resultCheck");
    expect(result.body).not.toContain("actionPlan");
    expect(result.warnings).toEqual([]);
  });

  it("не добавляет отсутствующие подробности в минимальный результат", () => {
    const result = renderPrimaryRequestDraft(minimalEntranceDoorDraft);

    expect(result.body).toContain(minimalEntranceDoorDraft.problem);
    expect(result.body).not.toContain("открыт");
    expect(result.body).not.toContain("ограничител");
    expect(result.body).not.toContain("нагрузк");
    expect(result.body).not.toContain("доводчик");
    expect(result.body).not.toContain("поврежден");
  });

  it("сохраняет предполагаемую причину только как предмет проверки", () => {
    const result = renderPrimaryRequestDraft(assumedCauseDraft);

    expect(result.body).toContain("Предполагаемая неисправность доводчика не установлена");
    expect(result.body).not.toContain("Причиной является неисправность доводчика");
  });

  it("формирует полный процедурный набор для неизвестного источника протечки", () => {
    const result = renderPrimaryRequestDraft(leakingCeilingDraft);

    expect(leakingCeilingDraft.actionPlan).toEqual({
      preliminaryCheck: "Установить источник поступления воды",
      remedyActions: ["Устранить причину протечки"],
      resultCheck: "После работ проверить прекращение поступления воды",
    });
    expect(result.body).toContain("Прошу:\n1. Установить источник поступления воды");
    expect(result.body).toContain("2. Устранить причину протечки");
    expect(result.body).toContain("3. После работ проверить прекращение поступления воды");
    for (const inventedFact of [
      "крыша",
      "труба",
      "квартира",
      "ремонт потолка",
      "плесень",
      "короткое замыкание",
      "разрушение конструкций",
    ]) {
      expect(result.body.toLocaleLowerCase("ru")).not.toContain(inventedFact);
    }
  });

  it("оставляет простой отсутствующий элемент одним действием", () => {
    const result = renderPrimaryRequestDraft(minimalEntranceDoorDraft);

    expect(minimalEntranceDoorDraft.actionPlan).toEqual({
      preliminaryCheck: null,
      remedyActions: ["Установить ручку на входную дверь"],
      resultCheck: null,
    });
    expect(result.body).toContain("Прошу:\n1. Установить ручку на входную дверь");
    expect(result.body).not.toContain("\n2. ");
    expect(minimalEntranceDoorDraft.actionPlan.preliminaryCheck).toBeNull();
    expect(minimalEntranceDoorDraft.actionPlan.resultCheck).toBeNull();
    for (const inventedDetail of [
      "креплен",
      "тип ручки",
      "диагност",
      "проверить работу",
      "проверить открывание",
      "проверить закрывание",
    ]) {
      expect(result.body.toLocaleLowerCase("ru")).not.toContain(inventedDetail);
    }
  });

  it("допускает проверку результата функционального дефекта без обязательной диагностики", () => {
    const result = renderPrimaryRequestDraft(functionalDoorDraft);

    expect(functionalDoorDraft.actionPlan).toEqual({
      preliminaryCheck: null,
      remedyActions: ["Устранить неисправность двери и восстановить её полное закрывание"],
      resultCheck: "После работ проверить полное закрывание двери",
    });
    expect(result.body).toContain(
      "1. Устранить неисправность двери и восстановить её полное закрывание",
    );
    expect(result.body).toContain("2. После работ проверить полное закрывание двери");
    expect(result.body).not.toContain("доводчик");
    expect(result.body).not.toContain("петл");
    expect(result.body).not.toContain("замок");
    expect(result.body).not.toContain("ручк");
  });

  it("сохраняет явно заданную предварительную проверку", () => {
    const result = renderPrimaryRequestDraft(explicitPreliminaryCheckDraft);

    expect(result.body).toContain("1. Проверить наличие напряжения в светильнике");
    expect(result.body).toContain("2. Восстановить освещение в общем коридоре");
  });

  it("сохраняет явно заданную проверку результата простого действия", () => {
    const result = renderPrimaryRequestDraft(explicitResultCheckDraft);

    expect(result.body).toContain("1. Закрепить крышку почтового ящика");
    expect(result.body).toContain("2. После работ проверить надёжность крепления крышки");
  });

  it("отделяет предварительную диагностику от прямого восстановления", () => {
    const result = renderPrimaryRequestDraft(diagnosticActionSeparatedFromRemedyDraft);

    expect(diagnosticActionSeparatedFromRemedyDraft.actionPlan.preliminaryCheck).toBe(
      "Установить причину отсутствия освещения",
    );
    expect(diagnosticActionSeparatedFromRemedyDraft.actionPlan.remedyActions).toEqual([
      "Восстановить освещение на лестничной площадке",
    ]);
    expect(result.body).toContain(
      "1. Установить причину отсутствия освещения.\n2. Восстановить освещение на лестничной площадке.",
    );
  });

  it("полностью пропускает отсутствующие части без артефактов", () => {
    const result = renderPrimaryRequestDraft(minimalEntranceDoorDraft);

    expect(result.body).toBe(
      [
        minimalEntranceDoorDraft.problem,
        "",
        COMMON_LEGAL_BASIS_BLOCK,
        "",
        "Прошу:",
        "1. Установить ручку на входную дверь.",
      ].join("\n"),
    );
    expect(result.body).not.toContain("\n\n\n");
  });

  it.each([
    ["без завершающего знака", "Проверить состояние потолка", "Проверить состояние потолка."],
    ["с точкой", "Проверить состояние потолка.", "Проверить состояние потолка."],
    ["с восклицательным знаком", "Проверить состояние потолка!", "Проверить состояние потолка!"],
    ["с вопросительным знаком", "Проверить состояние потолка?", "Проверить состояние потолка?"],
    ["с многоточием", "Проверить состояние потолка…", "Проверить состояние потолка…"],
  ])("нормализует problem %s", (_caseName, problem, expectedProblem) => {
    const result = renderPrimaryRequestDraft(createDraft({ problem }));

    expect(result.body).toContain(expectedProblem);
  });

  it("нормализует все выводимые динамические части, сохраняя структуру заявки", () => {
    const draft = createDraft({
      title: "Не работает освещение",
      problem: "В общем коридоре не работает освещение",
      circumstances: "Неисправность проявляется вечером",
      impact: "Проход по коридору затруднён",
      verification: "Проверить работу светильников после устранения неисправности",
      actionPlan: {
        preliminaryCheck: "Проверить состояние светильников",
        remedyActions: ["Заменить неисправные элементы", "Восстановить освещение"],
        resultCheck: "Проверить освещение после работ",
      },
    });
    const result = renderPrimaryRequestDraft(draft);

    expect(result.title).toBe(draft.title);
    expect(result.body).toContain("В общем коридоре не работает освещение.");
    expect(result.body).toContain("Неисправность проявляется вечером.");
    expect(result.body).toContain("Проход по коридору затруднён.");
    expect(result.body).toContain("Проверить работу светильников после устранения неисправности.");
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
    expect(result.body).toContain(
      [
        "Прошу:",
        "1. Проверить состояние светильников.",
        "2. Заменить неисправные элементы.",
        "3. Восстановить освещение.",
        "4. Проверить освещение после работ.",
      ].join("\n"),
    );
  });

  it("учитывает добавленную пунктуацию при проверке итогового лимита body", () => {
    const requestBlock = "Прошу:\n1. а!";
    const problemLength =
      generateRequestLimits.result.bodyMax -
      COMMON_LEGAL_BASIS_BLOCK.length -
      requestBlock.length -
      "\n\n".length * 2;
    const draft = createDraft({
      problem: "а".repeat(problemLength),
      actionPlan: { preliminaryCheck: null, remedyActions: ["а!"], resultCheck: null },
    });

    expect(primaryRequestDraftSchema.safeParse(draft).success).toBe(false);
    expect(() => renderPrimaryRequestDraft(draft)).toThrow();
  });

  it("переиспользует два нормативных абзаца без URL перед нумерованными требованиями", () => {
    const result = renderPrimaryRequestDraft(detailedEntranceDoorDraft);

    expect(COMMON_LEGAL_BASIS_BLOCK).toBe(
      [HOUSING_CODE_BASIS, MANAGEMENT_RULES_BASIS].join("\n\n"),
    );
    expect(result.body.match(new RegExp(HOUSING_CODE_BASIS, "gu"))).toHaveLength(1);
    expect(result.body.match(new RegExp(MANAGEMENT_RULES_BASIS, "gu"))).toHaveLength(1);
    expect(result.body).not.toContain("http://");
    expect(result.body).not.toContain("https://");
  });

  it("сохраняет публичную форму title, body и warnings", () => {
    const result = renderPrimaryRequestDraft(
      createDraft({ warnings: ["Не указано время появления неисправности"] }),
    );

    expect(Object.keys(result)).toEqual(["title", "body", "warnings"]);
    expect(result.title).toBe("Не работает освещение");
    expect(result.warnings).toEqual(["Не указано время появления неисправности"]);
  });
});
