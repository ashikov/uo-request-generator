import { describe, expect, expectTypeOf, it } from "vitest";
import {
  generateRequestInputSchema,
  generateRequestLimits,
  generateRequestResultSchema,
  type GenerateRequestOutcome,
  type GenerateRequestResult,
} from "../src";

describe("generateRequestInputSchema", () => {
  it("accepts a valid description", () => {
    const result = generateRequestInputSchema.safeParse({
      description: "На лестничной площадке не горит свет",
      location: "Третий этаж",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a description shorter than the minimum", () => {
    const result = generateRequestInputSchema.safeParse({
      description: "Течь",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a description longer than the maximum without truncating it", () => {
    const description = "а".repeat(generateRequestLimits.description.max + 1);
    const result = generateRequestInputSchema.safeParse({ description });

    expect(result.success).toBe(false);
    expect(description).toHaveLength(generateRequestLimits.description.max + 1);
  });

  it("rejects a location longer than the maximum", () => {
    const result = generateRequestInputSchema.safeParse({
      description: "На лестничной площадке не горит свет",
      location: "а".repeat(generateRequestLimits.location.max + 1),
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["последствия", { consequences: "В вечернее время проход затруднён" }],
    ["желаемые действия", { desiredActions: "Проверить и восстановить освещение" }],
    [
      "оба дополнительных поля",
      {
        consequences: "В вечернее время проход затруднён",
        desiredActions: "Проверить и восстановить освещение",
      },
    ],
  ])("принимает %s как необязательный контекст", (_caseName, context) => {
    const result = generateRequestInputSchema.safeParse({
      description: "На лестничной площадке не горит свет",
      ...context,
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["пустые последствия", { consequences: "" }],
    ["последствия из пробелов", { consequences: "   " }],
    ["пустые желаемые действия", { desiredActions: "" }],
    ["желаемые действия из пробелов", { desiredActions: "   " }],
  ])("отклоняет %s", (_caseName, context) => {
    const result = generateRequestInputSchema.safeParse({
      description: "На лестничной площадке не горит свет",
      ...context,
    });

    expect(result.success).toBe(false);
  });

  it.each([
    "Прошу:",
    "  Прошу:  ",
    "ПРОШУ:   ",
  ])("отклоняет desiredActions только из удаляемого префикса: %j", (desiredActions) => {
    const result = generateRequestInputSchema.safeParse({
      description: "На лестничной площадке не горит свет",
      desiredActions,
    });

    expect(result.success).toBe(false);
  });

  it.each([
    "Прошу: восстановить освещение.",
    "Восстановить освещение.",
  ])("принимает содержательные desiredActions: %j", (desiredActions) => {
    const result = generateRequestInputSchema.safeParse({
      description: "На лестничной площадке не горит свет",
      desiredActions,
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["consequences", "consequences", generateRequestLimits.consequences.max],
    ["desiredActions", "desiredActions", generateRequestLimits.desiredActions.max],
  ] as const)("принимает %s на граничной длине и отклоняет превышение", (_caseName, field, max) => {
    const input = { description: "На лестничной площадке не горит свет", [field]: "а".repeat(max) };
    const tooLongInput = {
      description: "На лестничной площадке не горит свет",
      [field]: "а".repeat(max + 1),
    };

    expect(generateRequestInputSchema.safeParse(input).success).toBe(true);
    expect(generateRequestInputSchema.safeParse(tooLongInput).success).toBe(false);
  });

  it("принимает отсутствие подтверждения предмета", () => {
    const result = generateRequestInputSchema.safeParse({
      description: "Входная дверь подъезда не закрывается",
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.confirmedProblemSubject : "unexpected").toBeUndefined();
  });

  it.each([
    "common_area_entrance_door",
    "common_area_premises_lighting",
    "common_area_premises_cleaning",
    "common_area_roof",
    "common_area_ventilation",
    "common_area_elevator",
  ] as const)("принимает поддержанный подтверждённый предмет: %s", (confirmedProblemSubject) => {
    const result = generateRequestInputSchema.safeParse({
      description: "Входная дверь подъезда не закрывается",
      confirmedProblemSubject,
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.confirmedProblemSubject : undefined).toBe(
      confirmedProblemSubject,
    );
  });

  it.each([
    "true",
    "common_area_unknown",
    1,
    null,
    false,
  ])("отклоняет некорректное подтверждение предмета: %j", (value) => {
    const result = generateRequestInputSchema.safeParse({
      description: "Входная дверь подъезда не закрывается",
      confirmedProblemSubject: value as never,
    });

    expect(result.success).toBe(false);
  });

  it("отклоняет legacy-поле isCommonAreaDoor в строгом HTTP-контракте", () => {
    const result = generateRequestInputSchema.safeParse({
      description: "Входная дверь подъезда не закрывается",
      isCommonAreaDoor: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("generateRequestResultSchema", () => {
  it("accepts a valid generation result", () => {
    const result = generateRequestResultSchema.safeParse({
      title: "Не работает освещение на этаже",
      body: "На лестничной площадке не горит свет. Прошу: проверить и восстановить освещение.",
      warnings: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid generation result", () => {
    const result = generateRequestResultSchema.safeParse({
      title: "а".repeat(generateRequestLimits.result.titleMax + 1),
      body: "Прошу проверить проблему.",
      warnings: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("GenerateRequestOutcome", () => {
  it("экспортирует явный исход генерации без изменения успешного результата", () => {
    const generatedResult: GenerateRequestResult = {
      title: "Не работает освещение на этаже",
      body: "На лестничной площадке не горит свет.\n\nПрошу:\n1. Восстановить освещение",
      warnings: [],
    };
    const generatedOutcome = {
      status: "generated",
      result: generatedResult,
    } satisfies GenerateRequestOutcome;
    const multipleIssuesOutcome = {
      status: "multiple_issues",
    } satisfies GenerateRequestOutcome;

    expectTypeOf(generatedOutcome.result).toEqualTypeOf<GenerateRequestResult>();
    expect(generatedOutcome).toEqual({
      status: "generated",
      result: generatedResult,
    });
    expect(multipleIssuesOutcome).toEqual({ status: "multiple_issues" });
    expect(Object.keys(generatedResult)).toEqual(["title", "body", "warnings"]);
  });
});
