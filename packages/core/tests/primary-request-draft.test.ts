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
  minimalEntranceDoorDraft,
} from "./primary-request-draft.fixtures.js";

const HOUSING_CODE_BASIS =
  "В соответствии с частями 1 и 2.3 статьи 161 Жилищного кодекса РФ управление многоквартирным домом должно обеспечивать благоприятные и безопасные условия проживания граждан, а управляющая организация несёт ответственность за надлежащее содержание общего имущества.";
const MANAGEMENT_RULES_BASIS =
  "Подпункт «з» пункта 4 Правил осуществления деятельности по управлению многоквартирными домами, утверждённых постановлением Правительства РФ от 15.05.2013 № 416, предусматривает приём и рассмотрение заявок, предложений и обращений собственников и пользователей помещений.";

function createDraft(overrides: Partial<PrimaryRequestDraft> = {}): PrimaryRequestDraft {
  return {
    title: "Не работает освещение",
    problem: "В общем коридоре не работает освещение.",
    circumstances: null,
    impact: null,
    verification: null,
    requests: ["Восстановить освещение"],
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
    requests: ["д", "е", "ж", "з", "и"],
  });
  let remaining =
    generateRequestLimits.result.bodyMax - renderPrimaryRequestDraft(draft).body.length;
  const stringFields = ["problem", "circumstances", "impact", "verification"] as const;

  for (const field of stringFields) {
    const max = primaryRequestDraftLimits[field].max;
    const addition = Math.min(remaining, max - 1);
    draft = { ...draft, [field]: `${draft[field] ?? ""}${"а".repeat(addition)}` };
    remaining -= addition;
  }

  const requests = [...draft.requests];
  for (let index = 0; index < requests.length && remaining > 0; index += 1) {
    const request = requests[index] ?? "";
    const addition = Math.min(remaining, primaryRequestDraftLimits.request.max - request.length);
    requests[index] = `${request}${"а".repeat(addition)}`;
    remaining -= addition;
  }

  expect(remaining).toBe(0);
  return { ...draft, requests };
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
      "requests",
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
        ? { circumstances: null, impact: null, verification: null, requests: ["а"] }
        : {};
    const exact = createDraft({ ...otherFields, [field]: "а".repeat(max) });
    const tooLong = createDraft({ ...otherFields, [field]: "а".repeat(max + 1) });

    expect(primaryRequestDraftSchema.safeParse(exact).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(tooLong).success).toBe(false);
  });

  it("проверяет точный лимит требования и предупреждения", () => {
    expect(
      primaryRequestDraftSchema.safeParse(
        createDraft({
          requests: ["а".repeat(primaryRequestDraftLimits.request.max)],
          warnings: ["б".repeat(primaryRequestDraftLimits.warning.max)],
        }),
      ).success,
    ).toBe(true);
    expect(
      primaryRequestDraftSchema.safeParse(
        createDraft({ requests: ["а".repeat(primaryRequestDraftLimits.request.max + 1)] }),
      ).success,
    ).toBe(false);
    expect(
      primaryRequestDraftSchema.safeParse(
        createDraft({ warnings: ["а".repeat(primaryRequestDraftLimits.warning.max + 1)] }),
      ).success,
    ).toBe(false);
  });

  it("принимает от одного до пяти требований и отклоняет шестое без усечения", () => {
    const oneRequest = createDraft({ requests: ["Первое требование"] });
    const fiveRequests = createDraft({
      requests: Array.from({ length: 5 }, (_, index) => `Требование ${index + 1}`),
    });
    const sixRequests = createDraft({
      requests: Array.from({ length: 6 }, (_, index) => `Требование ${index + 1}`),
    });

    expect(primaryRequestDraftSchema.safeParse(oneRequest).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(fiveRequests).success).toBe(true);
    expect(primaryRequestDraftSchema.safeParse(sixRequests).success).toBe(false);
    expect(sixRequests.requests).toHaveLength(6);
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
    ["requests", { requests: ["Проверить\nосвещение"] }],
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

    expect(renderPrimaryRequestDraft(exact).body).toHaveLength(
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
    const verificationPosition = result.body.indexOf(detailedEntranceDoorDraft.verification ?? "");
    const legalPosition = result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK);
    const requestsPosition = result.body.indexOf("Прошу:");

    expect(problemPosition).toBeLessThan(circumstancesPosition);
    expect(circumstancesPosition).toBeLessThan(impactPosition);
    expect(impactPosition).toBeLessThan(verificationPosition);
    expect(verificationPosition).toBeLessThan(legalPosition);
    expect(legalPosition).toBeLessThan(requestsPosition);
    expect(result.body).toContain("дверь оставляют открытой");
    expect(result.body).toContain("фиксируют ограничителем");
    expect(result.body).toContain("дополнительную нагрузку на доводчик");
    expect(result.body).not.toContain("доводчик повреждён");
    expect(result.body).toContain("1. Восстановить дверную ручку");
    expect(result.body).toContain("4. После ремонта проверить");
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

    expect(result.body).toContain("Предполагаемую неисправность доводчика необходимо проверить");
    expect(result.body).not.toContain("Причиной является неисправность доводчика");
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
        "1. Восстановить дверную ручку",
      ].join("\n"),
    );
    expect(result.body).not.toContain("\n\n\n");
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
