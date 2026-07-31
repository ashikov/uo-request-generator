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
    problem: "а".repeat(requestDraftLimits.problemMax),
    impact: "б",
    requests: ["Проверить освещение"],
  });
  const fixedBodyLength = formatRequestDraft(fixedDraft).body.length;

  return createDraft({
    problem: fixedDraft.problem,
    impact: "б".repeat(bodyLength - fixedBodyLength + 1),
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

  it("описывает в prompt оба исхода и общий лимит сформированного body", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      `body должен содержать не более ${generateRequestLimits.result.bodyMax} символов`,
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain('outcome: "generated"');
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain('outcome: "multiple_issues"');
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain('"draft": {');
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Протечка крыши");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Сломанные качели");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("старый диван");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Все строковые поля должны быть однострочными");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "Учитывай известные последствия и желаемые действия только если они явно переданы пользователем",
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
        "Прошу:",
        "1. Проверить освещение",
        "2. Устранить неисправность",
        "3. Восстановить освещение",
      ].join("\n"),
      warnings: ["Не указана причина неисправности"],
    });
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
