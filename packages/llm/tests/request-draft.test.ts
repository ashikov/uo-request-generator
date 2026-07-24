import { generateRequestLimits } from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import {
  formatRequestDraft,
  parseRequestDraft,
  requestDraftLimits,
  REQUEST_DRAFT_SYSTEM_PROMPT,
  type RequestDraft,
} from "../src/request-draft.js";

const INVALID_RESPONSE_MESSAGE = "LLM вернул некорректный формат заявки";

function createDraft(overrides: Partial<RequestDraft> = {}): RequestDraft {
  return {
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

function expectInvalidResponse(responseText: string): void {
  expect(() => parseRequestDraft(responseText)).toThrow(INVALID_RESPONSE_MESSAGE);
}

function createDraftAtBodyLength(bodyLength: number): RequestDraft {
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

describe("parseRequestDraft", () => {
  it("указывает в prompt общий лимит сформированного body", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      `body должен содержать не более ${generateRequestLimits.result.bodyMax} символов`,
    );
  });

  it("валидирует черновик с impact и несколькими предупреждениями", () => {
    const draft = createDraft({
      warnings: ["Не указана причина неисправности", "Неизвестен точный срок возникновения"],
    });

    expect(parseRequestDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it("валидирует черновик с impact null, одним требованием и пустыми warnings", () => {
    const draft = createDraft({
      impact: null,
      requests: ["Восстановить освещение"],
      warnings: [],
    });

    expect(parseRequestDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it("валидирует черновик с тремя требованиями", () => {
    const draft = createDraft({
      requests: ["Проверить освещение", "Устранить неисправность", "Восстановить освещение"],
    });

    expect(parseRequestDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it("удаляет только незначащие пробелы по краям строк", () => {
    const parsed = parseRequestDraft(
      JSON.stringify({
        title: "  Не работает освещение  ",
        problem: "  В общем коридоре не работает освещение.  ",
        impact: "  Проход по коридору затруднён.  ",
        requests: ["  Восстановить освещение  "],
        warnings: ["  Неизвестна причина неисправности  "],
      }),
    );

    expect(parsed).toEqual({
      title: "Не работает освещение",
      problem: "В общем коридоре не работает освещение.",
      impact: "Проход по коридору затруднён.",
      requests: ["Восстановить освещение"],
      warnings: ["Неизвестна причина неисправности"],
    });
  });

  it.each([
    ["синтаксически невалидный JSON", '{"title":'],
    [
      "JSON в Markdown code fence",
      `\`\`\`json
${JSON.stringify(createDraft())}
\`\`\``,
    ],
    ["текст перед JSON", `Черновик:\n${JSON.stringify(createDraft())}`],
    ["текст после JSON", `${JSON.stringify(createDraft())}\nГотово`],
  ])("отклоняет %s", (_caseName, responseText) => {
    expectInvalidResponse(responseText);
  });

  it.each([
    "title",
    "problem",
    "impact",
    "requests",
    "warnings",
  ] as const)("отклоняет черновик без обязательного поля %s", (field) => {
    const draft: Record<string, unknown> = { ...createDraft() };
    delete draft[field];

    expectInvalidResponse(JSON.stringify(draft));
  });

  it("отклоняет лишнее поле", () => {
    expectInvalidResponse(
      JSON.stringify({
        ...createDraft(),
        explanation: "Дополнительное пояснение",
      }),
    );
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
    expectInvalidResponse(JSON.stringify(createDraft(overrides)));
  });

  it.each([
    ["title", { title: "а".repeat(requestDraftLimits.titleMax + 1) }],
    ["problem", { problem: "а".repeat(requestDraftLimits.problemMax + 1) }],
    ["impact", { impact: "а".repeat(requestDraftLimits.impactMax + 1) }],
    ["элемент requests", { requests: ["а".repeat(requestDraftLimits.requestMax + 1)] }],
    ["элемент warnings", { warnings: ["а".repeat(requestDraftLimits.warningMax + 1)] }],
  ])("отклоняет слишком длинное значение %s", (_caseName, overrides) => {
    expectInvalidResponse(JSON.stringify(createDraft(overrides)));
  });

  it("отклоняет пустой массив requests", () => {
    expectInvalidResponse(JSON.stringify(createDraft({ requests: [] })));
  });

  it("отклоняет четыре требования", () => {
    expectInvalidResponse(
      JSON.stringify(
        createDraft({
          requests: ["Первое требование", "Второе требование", "Третье требование", "Четвёртое"],
        }),
      ),
    );
  });

  it("отклоняет слишком много предупреждений", () => {
    expectInvalidResponse(
      JSON.stringify(
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

    expectInvalidResponse(JSON.stringify(draft));
  });

  it("принимает черновик с body ровно на внешнем лимите", () => {
    const draft = createDraftAtBodyLength(generateRequestLimits.result.bodyMax);

    const parsedDraft = parseRequestDraft(JSON.stringify(draft));
    const result = formatRequestDraft(parsedDraft);

    expect(result.body).toHaveLength(generateRequestLimits.result.bodyMax);
  });

  it("проверяет длину body после нормализации пробелов", () => {
    const draft = createDraftAtBodyLength(generateRequestLimits.result.bodyMax);
    const parsedDraft = parseRequestDraft(
      JSON.stringify({
        ...draft,
        problem: `  ${draft.problem}  `,
        impact: `  ${draft.impact ?? ""}  `,
      }),
    );

    expect(formatRequestDraft(parsedDraft).body).toHaveLength(generateRequestLimits.result.bodyMax);
  });

  it("отклоняет черновик с body длиннее внешнего лимита на один символ", () => {
    const draft = createDraftAtBodyLength(generateRequestLimits.result.bodyMax + 1);

    expectInvalidResponse(JSON.stringify(draft));
  });

  it.each([
    ["корневой массив", []],
    ["числовой title", createRawDraft({ title: 42 })],
    ["null в problem", createRawDraft({ problem: null })],
    ["числовой impact", createRawDraft({ impact: 42 })],
    ["строку вместо requests", createRawDraft({ requests: "Проверить" })],
    ["число в requests", createRawDraft({ requests: [42] })],
    ["null вместо warnings", createRawDraft({ warnings: null })],
    ["число в warnings", createRawDraft({ warnings: [42] })],
  ])("отклоняет неверный тип: %s", (_caseName, draft) => {
    expectInvalidResponse(JSON.stringify(draft));
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
