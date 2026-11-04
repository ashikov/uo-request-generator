import { describe, expect, it } from "vitest";
import {
  COMMON_LEGAL_BASIS_BLOCK,
  generatedRepeatRequestDraftSchema,
  materializeRepeatRequestDraft,
  renderRepeatRequestDraft,
  repeatRequestDraftSchema,
  repeatRequestInputSchema,
  repeatRequestProviderDraftSchema,
  repeatRequestResultSchema,
  type RepeatRequestInput,
} from "../src";

const input: RepeatRequestInput = {
  previousRequest: "Просил восстановить освещение в общем коридоре.",
  currentState: "Один светильник восстановлен, второй по-прежнему не горит.",
  response: { status: "not_received" },
};

function generatedDraft(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "generated",
    title: "Повторное обращение об освещении",
    originalProblem: "В общем коридоре не работали два светильника",
    previousRequestSummary: "Ранее просил восстановить оба светильника",
    responseSummary: null,
    performedActions: "Один светильник восстановлен",
    currentState: "Второй светильник по-прежнему не горит",
    unresolvedQuestions: null,
    circumstancesToVerify: null,
    newFacts: null,
    warnings: [],
    ...overrides,
  };
}

describe("repeat request input", () => {
  it.each([
    { status: "not_received" },
    { status: "unknown" },
    { status: "received", text: "Обращение принято в работу", date: "2024-02-29" },
  ])("принимает самостоятельное состояние ответа $status", (response) => {
    expect(repeatRequestInputSchema.safeParse({ ...input, response }).success).toBe(true);
  });

  it.each([
    { status: "received" },
    { status: "received", text: "   " },
    { status: "not_received", text: "Ответ" },
    { status: "unknown", date: "2024-02-29" },
    { status: "other" },
  ])("отклоняет несовместимый ответ %j", (response) => {
    expect(repeatRequestInputSchema.safeParse({ ...input, response }).success).toBe(false);
  });

  it("отклоняет недостающие обязательные сведения и чужие поля", () => {
    expect(repeatRequestInputSchema.safeParse({ currentState: input.currentState }).success).toBe(
      false,
    );
    expect(
      repeatRequestInputSchema.safeParse({ ...input, description: "Другая схема" }).success,
    ).toBe(false);
    expect(
      repeatRequestInputSchema.safeParse({ ...input, previousRequest: "   Течь   " }).success,
    ).toBe(false);
    expect(
      repeatRequestInputSchema.safeParse({ ...input, currentState: " \n\t ".repeat(10) }).success,
    ).toBe(false);
  });

  it.each([
    ["previousRequest", 2000],
    ["currentState", 2000],
    ["previousRequestNumber", 80],
    ["performedActions", 1000],
    ["unresolvedQuestions", 1000],
    ["newFacts", 1000],
    ["location", 120],
    ["desiredActions", 500],
  ])("проверяет границу поля %s без усечения", (field, maximum) => {
    expect(
      repeatRequestInputSchema.safeParse({ ...input, [field]: "я".repeat(maximum) }).success,
    ).toBe(true);
    expect(
      repeatRequestInputSchema.safeParse({ ...input, [field]: "я".repeat(maximum + 1) }).success,
    ).toBe(false);
  });

  it("проверяет предел ответа и суммарную границу 7000/7001", () => {
    const boundary = {
      previousRequest: "а".repeat(2000),
      currentState: "б".repeat(2000),
      response: { status: "received", text: "в".repeat(2000) },
      performedActions: "г".repeat(1000),
    };

    expect(repeatRequestInputSchema.safeParse(boundary).success).toBe(true);
    expect(repeatRequestInputSchema.safeParse({ ...boundary, location: "д" }).success).toBe(false);
    expect(
      repeatRequestInputSchema.safeParse({
        ...input,
        response: { status: "received", text: "в".repeat(2001) },
      }).success,
    ).toBe(false);
  });

  it.each([
    "2025-02-29",
    "2024-04-31",
    "1900-02-29",
    "2024-2-09",
    "2024-01-01\n",
  ])("проверяет календарную дату %j в обоих реквизитах", (date) => {
    expect(
      repeatRequestInputSchema.safeParse({ ...input, previousRequestDate: date }).success,
    ).toBe(false);
    expect(
      repeatRequestInputSchema.safeParse({
        ...input,
        response: { status: "received", text: "Освещение восстановлено", date },
      }).success,
    ).toBe(false);
  });

  it("принимает календарно допустимые даты, включая високосный век", () => {
    expect(
      repeatRequestInputSchema.safeParse({
        ...input,
        previousRequestDate: "2000-02-29",
        response: { status: "received", text: "Обращение принято в работу", date: "2024-02-29" },
      }).success,
    ).toBe(true);
  });

  it.each([
    "SYN\n0007",
    "SYN\u00000007",
    "SYN\u001b0007",
    "SYN\u20280007",
  ])("отклоняет управляющие символы и разделители строк в номере %j", (previousRequestNumber) => {
    expect(repeatRequestInputSchema.safeParse({ ...input, previousRequestNumber }).success).toBe(
      false,
    );
  });

  it.each([
    "Прошу:",
    "  ПРОШУ: \r\n ",
  ])("отклоняет требование только из удаляемого префикса %j", (desiredActions) => {
    expect(repeatRequestInputSchema.safeParse({ ...input, desiredActions }).success).toBe(false);
  });

  it("сохраняет исходные сведения без смысловой нормализации", () => {
    const original = {
      ...input,
      previousRequest: `  ${input.previousRequest}\nНе заменять исправные светильники.  `,
      previousRequestNumber: "SYN-0007/А",
    };
    expect(repeatRequestInputSchema.parse(original)).toEqual(original);
  });

  it("считает длины в UTF-16 code units, а не в Unicode code points", () => {
    expect(
      repeatRequestInputSchema.safeParse({ ...input, previousRequest: "😀".repeat(1001) }).success,
    ).toBe(false);
    expect(
      generatedRepeatRequestDraftSchema.safeParse(generatedDraft({ title: "😀".repeat(61) }))
        .success,
    ).toBe(false);
  });
});

describe("repeat request provider draft", () => {
  it.each([
    "multiple_issues",
    "insufficient_history",
  ])("принимает %s только без частичного документа", (outcome) => {
    expect(repeatRequestProviderDraftSchema.safeParse({ outcome }).success).toBe(true);
    expect(
      repeatRequestProviderDraftSchema.safeParse({ outcome, title: "Частичный текст" }).success,
    ).toBe(false);
  });

  it("требует все смысловые роли и не принимает реквизиты или требования модели", () => {
    expect(generatedRepeatRequestDraftSchema.safeParse(generatedDraft()).success).toBe(true);
    const { newFacts: _newFacts, ...incompleteDraft } = generatedDraft();
    expect(generatedRepeatRequestDraftSchema.safeParse(incompleteDraft).success).toBe(false);
    expect(
      generatedRepeatRequestDraftSchema.safeParse(
        generatedDraft({ previousRequestNumber: "MODEL-0001" }),
      ).success,
    ).toBe(false);
    expect(
      generatedRepeatRequestDraftSchema.safeParse(
        generatedDraft({ requestItems: ["Заменить дверь"] }),
      ).success,
    ).toBe(false);
    expect(
      generatedRepeatRequestDraftSchema.safeParse(generatedDraft({ currentState: "Две\nстроки" }))
        .success,
    ).toBe(false);
  });

  it.each([
    ["title", 120],
    ["originalProblem", 800],
    ["previousRequestSummary", 1200],
    ["responseSummary", 1200],
    ["performedActions", 1000],
    ["currentState", 1600],
    ["unresolvedQuestions", 1000],
    ["circumstancesToVerify", 600],
    ["newFacts", 1000],
  ])("соблюдает лимит provider-поля %s", (field, maximum) => {
    expect(
      generatedRepeatRequestDraftSchema.safeParse(generatedDraft({ [field]: "а".repeat(maximum) }))
        .success,
    ).toBe(true);
    expect(
      generatedRepeatRequestDraftSchema.safeParse(
        generatedDraft({ [field]: "а".repeat(maximum + 1) }),
      ).success,
    ).toBe(false);
  });

  it("ограничивает warnings и не принимает пустые строки вместо null", () => {
    expect(
      generatedRepeatRequestDraftSchema.safeParse(
        generatedDraft({ warnings: Array(6).fill("Совет") }),
      ).success,
    ).toBe(false);
    expect(
      generatedRepeatRequestDraftSchema.safeParse(generatedDraft({ warnings: ["а".repeat(201)] }))
        .success,
    ).toBe(false);
    expect(
      generatedRepeatRequestDraftSchema.safeParse(generatedDraft({ newFacts: " " })).success,
    ).toBe(false);
  });
});

describe("repeat request materialization and rendering", () => {
  it("берёт точные реквизиты только из входа и разделяет сообщение УО с наблюдением", () => {
    const draft = materializeRepeatRequestDraft(
      {
        ...input,
        previousRequestDate: "2024-02-29",
        previousRequestNumber: "SYN-0007/А",
        location: "  Учебный коридор\r\nсеверного крыла  ",
        response: { status: "received", text: "Освещение восстановлено", date: "2024-03-01" },
      },
      generatedDraft({ responseSummary: "УО сообщила о восстановлении освещения" }),
    );
    const result = renderRepeatRequestDraft(draft);

    expect(draft).toMatchObject({
      previousRequestDate: "2024-02-29",
      previousRequestNumber: "SYN-0007/А",
      responseDate: "2024-03-01",
      responseStatus: "received",
      location: "  Учебный коридор\r\nсеверного крыла  ",
    });
    expect(result.body).toContain("SYN-0007/А");
    expect(result.body).toContain("2024-02-29");
    expect(result.body).toContain("2024-03-01");
    expect(result.body).toContain("УО сообщила о восстановлении освещения");
    expect(result.body).toContain("Второй светильник по-прежнему не горит");
    expect(result.body).toContain(
      "Дополнительно указанное место: Учебный коридор северного крыла.",
    );
  });

  it.each([
    ["not_received", "Ответ на предыдущее обращение не получен."],
    ["unknown", "Сведения об ответе на предыдущее обращение отсутствуют."],
  ] as const)("различает %s и не выдумывает неизвестные реквизиты", (status, expectedText) => {
    const draft = materializeRepeatRequestDraft(
      { ...input, response: { status } },
      generatedDraft(),
    );
    const result = renderRepeatRequestDraft(draft);

    expect(result.body).toContain(expectedText);
    expect(draft.previousRequestDate).toBeUndefined();
    expect(draft.previousRequestNumber).toBeUndefined();
    expect(draft.responseDate).toBeUndefined();
    expect(result.body).not.toContain("undefined");
    expect(result.body).not.toContain("Срок");
  });

  it("отклоняет содержание ответа, несовместимое со статусом", () => {
    expect(() =>
      materializeRepeatRequestDraft(
        input,
        generatedDraft({ responseSummary: "УО сообщила о восстановлении" }),
      ),
    ).toThrow();
    expect(() =>
      materializeRepeatRequestDraft(
        { ...input, response: { status: "received", text: "Принято в работу" } },
        generatedDraft(),
      ),
    ).toThrow();
    const draft = materializeRepeatRequestDraft(input, generatedDraft());
    expect(
      repeatRequestDraftSchema.safeParse({ ...draft, responseDate: "2024-03-01" }).success,
    ).toBe(false);
  });

  it("формирует один безопасный пункт без добавления сроков, причин или ремонта", () => {
    const draft = materializeRepeatRequestDraft(input, generatedDraft());
    const expectedItem =
      "Повторно рассмотреть описанную проблему с учётом результата предыдущего обращения, сообщить о результатах рассмотрения и при подтверждении нерешённой проблемы принять меры по её устранению";

    expect(draft.requestItems).toEqual([expectedItem]);
    expect(renderRepeatRequestDraft(draft).body.endsWith(`Прошу:\n1. ${expectedItem}.`)).toBe(true);
    expect(repeatRequestDraftSchema.safeParse({ ...draft, requestItems: [] }).success).toBe(false);
    expect(
      repeatRequestDraftSchema.safeParse({ ...draft, requestItems: [expectedItem, expectedItem] })
        .success,
    ).toBe(false);
  });

  it("сохраняет всё явное требование с условиями и отрицаниями как единственный пункт", () => {
    const draft = materializeRepeatRequestDraft(
      {
        ...input,
        desiredActions:
          "  Прошу: сначала сообщить результат осмотра.\r\nНе заменять исправный светильник без проверки.  ",
      },
      generatedDraft(),
    );

    expect(draft.requestItems).toEqual([
      "Сначала сообщить результат осмотра. Не заменять исправный светильник без проверки.",
    ]);
    expect(renderRepeatRequestDraft(draft).body).not.toContain("Повторно рассмотреть");
  });

  it("собирает смысловые блоки в фиксированном порядке и не копирует warnings", () => {
    const draft = materializeRepeatRequestDraft(
      { ...input, location: "Учебный коридор" },
      generatedDraft({
        unresolvedQuestions: "Неизвестно, когда будет проверен второй светильник",
        circumstancesToVerify: "Причина отсутствия света неизвестна",
        newFacts: "После обращения светильник начал мигать",
        warnings: ["Проверьте сведения перед отправкой"],
      }),
    );
    const result = renderRepeatRequestDraft(draft);
    const expectedOrder = [
      draft.originalProblem,
      "Предыдущее обращение:",
      draft.previousRequestSummary,
      "Ответ на предыдущее обращение не получен",
      draft.performedActions ?? "",
      draft.currentState,
      draft.unresolvedQuestions ?? "",
      draft.circumstancesToVerify ?? "",
      draft.newFacts ?? "",
      "Дополнительно указанное место: Учебный коридор",
      COMMON_LEGAL_BASIS_BLOCK,
      "Прошу:\n1.",
    ];
    let previousPosition = -1;
    for (const fragment of expectedOrder) {
      const position = result.body.indexOf(fragment);
      expect(position).toBeGreaterThan(previousPosition);
      previousPosition = position;
    }
    expect(result.warnings).toEqual(["Проверьте сведения перед отправкой"]);
    expect(result.body).not.toContain(result.warnings[0]);
  });

  it("принимает полный body длиной 8000 и отказывает на 8001 без усечения", () => {
    const receivedInput: RepeatRequestInput = {
      ...input,
      response: { status: "received", text: "Обращение принято в работу" },
    };
    const providerDraft = generatedDraft({
      originalProblem: "а".repeat(800),
      previousRequestSummary: "б".repeat(1200),
      responseSummary: "в".repeat(1200),
      performedActions: "г".repeat(1000),
      currentState: "д".repeat(100),
      unresolvedQuestions: "е".repeat(1000),
      circumstancesToVerify: "ж".repeat(600),
      newFacts: "з".repeat(300),
    });
    const baseLength = renderRepeatRequestDraft(
      materializeRepeatRequestDraft(receivedInput, providerDraft),
    ).body.length;
    const boundaryState = "д".repeat(100 + 8000 - baseLength);
    expect(boundaryState.length).toBeLessThan(1600);
    const boundary = materializeRepeatRequestDraft(receivedInput, {
      ...providerDraft,
      currentState: boundaryState,
    });

    expect(renderRepeatRequestDraft(boundary).body).toHaveLength(8000);
    expect(() =>
      renderRepeatRequestDraft({ ...boundary, currentState: `${boundaryState}д` }),
    ).toThrow();
    expect(() =>
      materializeRepeatRequestDraft(receivedInput, {
        ...providerDraft,
        currentState: `${boundaryState}д`,
      }),
    ).toThrow();
    expect(
      repeatRequestResultSchema.safeParse({
        title: "Заголовок",
        body: "а".repeat(8001),
        warnings: [],
      }).success,
    ).toBe(false);
  });
});
