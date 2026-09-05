import { describe, expect, it } from "vitest";
import {
  primaryRequestDraftLimits,
  primaryRequestDraftSchema,
  renderPrimaryRequestDraft,
  type PrimaryRequestDraft,
} from "../src";

const VALID_DRAFT = {
  title: "Не работает освещение",
  problem: "В помещении общего пользования не работает освещение",
  circumstances: null,
  impact: null,
  subject: null,
  requestItems: ["Устранить наблюдаемую проблему"],
  warnings: [],
} satisfies PrimaryRequestDraft;

describe("primaryRequestDraftSchema", () => {
  it("принимает минимальный beta draft", () => {
    expect(primaryRequestDraftSchema.parse(VALID_DRAFT)).toEqual(VALID_DRAFT);
  });

  it("остаётся строгой схемой", () => {
    expect(primaryRequestDraftSchema.safeParse({ ...VALID_DRAFT, extra: true }).success).toBe(
      false,
    );
  });

  it.each([
    ["title", primaryRequestDraftLimits.title.max],
    ["circumstances", primaryRequestDraftLimits.circumstances.max],
    ["impact", primaryRequestDraftLimits.impact.max],
  ] as const)("проверяет предел поля %s без усечения", (field, max) => {
    const accepted = { ...VALID_DRAFT, [field]: "а".repeat(max) };
    const rejected = { ...VALID_DRAFT, [field]: "а".repeat(max + 1) };

    expect(primaryRequestDraftSchema.safeParse(accepted).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(rejected).success).toBe(false);
  });

  it("применяет общий body budget поверх предела problem", () => {
    const problem = "а".repeat(primaryRequestDraftLimits.problem.max);

    expect(primaryRequestDraftSchema.safeParse({ ...VALID_DRAFT, problem }).success).toBe(false);
    expect(problem).toHaveLength(primaryRequestDraftLimits.problem.max);
  });

  it("проверяет предел request item без усечения", () => {
    const accepted = {
      ...VALID_DRAFT,
      requestItems: ["а".repeat(primaryRequestDraftLimits.requestItem.max)],
    };
    const rejected = {
      ...VALID_DRAFT,
      requestItems: ["а".repeat(primaryRequestDraftLimits.requestItem.max + 1)],
    };

    expect(primaryRequestDraftSchema.safeParse(accepted).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(rejected).success).toBe(false);
  });

  it.each([
    ["многострочный problem", { problem: "Строка 1\nСтрока 2" }],
    ["многострочный request item", { requestItems: ["Осмотреть\nи устранить"] }],
    ["готовый префикс раздела", { requestItems: ["Прошу: устранить проблему"] }],
    ["пустой request item", { requestItems: ["   "] }],
  ])("отклоняет %s", (_name, override) => {
    expect(primaryRequestDraftSchema.safeParse({ ...VALID_DRAFT, ...override }).success).toBe(
      false,
    );
  });

  it("не допускает больше одного request item", () => {
    expect(
      primaryRequestDraftSchema.safeParse({
        ...VALID_DRAFT,
        requestItems: ["Устранить проблему", "Проверить результат"],
      }).success,
    ).toBe(false);
  });
});

describe("renderPrimaryRequestDraft", () => {
  it("сохраняет порядок описательных и правовых блоков перед разделом требований", () => {
    const result = renderPrimaryRequestDraft({
      ...VALID_DRAFT,
      circumstances: "Проблема наблюдается вечером",
      impact: "Проход затруднён",
    });

    expect(result.body.indexOf("Проблема наблюдается вечером.")).toBeGreaterThan(
      result.body.indexOf("не работает освещение."),
    );
    expect(result.body.indexOf("Проход затруднён.")).toBeGreaterThan(
      result.body.indexOf("Проблема наблюдается вечером."),
    );
    expect(result.body.indexOf("Прошу:")).toBeGreaterThan(result.body.indexOf("Жилищного кодекса"));
    expect(result.body).toContain("Прошу:\n1. Устранить наблюдаемую проблему.");
  });

  it("не добавляет второй завершающий знак", () => {
    const result = renderPrimaryRequestDraft({
      ...VALID_DRAFT,
      requestItems: ["Только провести осмотр, работы не выполнять!"],
    });

    expect(result.body).toContain("1. Только провести осмотр, работы не выполнять!");
    expect(result.body).not.toContain("выполнять!.");
  });
});
