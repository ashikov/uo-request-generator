import {
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
  COMMON_LEGAL_BASIS_BLOCK,
  generateRequestLimits,
  primaryRequestLegalBasisLimits,
  primaryRequestDraftLimits,
  renderPrimaryRequestDraft,
  type PrimaryRequestDraft,
} from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import { detailedEntranceDoorDraft } from "../../core/tests/primary-request-draft.fixtures.js";
import {
  parseRequestDraft,
  REQUEST_DRAFT_DYNAMIC_BODY_MAX,
  REQUEST_DRAFT_JSON_SCHEMA,
  REQUEST_DRAFT_SYSTEM_PROMPT,
  type GeneratedRequestDraft,
  type RequestDraft,
} from "../src/request-draft.js";

const INVALID_RESPONSE_MESSAGE = "LLM вернул некорректный формат заявки";

function createDraft(overrides: Partial<GeneratedRequestDraft> = {}): GeneratedRequestDraft {
  return {
    outcome: "generated",
    title: "Не работает освещение",
    problem: "В общем коридоре не работает освещение уже несколько дней.",
    circumstances: null,
    impact: "В тёмное время суток проход по коридору затруднён.",
    verification: null,
    subject: null,
    actionPlan: {
      preliminaryCheck: null,
      remedyActions: ["Проверить и восстановить освещение"],
      resultCheck: null,
    },
    warnings: [],
    ...overrides,
  };
}

function createMultipleIssuesDraft(): Extract<RequestDraft, { outcome: "multiple_issues" }> {
  return {
    outcome: "multiple_issues",
    title: null,
    problem: null,
    circumstances: null,
    impact: null,
    verification: null,
    subject: null,
    actionPlan: null,
    warnings: [],
  };
}

function serializeDraft(draft: unknown): string {
  return JSON.stringify({ draft });
}

function expectInvalidResponse(draft: unknown): void {
  expect(() => parseRequestDraft(serializeDraft(draft))).toThrow(INVALID_RESPONSE_MESSAGE);
}

function expectGeneratedDraft(draft: RequestDraft): asserts draft is GeneratedRequestDraft {
  expect(draft.outcome).toBe("generated");
  if (draft.outcome !== "generated") {
    throw new Error("Ожидался черновик готовой заявки");
  }
}

function toPrimaryRequestDraft(draft: GeneratedRequestDraft): PrimaryRequestDraft {
  const { outcome: _outcome, ...primaryRequestDraft } = draft;
  return primaryRequestDraft;
}

function renderGeneratedDraft(draft: GeneratedRequestDraft) {
  return renderPrimaryRequestDraft(toPrimaryRequestDraft(draft));
}

function createDraftAtBodyLength(bodyLength: number): GeneratedRequestDraft {
  const fixedDraft = createDraft({
    problem: "а",
    circumstances: null,
    impact: null,
    verification: null,
    actionPlan: { preliminaryCheck: null, remedyActions: ["б"], resultCheck: null },
  });
  const fixedBodyLength = renderGeneratedDraft(fixedDraft).body.length;

  return createDraft({
    problem: "а".repeat(bodyLength - fixedBodyLength + 1),
    circumstances: null,
    impact: null,
    verification: null,
    actionPlan: fixedDraft.actionPlan,
  });
}

describe("REQUEST_DRAFT_SYSTEM_PROMPT", () => {
  it("распределяет все входные роли", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("description — свободное описание ситуации");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("location — отдельно переданное место");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("consequences — отдельно переданные");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("desiredActions — отдельно переданные");
  });

  it("различает конфликт места и совместимое уточнение", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("location явно противоречит");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("используй location в problem");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не объединяй несовместимые места");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не является конфликтом");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не требует warning");
  });

  it("сохраняет явные последствия и ограничивает безопасный вывод", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("consequences имеют приоритет");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не превращай риск в событие");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("скрытое повреждение");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("отсутствующее во вводе оборудование");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не более двух независимых");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("многоступенчатую причинную цепочку");
  });

  it("требует фактическое основание проверки без дублирования", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "обоснованную обстоятельствами проверку связанных элементов",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Неизвестная причина сама по себе");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не превращай неизвестную причину");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("заполняй verification только ради");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "verification только повторяет actionPlan.preliminaryCheck",
    );
  });

  it("сохраняет приоритет желаемых действий", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("desiredActions имеют приоритет");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не заменяй более общими действиями");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "раздели действие между ролями без потери смысла",
    );
  });

  it("задаёт общие процедурные роли без искусственного заполнения", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("существенное неизвестное обстоятельство");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не обязательно визуальный осмотр");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("непосредственно необходимое действие");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("а не самостоятельные диагностики или проверки");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("существенный функциональный результат");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("для простой установки или замены");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не дублируй preliminaryCheck в remedyActions");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "не заполняй procedural plan до пяти пунктов искусственно",
    );
  });

  it("оставляет multiple_issues без частичного actionPlan", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("outcome: multiple_issues");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("actionPlan: null");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не выбирай одну проблему");
  });

  it("сохраняет границу body, законодательства и URL", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не возвращай готовый body");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не выбирай и не цитируй законодательство");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_LEGAL_BASIS_BLOCK);
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain("http://");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain("https://");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.id);
    for (const source of COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.sources) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.officialUrl);
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.title);
    }
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.id);
    for (const source of COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.sources) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.officialUrl);
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.title);
    }
  });

  it("передаёт модели динамический лимит body", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      `не более ${REQUEST_DRAFT_DYNAMIC_BODY_MAX} символов`,
    );
    expect(REQUEST_DRAFT_DYNAMIC_BODY_MAX).toBe(
      primaryRequestDraftLimits.body.max -
        primaryRequestLegalBasisLimits.maximumBlockLength -
        "\n\n".length * 2,
    );
  });

  it("запрашивает только предметный факт с проверяемым evidence, а не выбор закона", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("subject описывает только предмет проблемы");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("дословных непрерывных фрагментов");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("subject: null");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не является выбором нормативного акта");
  });

  it("ограничивает lighting subject помещениями общего пользования", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("common_area_premises_lighting");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "осветительную установку внутри помещения общего пользования",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("внутри квартиры");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("придомовой территории");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("уличного или фасадного освещения");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "подтверждать и осветительную установку, и помещение общего пользования",
    );
  });

  it.each([
    "При неизвестном источнике воды используй один preliminaryCheck",
    "Для простой отсутствующей ручки",
    "Для двери, которая не закрывается",
  ])("не содержит benchmark-specific подсказку: %s", (hintPrefix) => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(hintPrefix);
  });
});

describe("provider-facing RequestDraft", () => {
  it("задаёт строгую generated-ветку по полям и лимитам PrimaryRequestDraft", () => {
    const generatedSchema = REQUEST_DRAFT_JSON_SCHEMA.properties.draft.anyOf[0];

    expect(generatedSchema.additionalProperties).toBe(false);
    expect(generatedSchema.required).toEqual([
      "outcome",
      "title",
      "problem",
      "circumstances",
      "impact",
      "verification",
      "subject",
      "actionPlan",
      "warnings",
    ]);
    expect(generatedSchema.properties).toEqual({
      outcome: { type: "string", enum: ["generated"] },
      title: {
        type: "string",
        minLength: 1,
        maxLength: primaryRequestDraftLimits.title.max,
      },
      problem: {
        type: "string",
        minLength: 1,
        maxLength: primaryRequestDraftLimits.problem.max,
      },
      circumstances: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: primaryRequestDraftLimits.circumstances.max,
      },
      impact: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: primaryRequestDraftLimits.impact.max,
      },
      verification: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: primaryRequestDraftLimits.verification.max,
      },
      subject: {
        anyOf: [
          {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["common_area_entrance_door", "common_area_premises_lighting"],
              },
              evidence: {
                type: "array",
                minItems: 1,
                maxItems: 2,
                items: {
                  type: "object",
                  properties: {
                    sourceField: {
                      type: "string",
                      enum: ["description", "location", "consequences", "desiredActions"],
                    },
                    quote: { type: "string", minLength: 10, maxLength: 300 },
                  },
                  required: ["sourceField", "quote"],
                  additionalProperties: false,
                },
              },
            },
            required: ["kind", "evidence"],
            additionalProperties: false,
          },
          { type: "null" },
        ],
      },
      actionPlan: {
        anyOf: expect.arrayContaining([
          expect.objectContaining({
            type: "object",
            additionalProperties: false,
            required: ["preliminaryCheck", "remedyActions", "resultCheck"],
          }),
        ]),
      },
      warnings: {
        type: "array",
        maxItems: primaryRequestDraftLimits.warnings.max,
        items: {
          type: "string",
          minLength: 1,
          maxLength: primaryRequestDraftLimits.warning.max,
        },
      },
    });
  });

  it("ограничивает общий размер procedural plan средствами provider JSON Schema", () => {
    const actionPlanSchemas =
      REQUEST_DRAFT_JSON_SCHEMA.properties.draft.anyOf[0].properties.actionPlan.anyOf;

    expect(actionPlanSchemas).toHaveLength(4);
    expect(
      actionPlanSchemas.map((schema) => [
        schema.properties.preliminaryCheck.type,
        schema.properties.resultCheck.type,
        schema.properties.remedyActions.maxItems,
      ]),
    ).toEqual([
      ["string", "string", 3],
      ["string", "null", 4],
      ["null", "string", 4],
      ["null", "null", 5],
    ]);

    for (const schema of actionPlanSchemas) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(["preliminaryCheck", "remedyActions", "resultCheck"]);
      expect(schema.properties.remedyActions.minItems).toBe(1);
      expect(schema.properties.remedyActions.items).toEqual({
        type: "string",
        minLength: 1,
        maxLength: primaryRequestDraftLimits.action.max,
      });
    }
  });

  it("задаёт строгую multiple_issues-ветку без частичного черновика", () => {
    const multipleIssuesSchema = REQUEST_DRAFT_JSON_SCHEMA.properties.draft.anyOf[1];

    expect(multipleIssuesSchema.additionalProperties).toBe(false);
    expect(multipleIssuesSchema.required).toEqual([
      "outcome",
      "title",
      "problem",
      "circumstances",
      "impact",
      "verification",
      "subject",
      "actionPlan",
      "warnings",
    ]);
    expect(multipleIssuesSchema.properties).toEqual({
      outcome: { type: "string", enum: ["multiple_issues"] },
      title: { type: "null" },
      problem: { type: "null" },
      circumstances: { type: "null" },
      impact: { type: "null" },
      verification: { type: "null" },
      subject: { type: "null" },
      actionPlan: { type: "null" },
      warnings: { type: "array", maxItems: 0, items: { type: "string" } },
    });
  });

  it("оставляет корневую оболочку строгой", () => {
    expect(REQUEST_DRAFT_JSON_SCHEMA).toEqual({
      type: "object",
      properties: {
        draft: {
          anyOf: expect.any(Array),
        },
      },
      required: ["draft"],
      additionalProperties: false,
    });
  });

  it("не содержит нормативной роли, законодательства, URL или готового body", () => {
    const schemaText = JSON.stringify(REQUEST_DRAFT_JSON_SCHEMA);

    for (const forbiddenFragment of [
      "legalBasis",
      "legalReferences",
      "law",
      "body",
      "Жилищн",
      "Правительств",
      "http://",
      "https://",
      COMMON_LEGAL_BASIS_BLOCK,
    ]) {
      expect(schemaText).not.toContain(forbiddenFragment);
    }
  });

  it("валидирует подробный provider-facing черновик входной двери и renderer сохраняет роли", () => {
    const draft = createDraft(detailedEntranceDoorDraft);

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);
    const result = renderGeneratedDraft(parsed);

    expect(parsed).toEqual(draft);
    expect(result.body).toContain(draft.problem);
    expect(result.body).toContain(draft.circumstances);
    expect(result.body).toContain(draft.impact);
    expect(parsed.actionPlan).toEqual({
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
    expect(result.body).not.toContain("доводчик повреждён");
    expect(result.body).not.toContain("Устранить выявленные повреждения");
  });

  it("не добавляет отсутствующие подробности в минимальный черновик входной двери", () => {
    const draft = createDraft({
      title: "Отсутствует ручка входной двери",
      problem: "У входной двери подъезда отсутствует ручка.",
      circumstances: null,
      impact: null,
      verification: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Установить ручку на входную дверь"],
        resultCheck: null,
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);
    const result = renderGeneratedDraft(parsed);

    expect(parsed.circumstances).toBeNull();
    expect(parsed.impact).toBeNull();
    expect(parsed.verification).toBeNull();
    expect(parsed.actionPlan).toEqual({
      preliminaryCheck: null,
      remedyActions: ["Установить ручку на входную дверь"],
      resultCheck: null,
    });
    expect(result.body).toContain("Прошу:\n1. Установить ручку на входную дверь");
    expect(result.body).not.toContain("\n2. ");
    for (const absentFact of [
      "открыт",
      "ограничител",
      "нагруз",
      "доводчик",
      "поврежд",
      "креплен",
      "тип ручки",
      "диагност",
      "проверить работу",
      "проверить открывание",
      "проверить закрывание",
    ]) {
      expect(result.body.toLocaleLowerCase("ru")).not.toContain(absentFact);
    }
  });

  it("сохраняет предполагаемую причину только как предмет проверки", () => {
    const draft = createDraft({
      problem: "Входная дверь закрывается не полностью.",
      circumstances: null,
      impact: null,
      verification: "Пользователь предполагает неисправность доводчика.",
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Устранить неисправность двери и восстановить её полное закрывание"],
        resultCheck: "После работ проверить полное закрывание двери",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.problem).not.toContain("неисправность доводчика");
    expect(parsed.verification).toContain("предполагает неисправность доводчика");
    expect(renderGeneratedDraft(parsed).body).toContain(parsed.verification);
  });

  it("сохраняет явный риск в impact без утверждения наступившего повреждения", () => {
    const draft = createDraft({
      problem: "Входную дверь приходится удерживать вручную.",
      circumstances: null,
      impact: "Это создаёт риск повреждения креплений двери.",
      verification: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Восстановить работу двери"],
        resultCheck: null,
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.impact).toContain("риск повреждения");
    expect(parsed.impact).not.toContain("крепления повреждены");
  });

  it("принимает impact null при отсутствии основания", () => {
    const draft = createDraft({ impact: null });

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("принимает от одного до пяти итоговых пунктов procedural plan", () => {
    for (const actionPlan of [
      { preliminaryCheck: null, remedyActions: ["Устранить неисправность"], resultCheck: null },
      {
        preliminaryCheck: "Проверить причину",
        remedyActions: ["Первое", "Второе", "Третье"],
        resultCheck: "Проверить результат",
      },
    ]) {
      expect(parseRequestDraft(serializeDraft(createDraft({ actionPlan })))).toEqual(
        createDraft({ actionPlan }),
      );
    }
  });

  it("отклоняет шестой итоговый пункт без усечения", () => {
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: "Проверить причину",
          remedyActions: ["Первое", "Второе", "Третье", "Четвёртое"],
          resultCheck: "Проверить результат",
        },
      }),
    );
  });

  it("сохраняет полный procedural plan для неизвестного источника протечки", () => {
    const draft = createDraft({
      title: "Протечка в общем коридоре",
      problem: "С потолка в общем коридоре капает вода. Источник поступления воды не установлен.",
      impact: null,
      verification: null,
      actionPlan: {
        preliminaryCheck: "Установить источник поступления воды",
        remedyActions: ["Устранить причину протечки"],
        resultCheck: "После работ проверить прекращение поступления воды",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.actionPlan).toEqual(draft.actionPlan);
    const body = renderGeneratedDraft(parsed).body;
    expect(body).toContain(
      "Прошу:\n1. Установить источник поступления воды.\n2. Устранить причину протечки.\n3. После работ проверить прекращение поступления воды.",
    );
    for (const inventedFact of [
      "крыша",
      "труба",
      "квартира",
      "ремонт потолка",
      "плесень",
      "короткое замыкание",
      "разрушение конструкций",
    ]) {
      expect(body.toLocaleLowerCase("ru")).not.toContain(inventedFact);
    }
  });

  it("сохраняет explicit preliminary check отдельно от remedy actions", () => {
    const draft = createDraft({
      problem: "Дверь в помещении общего пользования не закрывается полностью.",
      impact: null,
      actionPlan: {
        preliminaryCheck: "Проверить механизм закрывания двери",
        remedyActions: ["Отремонтировать дверь и восстановить полное закрывание"],
        resultCheck: "После ремонта проверить полное закрывание двери",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.actionPlan).toEqual(draft.actionPlan);
    expect(renderGeneratedDraft(parsed).body).toContain(
      "1. Проверить механизм закрывания двери.\n2. Отремонтировать дверь и восстановить полное закрывание.\n3. После ремонта проверить полное закрывание двери.",
    );
  });

  it("не требует предварительную проверку для двери, которая не закрывается", () => {
    const draft = createDraft({
      title: "Дверь не закрывается полностью",
      problem: "Дверь в помещении общего пользования не закрывается полностью.",
      impact: null,
      verification: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Устранить неисправность двери и восстановить её полное закрывание"],
        resultCheck: "После работ проверить полное закрывание двери",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);
    const body = renderGeneratedDraft(parsed).body;

    expect(parsed.actionPlan.preliminaryCheck).toBeNull();
    expect(body).toContain(
      "1. Устранить неисправность двери и восстановить её полное закрывание.\n2. После работ проверить полное закрывание двери.",
    );
    for (const inventedComponent of ["доводчик", "петля", "замок", "ручка"]) {
      expect(body.toLocaleLowerCase("ru")).not.toContain(inventedComponent);
    }
  });

  it("сохраняет explicit result check для простого действия", () => {
    const draft = createDraft({
      title: "Не закреплена крышка почтового ящика",
      problem: "Крышка почтового ящика не закреплена.",
      impact: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Закрепить крышку почтового ящика"],
        resultCheck: "После работ проверить надёжность крепления крышки",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.actionPlan).toEqual(draft.actionPlan);
    expect(renderGeneratedDraft(parsed).body).toContain(
      "1. Закрепить крышку почтового ящика.\n2. После работ проверить надёжность крепления крышки.",
    );
  });

  it("валидирует multiple_issues только с безопасными пустыми значениями", () => {
    const draft = createMultipleIssuesDraft();

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
    expectInvalidResponse({ ...draft, verification: "Проверить причину" });
    expectInvalidResponse({
      ...draft,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Устранить первую проблему"],
        resultCheck: null,
      },
    });
  });

  it.each([
    ["title", "title", primaryRequestDraftLimits.title.max],
    ["problem", "problem", primaryRequestDraftLimits.problem.max],
    ["circumstances", "circumstances", primaryRequestDraftLimits.circumstances.max],
    ["impact", "impact", primaryRequestDraftLimits.impact.max],
    ["verification", "verification", primaryRequestDraftLimits.verification.max],
  ] as const)("проверяет точную границу поля %s и превышение", (_caseName, field, max) => {
    const exactValue = field === "title" ? "б".repeat(max) : `${"б".repeat(max - 1)}.`;
    const exactDraft = createDraft({
      problem: "а",
      impact: null,
      actionPlan: { preliminaryCheck: null, remedyActions: ["."], resultCheck: null },
      [field]: exactValue,
    });
    const tooLongDraft = createDraft({
      problem: "а",
      impact: null,
      actionPlan: { preliminaryCheck: null, remedyActions: ["в"], resultCheck: null },
      [field]: "б".repeat(max + 1),
    });

    expect(parseRequestDraft(serializeDraft(exactDraft))).toEqual(exactDraft);
    expectInvalidResponse(tooLongDraft);
  });

  it("проверяет границы элементов actionPlan и warnings", () => {
    const exactDraft = createDraft({
      problem: "а",
      impact: null,
      actionPlan: {
        preliminaryCheck: "а".repeat(primaryRequestDraftLimits.action.max),
        remedyActions: ["б".repeat(primaryRequestDraftLimits.action.max)],
        resultCheck: "в".repeat(primaryRequestDraftLimits.action.max),
      },
      warnings: ["в".repeat(primaryRequestDraftLimits.warning.max)],
    });

    expect(parseRequestDraft(serializeDraft(exactDraft))).toEqual(exactDraft);
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["б".repeat(primaryRequestDraftLimits.action.max + 1)],
          resultCheck: null,
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: "б".repeat(primaryRequestDraftLimits.action.max + 1),
          remedyActions: ["Восстановить освещение"],
          resultCheck: null,
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Восстановить освещение"],
          resultCheck: "б".repeat(primaryRequestDraftLimits.action.max + 1),
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: " ",
          remedyActions: ["Восстановить освещение"],
          resultCheck: null,
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Восстановить освещение"],
          resultCheck: " ",
        },
      }),
    );
    expectInvalidResponse(
      createDraft({ warnings: ["в".repeat(primaryRequestDraftLimits.warning.max + 1)] }),
    );
    expectInvalidResponse(
      createDraft({
        warnings: Array.from(
          { length: primaryRequestDraftLimits.warnings.max + 1 },
          (_, index) => `Предупреждение ${String(index + 1)}`,
        ),
      }),
    );
  });

  it("проверяет точный итоговый лимит body и превышение на один символ", () => {
    const maximumBodyWithoutSpecificLegalBasis =
      generateRequestLimits.result.bodyMax -
      (primaryRequestLegalBasisLimits.maximumBlockLength - COMMON_LEGAL_BASIS_BLOCK.length);
    const exactDraft = createDraftAtBodyLength(maximumBodyWithoutSpecificLegalBasis);
    const parsed = parseRequestDraft(serializeDraft(exactDraft));
    expectGeneratedDraft(parsed);

    expect(renderGeneratedDraft(parsed).body).toHaveLength(maximumBodyWithoutSpecificLegalBasis);
    expectInvalidResponse(createDraftAtBodyLength(maximumBodyWithoutSpecificLegalBasis + 1));
  });

  it("отклоняет невалидный JSON, лишние поля и неверную ветку outcome", () => {
    expect(() => parseRequestDraft('{"draft":')).toThrow(INVALID_RESPONSE_MESSAGE);
    expectInvalidResponse({ ...createDraft(), body: "Готовый текст" });
    const { actionPlan: _actionPlan, ...legacyDraft } = createDraft();
    expectInvalidResponse({ ...legacyDraft, requests: ["Восстановить освещение"] });
    expect(() =>
      parseRequestDraft(JSON.stringify({ draft: createDraft(), explanation: "Лишнее поле" })),
    ).toThrow(INVALID_RESPONSE_MESSAGE);
    expectInvalidResponse({ ...createDraft(), outcome: "unknown" });
  });

  it("строго отклоняет legacy-поля inspection и actions без compatibility fallback", () => {
    expectInvalidResponse({
      ...createDraft(),
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Восстановить освещение"],
        resultCheck: null,
        inspection: null,
        actions: ["Восстановить освещение"],
      },
    });
  });

  it("отклоняет отсутствие каждого обязательного поля", () => {
    for (const field of [
      "outcome",
      "title",
      "problem",
      "circumstances",
      "impact",
      "verification",
      "subject",
      "actionPlan",
      "warnings",
    ] as const) {
      const draft: Record<string, unknown> = { ...createDraft() };
      delete draft[field];
      expectInvalidResponse(draft);
    }
  });

  it("нормализует края строк, но отклоняет переводы строк и префикс «Прошу:»", () => {
    const parsed = parseRequestDraft(
      serializeDraft(
        createDraft({
          title: "  Не работает освещение  ",
          problem: "  Не работает освещение.  ",
          circumstances: "  Свет периодически включается.  ",
          impact: null,
          verification: "  Необходимо проверить проводку.  ",
          actionPlan: {
            preliminaryCheck: "  Проверить источник неисправности  ",
            remedyActions: ["  Восстановить освещение  "],
            resultCheck: "  Проверить работу освещения  ",
          },
          warnings: ["  Не указана длительность  "],
        }),
      ),
    );
    expectGeneratedDraft(parsed);

    expect(parsed.title).toBe("Не работает освещение");
    expect(parsed.circumstances).toBe("Свет периодически включается.");
    expect(parsed.verification).toBe("Необходимо проверить проводку.");
    expect(parsed.actionPlan).toEqual({
      preliminaryCheck: "Проверить источник неисправности",
      remedyActions: ["Восстановить освещение"],
      resultCheck: "Проверить работу освещения",
    });
    expectInvalidResponse(createDraft({ circumstances: "Условие\nпроявления" }));
    for (const actionPlan of [
      {
        preliminaryCheck: "Прошу: проверить освещение",
        remedyActions: ["Восстановить освещение"],
        resultCheck: null,
      },
      {
        preliminaryCheck: null,
        remedyActions: ["Прошу: восстановить освещение"],
        resultCheck: null,
      },
      {
        preliminaryCheck: null,
        remedyActions: ["Восстановить освещение"],
        resultCheck: "Прошу: проверить освещение",
      },
    ]) {
      expectInvalidResponse(createDraft({ actionPlan }));
    }
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: [""],
          resultCheck: null,
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Восстановить\nосвещение"],
          resultCheck: null,
        },
      }),
    );
  });
});
