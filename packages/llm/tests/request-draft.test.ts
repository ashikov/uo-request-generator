import {
  COMMON_LEGAL_BASIS_BLOCK,
  generateRequestLimits,
  primaryRequestDraftLimits,
  renderPrimaryRequestDraft,
  type PrimaryRequestDraft,
} from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
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
    requests: ["Проверить освещение", "Устранить неисправность"],
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
    requests: [],
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
    requests: ["б"],
  });
  const fixedBodyLength = renderGeneratedDraft(fixedDraft).body.length;

  return createDraft({
    problem: "а".repeat(bodyLength - fixedBodyLength + 1),
    circumstances: null,
    impact: null,
    verification: null,
    requests: fixedDraft.requests,
  });
}

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
      "requests",
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
      requests: {
        type: "array",
        minItems: primaryRequestDraftLimits.requests.min,
        maxItems: primaryRequestDraftLimits.requests.max,
        items: {
          type: "string",
          minLength: 1,
          maxLength: primaryRequestDraftLimits.request.max,
        },
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
      "requests",
      "warnings",
    ]);
    expect(multipleIssuesSchema.properties).toEqual({
      outcome: { type: "string", enum: ["multiple_issues"] },
      title: { type: "null" },
      problem: { type: "null" },
      circumstances: { type: "null" },
      impact: { type: "null" },
      verification: { type: "null" },
      requests: { type: "array", maxItems: 0, items: { type: "string" } },
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
    const draft = createDraft({
      title: "Отсутствует ручка входной двери",
      problem: "У входной двери подъезда полностью отсутствует ручка.",
      circumstances: "Дверь оставляют открытой и фиксируют ограничителем.",
      impact:
        "Такой способ эксплуатации создаёт риск дополнительной нагрузки на доводчик и крепления.",
      verification: "Необходимо проверить состояние доводчика и креплений двери.",
      requests: [
        "Восстановить ручку и обеспечить её надёжное крепление",
        "Проверить доводчик и крепления двери",
        "Устранить выявленные при проверке повреждения",
        "Выполнить функциональную проверку двери после ремонта",
      ],
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);
    const result = renderGeneratedDraft(parsed);

    expect(parsed).toEqual(draft);
    expect(result.body).toContain(draft.problem);
    expect(result.body).toContain(draft.circumstances);
    expect(result.body).toContain(draft.impact);
    expect(result.body).toContain(draft.verification);
    expect(result.body).not.toContain("доводчик повреждён");
  });

  it("не добавляет отсутствующие подробности в минимальный черновик входной двери", () => {
    const draft = createDraft({
      title: "Отсутствует ручка входной двери",
      problem: "У входной двери подъезда отсутствует ручка.",
      circumstances: null,
      impact: null,
      verification: null,
      requests: ["Восстановить ручку входной двери"],
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);
    const result = renderGeneratedDraft(parsed);

    expect(parsed.circumstances).toBeNull();
    expect(parsed.impact).toBeNull();
    expect(parsed.verification).toBeNull();
    for (const absentFact of ["открыт", "ограничител", "нагруз", "доводчик", "поврежд"]) {
      expect(result.body.toLocaleLowerCase("ru")).not.toContain(absentFact);
    }
  });

  it("сохраняет предполагаемую причину только как предмет проверки", () => {
    const draft = createDraft({
      problem: "Входная дверь закрывается не полностью.",
      circumstances: null,
      impact: null,
      verification: "Необходимо проверить предполагаемую неисправность доводчика.",
      requests: ["Проверить доводчик и устранить выявленную неисправность"],
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.problem).not.toContain("неисправность доводчика");
    expect(parsed.verification).toContain("предполагаемую неисправность доводчика");
    expect(renderGeneratedDraft(parsed).body).toContain(parsed.verification);
  });

  it("сохраняет явный риск в impact без утверждения наступившего повреждения", () => {
    const draft = createDraft({
      problem: "Входную дверь приходится удерживать вручную.",
      circumstances: null,
      impact: "Это создаёт риск повреждения креплений двери.",
      verification: null,
      requests: ["Проверить и восстановить работу двери"],
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.impact).toContain("риск повреждения");
    expect(parsed.impact).not.toContain("крепления повреждены");
  });

  it("оставляет impact null при отсутствии последствий и рисков", () => {
    const draft = createDraft({ impact: null });

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("принимает от одного до пяти требований", () => {
    for (const requests of [
      ["Устранить неисправность"],
      ["Первое", "Второе", "Третье", "Четвёртое", "Пятое"],
    ]) {
      expect(parseRequestDraft(serializeDraft(createDraft({ requests })))).toEqual(
        createDraft({ requests }),
      );
    }
  });

  it("отклоняет шестое требование без усечения", () => {
    expectInvalidResponse(
      createDraft({ requests: ["Первое", "Второе", "Третье", "Четвёртое", "Пятое", "Шестое"] }),
    );
  });

  it("валидирует multiple_issues только с безопасными пустыми значениями", () => {
    const draft = createMultipleIssuesDraft();

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
    expectInvalidResponse({ ...draft, verification: "Проверить причину" });
    expectInvalidResponse({ ...draft, requests: ["Устранить первую проблему"] });
  });

  it.each([
    ["title", "title", primaryRequestDraftLimits.title.max],
    ["problem", "problem", primaryRequestDraftLimits.problem.max],
    ["circumstances", "circumstances", primaryRequestDraftLimits.circumstances.max],
    ["impact", "impact", primaryRequestDraftLimits.impact.max],
    ["verification", "verification", primaryRequestDraftLimits.verification.max],
  ] as const)("проверяет точную границу поля %s и превышение", (_caseName, field, max) => {
    const exactDraft = createDraft({
      problem: "а",
      impact: null,
      requests: ["в"],
      [field]: "б".repeat(max),
    });
    const tooLongDraft = createDraft({
      problem: "а",
      impact: null,
      requests: ["в"],
      [field]: "б".repeat(max + 1),
    });

    expect(parseRequestDraft(serializeDraft(exactDraft))).toEqual(exactDraft);
    expectInvalidResponse(tooLongDraft);
  });

  it("проверяет границы элементов requests и warnings", () => {
    const exactDraft = createDraft({
      problem: "а",
      impact: null,
      requests: ["б".repeat(primaryRequestDraftLimits.request.max)],
      warnings: ["в".repeat(primaryRequestDraftLimits.warning.max)],
    });

    expect(parseRequestDraft(serializeDraft(exactDraft))).toEqual(exactDraft);
    expectInvalidResponse(
      createDraft({ requests: ["б".repeat(primaryRequestDraftLimits.request.max + 1)] }),
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
    const exactDraft = createDraftAtBodyLength(generateRequestLimits.result.bodyMax);
    const parsed = parseRequestDraft(serializeDraft(exactDraft));
    expectGeneratedDraft(parsed);

    expect(renderGeneratedDraft(parsed).body).toHaveLength(generateRequestLimits.result.bodyMax);
    expectInvalidResponse(createDraftAtBodyLength(generateRequestLimits.result.bodyMax + 1));
  });

  it("отклоняет невалидный JSON, лишние поля и неверную ветку outcome", () => {
    expect(() => parseRequestDraft('{"draft":')).toThrow(INVALID_RESPONSE_MESSAGE);
    expectInvalidResponse({ ...createDraft(), body: "Готовый текст" });
    expect(() =>
      parseRequestDraft(JSON.stringify({ draft: createDraft(), explanation: "Лишнее поле" })),
    ).toThrow(INVALID_RESPONSE_MESSAGE);
    expectInvalidResponse({ ...createDraft(), outcome: "unknown" });
  });

  it("отклоняет отсутствие каждого обязательного поля", () => {
    for (const field of [
      "outcome",
      "title",
      "problem",
      "circumstances",
      "impact",
      "verification",
      "requests",
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
          requests: ["  Проверить освещение  "],
          warnings: ["  Не указана длительность  "],
        }),
      ),
    );
    expectGeneratedDraft(parsed);

    expect(parsed.title).toBe("Не работает освещение");
    expect(parsed.circumstances).toBe("Свет периодически включается.");
    expect(parsed.verification).toBe("Необходимо проверить проводку.");
    expect(parsed.requests).toEqual(["Проверить освещение"]);
    expectInvalidResponse(createDraft({ circumstances: "Условие\nпроявления" }));
    expectInvalidResponse(createDraft({ requests: ["Прошу: проверить освещение"] }));
  });
});

describe("REQUEST_DRAFT_SYSTEM_PROMPT", () => {
  it("объясняет семантику отдельных входных полей", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("description — свободное описание ситуации");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("распределяй по смысловым ролям");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("location — отдельно переданное место проблемы");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("учитывай его в problem");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "consequences — отдельно переданные известные последствия или риски",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("учитывай их в impact");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "desiredActions — отдельно переданные желаемые действия",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("учитывай их в requests");
  });

  it("не дублирует сведения отдельных полей, уже переданные в description", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Если сведения из location, consequences или desiredActions уже есть в description, выведи их один раз",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не дублируй между смысловыми ролями");
  });

  it("определяет связанную и несколько несвязанных проблем", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Одна связанная проблема может включать несколько признаков, мест проявления, последствий, обстоятельств и желаемых действий",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "относятся к одному объекту или одной причинно связанной ситуации",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "каждую можно независимо описать и устранить отдельной заявкой",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Не разделяй связанные проявления одной ситуации",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Не выбирай одну проблему и не объединяй несколько независимых проблем в одну заявку",
    );
  });

  it("требует фактическое основание для verification", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Неизвестная причина сама по себе не требует verification",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Простой непосредственно наблюдаемый дефект без дополнительного основания может иметь verification: null",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Проверяй связанные элементы только при фактическом основании",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Не заполняй verification только ради заполнения поля",
    );
  });

  it("сообщает вычисляемый агрегатный бюджет динамической части", () => {
    const sectionSeparator = "\n\n";
    const expectedDynamicBodyMax =
      primaryRequestDraftLimits.body.max -
      COMMON_LEGAL_BASIS_BLOCK.length -
      sectionSeparator.length * 2;

    expect(REQUEST_DRAFT_DYNAMIC_BODY_MAX).toBe(expectedDynamicBodyMax);
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      `Совокупный текст динамических частей и раздела требований должен содержать не более ${String(REQUEST_DRAFT_DYNAMIC_BODY_MAX)} символов`,
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Сохраняй существенные сведения, но формулируй их компактно",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "не заполняй необязательные части общими фразами",
    );
  });

  it("описывает роли расширенного черновика и правила пустых частей", () => {
    for (const field of ["problem", "circumstances", "impact", "verification", "requests"]) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(`${field} содержит`);
    }
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("если их нет, укажи null");
  });

  it("переводит предположение в предмет проверки без утверждения причины", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Предположение всегда преобразуй в предмет проверки в verification",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("никогда не утверждай как причину");
  });

  it("различает риск и уже произошедшее повреждение", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Риск повреждения сохраняй как риск в impact");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "никогда не превращай в уже произошедшее повреждение",
    );
  });

  it("запрещает домыслы и дублирование смысловых фактов", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Один смысловой факт помещай ровно в одну динамическую роль",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Не придумывай причины, обстоятельства, последствия, риски, повреждения, людей, выполненные работы, сроки и требования без основания",
    );
  });

  it("задаёт 1–5 требований без искусственного заполнения массива", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("от 1 до 5 непустых строк");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "количество определяется содержанием, не заполняй массив до пяти искусственно",
    );
  });

  it("сохраняет multiple_issues без частичного черновика", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("outcome: multiple_issues");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Не выбирай одну проблему и не формируй частичный черновик",
    );
  });

  it("не поручает модели законодательство или готовый body", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не возвращай готовый body");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не выбирай и не цитируй законодательство");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_LEGAL_BASIS_BLOCK);
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain("http://");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain("https://");
  });
});
