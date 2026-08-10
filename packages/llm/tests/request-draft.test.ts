import { generateRequestLimits } from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import {
  formatRequestDraft,
  parseRequestDraft,
  requestDraftLimits,
  REQUEST_DRAFT_JSON_SCHEMA,
  REQUEST_DRAFT_SYSTEM_PROMPT,
  type GeneratedRequestDraft,
  type RequestDraft,
} from "../src/request-draft.js";

const INVALID_RESPONSE_MESSAGE = "LLM вернул некорректный формат заявки";
const HOUSING_CODE_URL =
  "https://www.consultant.ru/document/cons_doc_LAW_51057/71c7149b7b2a7693ca3f88b93580da0a5376e041/";
const MANAGEMENT_RULES_URL =
  "https://www.consultant.ru/document/cons_doc_LAW_146444/b045a68db61f55f3f407349ed4dfd788833df145/";
const HOUSING_CODE_BASIS =
  "В соответствии с частями 1 и 2.3 статьи 161 Жилищного кодекса РФ управление многоквартирным домом должно обеспечивать благоприятные и безопасные условия проживания граждан, а управляющая организация несёт ответственность за надлежащее содержание общего имущества.";
const MANAGEMENT_RULES_BASIS =
  "Подпункт «з» пункта 4 Правил осуществления деятельности по управлению многоквартирными домами, утверждённых постановлением Правительства РФ от 15.05.2013 № 416, предусматривает приём и рассмотрение заявок, предложений и обращений собственников и пользователей помещений.";
const COMMON_LEGAL_BASIS_LINES = [HOUSING_CODE_BASIS, MANAGEMENT_RULES_BASIS] as const;

function createDraft(overrides: Partial<GeneratedRequestDraft> = {}): GeneratedRequestDraft {
  return {
    outcome: "generated",
    title: "Не работает освещение",
    problem: "В общем коридоре не работает освещение уже несколько дней.",
    impact: "В тёмное время суток проход по коридору затруднён.",
    requests: ["Проверить освещение", "Устранить неисправность"],
    warnings: [],
    ...overrides,
  };
}

function createRawDraft(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ...createDraft(),
    ...overrides,
  };
}

function serializeDraft(draft: unknown): string {
  return JSON.stringify({ draft });
}

function expectInvalidResponse(responseText: string): void {
  expect(() => parseRequestDraft(responseText)).toThrow(INVALID_RESPONSE_MESSAGE);
}

function createDraftAtBodyLength(bodyLength: number): GeneratedRequestDraft {
  const fixedDraft = createDraft({
    problem: "а",
    impact: "б",
    requests: ["Проверить освещение"],
  });
  const fixedBodyLength = formatRequestDraft(fixedDraft).body.length;

  return createDraft({
    problem: "а".repeat(bodyLength - fixedBodyLength + 1),
    impact: fixedDraft.impact,
    requests: fixedDraft.requests,
  });
}

function expectGeneratedDraft(draft: RequestDraft): asserts draft is GeneratedRequestDraft {
  expect(draft.outcome).toBe("generated");
  if (draft.outcome !== "generated") {
    throw new Error("Ожидался черновик готовой заявки");
  }
}

describe("parseRequestDraft", () => {
  it("разделяет исходы во вложенных ветках провайдерской схемы", () => {
    expect(REQUEST_DRAFT_JSON_SCHEMA).toEqual({
      type: "object",
      properties: {
        draft: {
          anyOf: [
            expect.objectContaining({
              type: "object",
              properties: expect.objectContaining({
                outcome: { type: "string", enum: ["generated"] },
                title: expect.objectContaining({ type: "string" }),
                requests: expect.objectContaining({ minItems: 1 }),
              }),
              additionalProperties: false,
            }),
            expect.objectContaining({
              type: "object",
              properties: expect.objectContaining({
                outcome: { type: "string", enum: ["multiple_issues"] },
                title: { type: "null" },
                problem: { type: "null" },
                impact: { type: "null" },
                requests: expect.objectContaining({ maxItems: 0 }),
                warnings: expect.objectContaining({ maxItems: 0 }),
              }),
              additionalProperties: false,
            }),
          ],
        },
      },
      required: ["draft"],
      additionalProperties: false,
    });
  });

  it("описывает в prompt оба исхода и доступный лимит генерируемой части body", () => {
    const commonLegalBasisLength = COMMON_LEGAL_BASIS_LINES.join("\n").length;

    expect(requestDraftLimits.generatedBodyMax + "\n\n".length + commonLegalBasisLength).toBe(
      generateRequestLimits.result.bodyMax,
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      `body должен содержать не более ${requestDraftLimits.generatedBodyMax} символов`,
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain('outcome: "generated"');
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain('outcome: "multiple_issues"');
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain('"draft": {');
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Протечка крыши");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Сломанные качели");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("старый диван");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Все строковые поля должны быть однострочными");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Последствия и действия учитывай только если пользователь передал их явно",
    );
  });

  it("задаёт отдельную смысловую роль каждому полю generated-черновика", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("problem — только неисправность");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("impact — только явно переданные последствия");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("requests — желаемые действия");
  });

  it("не передаёт нормативные основания и ссылки в prompt или Structured Output", () => {
    const structuredOutput = JSON.stringify(REQUEST_DRAFT_JSON_SCHEMA);

    for (const forbiddenFragment of [
      "Жилищного кодекса",
      "постановлением Правительства",
      "Общие нормативные основания:",
      "http://",
      "https://",
      HOUSING_CODE_URL,
      MANAGEMENT_RULES_URL,
      HOUSING_CODE_BASIS,
      MANAGEMENT_RULES_BASIS,
    ]) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(forbiddenFragment);
      expect(structuredOutput).not.toContain(forbiddenFragment);
    }
  });

  it("описывает JSON-вход с четырьмя исходными полями", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Сообщение пользователя содержит один JSON-объект",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "description, location, consequences и desiredActions",
    );
  });

  it("считает description свободным описанием, а не готовым problem", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "description — свободный пользовательский текст, а не готовое значение problem",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("содержимое description классифицируй по смыслу");
  });

  it("выводит пересекающееся последствие один раз в impact", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Сведения из consequences, повторённые в description, выведи один раз в impact и исключи из problem",
    );
  });

  it("не считает наблюдаемую причину и связанное последствие дубликатами", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Не считай наблюдаемую причину и связанное с ней последствие дубликатами",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "сохрани причину в problem, а последствие в impact",
    );
  });

  it("назначает каждый смысловой факт только одному полю черновика", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Каждый смысловой факт помещай ровно в одно из полей problem, impact или requests",
    );
  });

  it("не переносит практические последствия и неудобства в problem", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("impact — только явно переданные последствия");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не переноси их в problem");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Если одна фраза содержит неисправность и последствие, раздели её на непересекающиеся факты для problem и impact",
    );
  });

  it("не повторяет факт из impact в problem", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "problem, impact и requests не дублируют смысл друг друга буквально или перефразированно",
    );
  });

  it("требует проверить смысловое дублирование перед возвратом JSON", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Перед возвратом JSON проверь");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "problem, impact и requests не дублируют смысл друг друга",
    );
  });

  it("оставляет желаемые действия только в requests", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Сведения из desiredActions, повторённые в description, выведи один раз в requests и исключи из problem и impact",
    );
  });

  it("запрещает выводить неподтверждённые категории людей", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "не выводи новые факты, состояния или категории людей из косвенных признаков",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Не превращай факт о конкретном человеке в возрастную, медицинскую или социальную категорию",
    );
  });

  it("сохраняет конкретные сведения о человеке, месте и обстоятельствах", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Сохраняй в impact конкретного человека или пользователя, отношение к нему, место, обстоятельства и названное затруднение",
    );
  });

  it("не заменяет конкретного человека или пользователя группой людей", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Не заменяй конкретного человека или самого пользователя группой людей и не меняй единственное число на множественное",
    );
  });

  it("ставит сохранение конкретных фактов выше компактности", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Сохранение конкретных фактов важнее краткости");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не обобщай и не заменяй факты");
  });

  it("не меняет конкретные факты при нормализации эмоционального ввода", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Нормализуя эмоции, не меняй субъект, число людей, место или названное затруднение",
    );
  });

  it("запрещает добавлять коммуникационные требования без явного основания", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Без явного основания не добавляй требования сообщить сроки, предоставить письменный ответ или отчитаться о работах",
    );
  });

  it("валидирует черновик с impact и несколькими предупреждениями", () => {
    const draft = createDraft({
      warnings: ["Не указана причина неисправности", "Неизвестен точный срок возникновения"],
    });

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("валидирует черновик с impact null, одним требованием и пустыми warnings", () => {
    const draft = createDraft({
      impact: null,
      requests: ["Восстановить освещение"],
      warnings: [],
    });

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("валидирует черновик с тремя требованиями", () => {
    const draft = createDraft({
      requests: ["Проверить освещение", "Устранить неисправность", "Восстановить освещение"],
    });

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("удаляет только незначащие пробелы по краям строк", () => {
    const parsed = parseRequestDraft(
      serializeDraft({
        outcome: "generated",
        title: "  Не работает освещение  ",
        problem: "  В общем коридоре не работает освещение.  ",
        impact: "  Проход по коридору затруднён.  ",
        requests: ["  Восстановить освещение  "],
        warnings: ["  Неизвестна причина неисправности  "],
      }),
    );

    expect(parsed).toEqual({
      outcome: "generated",
      title: "Не работает освещение",
      problem: "В общем коридоре не работает освещение.",
      impact: "Проход по коридору затруднён.",
      requests: ["Восстановить освещение"],
      warnings: ["Неизвестна причина неисправности"],
    });
  });

  it.each([
    ["title", { title: "Не работает\nосвещение" }],
    ["problem", { problem: "Не работает\r\nосвещение" }],
    ["impact", { impact: "Проход затруднён\nвечером" }],
    ["элемент requests", { requests: ["Проверить освещение\r"] }],
    ["элемент warnings", { warnings: ["Не указано место\n"] }],
  ])("отклоняет перевод строки в поле %s", (_caseName, overrides) => {
    expectInvalidResponse(serializeDraft(createDraft(overrides)));
  });

  it.each([
    ["обычным регистром", "Прошу: проверить освещение"],
    ["смешанным регистром и пробелом перед двоеточием", "пРоШу : проверить освещение"],
    ["пробелами перед префиксом", "  Прошу: проверить освещение"],
  ])("отклоняет требование с префиксом «Прошу:» %s", (_caseName, request) => {
    expectInvalidResponse(serializeDraft(createDraft({ requests: [request] })));
  });

  it("принимает однострочное требование без форматирующего префикса", () => {
    const draft = createDraft({ requests: ["Проверить освещение"] });

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("не отклоняет обычное употребление слова «прошу» без форматирующего префикса", () => {
    const draft = createDraft({ requests: ["Пожалуйста, прошу проверить освещение"] });

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
  });

  it.each([
    ["синтаксически невалидный JSON", '{"title":'],
    [
      "JSON в Markdown code fence",
      `\`\`\`json
${serializeDraft(createDraft())}
\`\`\``,
    ],
    ["текст перед JSON", `Черновик:\n${serializeDraft(createDraft())}`],
    ["текст после JSON", `${serializeDraft(createDraft())}\nГотово`],
  ])("отклоняет %s", (_caseName, responseText) => {
    expectInvalidResponse(responseText);
  });

  it.each([
    "outcome",
    "title",
    "problem",
    "impact",
    "requests",
    "warnings",
  ] as const)("отклоняет черновик без обязательного поля %s", (field) => {
    const draft: Record<string, unknown> = { ...createDraft() };
    delete draft[field];

    expectInvalidResponse(serializeDraft(draft));
  });

  it("отклоняет лишнее поле", () => {
    expectInvalidResponse(
      serializeDraft({
        ...createDraft(),
        explanation: "Дополнительное пояснение",
      }),
    );
  });

  it("отклоняет черновик без корневого поля draft", () => {
    expectInvalidResponse(JSON.stringify(createDraft()));
  });

  it("отклоняет лишнее поле рядом с draft", () => {
    expectInvalidResponse(
      JSON.stringify({ draft: createDraft(), explanation: "Дополнительное пояснение" }),
    );
  });

  it("валидирует исход multiple_issues без данных готовой заявки", () => {
    const response = {
      outcome: "multiple_issues",
      title: null,
      problem: null,
      impact: null,
      requests: [],
      warnings: [],
    } satisfies RequestDraft;

    expect(parseRequestDraft(serializeDraft(response))).toEqual(response);
  });

  it.each([
    ["title", { title: "Сломаны качели" }],
    ["problem", { problem: "На площадке сломаны качели." }],
    ["impact", { impact: "Торчат острые болты." }],
    ["requests", { requests: ["Починить качели"] }],
    ["warnings", { warnings: ["Во вводе несколько проблем"] }],
  ])("отклоняет multiple_issues с непустым полем %s", (_caseName, field) => {
    expectInvalidResponse(
      serializeDraft({
        outcome: "multiple_issues",
        title: null,
        problem: null,
        impact: null,
        requests: [],
        warnings: [],
        ...field,
      }),
    );
  });

  it("отклоняет generated без обязательных данных заявки", () => {
    expectInvalidResponse(
      serializeDraft({
        outcome: "generated",
        title: null,
        problem: null,
        impact: null,
        requests: [],
        warnings: [],
      }),
    );
  });

  it("отклоняет неизвестный outcome", () => {
    expectInvalidResponse(serializeDraft({ ...createDraft(), outcome: "unknown" }));
  });

  it.each([
    ["title", { title: "" }],
    ["title из пробелов", { title: "   " }],
    ["problem", { problem: "" }],
    ["problem из пробелов", { problem: "   " }],
    ["impact", { impact: "" }],
    ["impact из пробелов", { impact: "   " }],
    ["элемент requests", { requests: [""] }],
    ["элемент requests из пробелов", { requests: ["   "] }],
    ["элемент warnings", { warnings: [""] }],
  ])("отклоняет пустое значение %s", (_caseName, overrides) => {
    expectInvalidResponse(serializeDraft(createDraft(overrides)));
  });

  it.each([
    ["title", { title: "а".repeat(requestDraftLimits.titleMax + 1) }],
    ["problem", { problem: "а".repeat(requestDraftLimits.problemMax + 1) }],
    ["impact", { impact: "а".repeat(requestDraftLimits.impactMax + 1) }],
    ["элемент requests", { requests: ["а".repeat(requestDraftLimits.requestMax + 1)] }],
    ["элемент warnings", { warnings: ["а".repeat(requestDraftLimits.warningMax + 1)] }],
  ])("отклоняет слишком длинное значение %s", (_caseName, overrides) => {
    expectInvalidResponse(serializeDraft(createDraft(overrides)));
  });

  it("отклоняет пустой массив requests", () => {
    expectInvalidResponse(serializeDraft(createDraft({ requests: [] })));
  });

  it("отклоняет четыре требования", () => {
    expectInvalidResponse(
      serializeDraft(
        createDraft({
          requests: ["Первое требование", "Второе требование", "Третье требование", "Четвёртое"],
        }),
      ),
    );
  });

  it("отклоняет слишком много предупреждений", () => {
    expectInvalidResponse(
      serializeDraft(
        createDraft({
          warnings: Array.from(
            { length: generateRequestLimits.result.warningsMax + 1 },
            (_, index) => `Предупреждение ${index + 1}`,
          ),
        }),
      ),
    );
  });

  it("отклоняет черновик с допустимыми отдельными полями и слишком длинным body", () => {
    const draft = createDraft({
      title: "а".repeat(requestDraftLimits.titleMax),
      problem: "б".repeat(requestDraftLimits.problemMax),
      impact: "в".repeat(requestDraftLimits.impactMax),
      requests: Array.from({ length: requestDraftLimits.requestsMax }, () =>
        "г".repeat(requestDraftLimits.requestMax),
      ),
      warnings: [],
    });

    expectInvalidResponse(serializeDraft(draft));
  });

  it("принимает черновик с body ровно на внешнем лимите", () => {
    const draft = createDraftAtBodyLength(generateRequestLimits.result.bodyMax);

    const parsedDraft = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsedDraft);
    const result = formatRequestDraft(parsedDraft);

    expect(result.body).toHaveLength(generateRequestLimits.result.bodyMax);
  });

  it("проверяет длину body после нормализации пробелов", () => {
    const draft = createDraftAtBodyLength(generateRequestLimits.result.bodyMax);
    const parsedDraft = parseRequestDraft(
      serializeDraft({
        ...draft,
        problem: `  ${draft.problem}  `,
        impact: `  ${draft.impact ?? ""}  `,
      }),
    );
    expectGeneratedDraft(parsedDraft);

    expect(formatRequestDraft(parsedDraft).body).toHaveLength(generateRequestLimits.result.bodyMax);
  });

  it("отклоняет черновик с body длиннее внешнего лимита на один символ", () => {
    const draft = createDraftAtBodyLength(generateRequestLimits.result.bodyMax + 1);

    expectInvalidResponse(serializeDraft(draft));
  });

  it.each([
    ["массив вместо draft", []],
    ["числовой title", createRawDraft({ title: 42 })],
    ["null в problem", createRawDraft({ problem: null })],
    ["числовой impact", createRawDraft({ impact: 42 })],
    ["строку вместо requests", createRawDraft({ requests: "Проверить" })],
    ["число в requests", createRawDraft({ requests: [42] })],
    ["null вместо warnings", createRawDraft({ warnings: null })],
    ["число в warnings", createRawDraft({ warnings: [42] })],
  ])("отклоняет неверный тип: %s", (_caseName, draft) => {
    expectInvalidResponse(serializeDraft(draft));
  });
});

describe("formatRequestDraft", () => {
  it("детерминированно форматирует problem, impact и три требования", () => {
    const result = formatRequestDraft(
      createDraft({
        requests: ["Проверить освещение", "Устранить неисправность", "Восстановить освещение"],
        warnings: ["Не указана причина неисправности"],
      }),
    );

    expect(result).toEqual({
      title: "Не работает освещение",
      body: [
        "В общем коридоре не работает освещение уже несколько дней.",
        "",
        "В тёмное время суток проход по коридору затруднён.",
        "",
        ...COMMON_LEGAL_BASIS_LINES,
        "",
        "Прошу:",
        "1. Проверить освещение",
        "2. Устранить неисправность",
        "3. Восстановить освещение",
      ].join("\n"),
      warnings: ["Не указана причина неисправности"],
    });
  });

  it("добавляет два общих основания ровно один раз в стабильном порядке перед «Прошу:»", () => {
    const result = formatRequestDraft(createDraft());
    const firstBasisPosition = result.body.indexOf(COMMON_LEGAL_BASIS_LINES[0]);
    const secondBasisPosition = result.body.indexOf(COMMON_LEGAL_BASIS_LINES[1]);
    const requestPosition = result.body.indexOf("Прошу:");

    expect(result.body).not.toContain("Общие нормативные основания:");
    expect(result.body).not.toContain("http://");
    expect(result.body).not.toContain("https://");
    expect(result.body.match(new RegExp(COMMON_LEGAL_BASIS_LINES[0], "gu"))).toHaveLength(1);
    expect(result.body.match(new RegExp(COMMON_LEGAL_BASIS_LINES[1], "gu"))).toHaveLength(1);
    expect(firstBasisPosition).toBeLessThan(requestPosition);
    expect(secondBasisPosition).toBeGreaterThan(firstBasisPosition);
    expect(secondBasisPosition).toBeLessThan(requestPosition);
  });

  it("не создаёт блок impact при null и нумерует одно требование", () => {
    const result = formatRequestDraft(
      createDraft({
        impact: null,
        requests: ["Восстановить освещение"],
      }),
    );

    expect(result.body).toBe(
      [
        "В общем коридоре не работает освещение уже несколько дней.",
        "",
        ...COMMON_LEGAL_BASIS_LINES,
        "",
        "Прошу:",
        "1. Восстановить освещение",
      ].join("\n"),
    );
  });

  it("повторно отклоняет итоговый body сверх внешнего лимита", () => {
    const draft = createDraftAtBodyLength(generateRequestLimits.result.bodyMax + 1);

    expect(() => formatRequestDraft(draft)).toThrow(INVALID_RESPONSE_MESSAGE);
  });
});
