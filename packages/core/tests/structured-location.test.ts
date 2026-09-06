import { describe, expect, it } from "vitest";
import {
  COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
  COMMON_LEGAL_BASIS_BLOCK,
  generateRequestInputSchema,
  generateRequestResultSchema,
  materializePrimaryRequestDraft,
  primaryRequestDraftSchema,
  renderPrimaryRequestDraft,
  type GenerateRequestInput,
} from "../src";

const DESCRIPTION =
  "Дверь в помещении общего пользования во втором подъезде не закрывается полностью.";
const LOCATION = "подъезд 3, этаж 4";
const PROVIDER_DRAFT = {
  outcome: "generated",
  title: "Дверь не закрывается",
  problem: DESCRIPTION,
  circumstances: null,
  impact: null,
  subject: null,
  warnings: [],
};

function render(input: GenerateRequestInput, overrides: Record<string, unknown> = {}) {
  const draft = materializePrimaryRequestDraft(input, { ...PROVIDER_DRAFT, ...overrides });
  expect(primaryRequestDraftSchema.safeParse(draft).success).toBe(true);
  const result = renderPrimaryRequestDraft(draft, input);
  expect(generateRequestResultSchema.safeParse(result).success).toBe(true);
  return result;
}

describe("сохранение структурированного места в копируемом body", () => {
  it.each([
    { name: "модель опустила место", circumstances: null, warnings: [] },
    { name: "модель сохранила только часть места", circumstances: "В подъезде 3.", warnings: [] },
    { name: "модель повторила место", circumstances: LOCATION, warnings: [] },
    {
      name: "модель предупредила о месте",
      circumstances: null,
      warnings: ["Уточните место при необходимости."],
    },
  ])("сохраняет оба места без приоритета: $name", ({ circumstances, warnings }) => {
    const result = render(
      { description: DESCRIPTION, location: LOCATION },
      { circumstances, warnings },
    );

    expect(result.body).toContain(DESCRIPTION);
    expect(result.body).toContain(`Дополнительно указанное место: ${LOCATION}.`);
    expect(result.body.indexOf("Дополнительно указанное место:")).toBeLessThan(
      result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK),
    );
    expect(result.body).not.toMatch(/исправлен|вместо|противореч/iu);
    expect(result.warnings).toEqual(warnings);
    for (const warning of warnings) expect(result.body).not.toContain(warning);
  });

  it.each([undefined, "", " \t\r\n "])("не добавляет блок для пустого места %j", (location) => {
    const result = render({ description: DESCRIPTION, location });
    expect(result.body).not.toContain("Дополнительно указанное место:");
  });

  it("сохраняет весь текст многострочного места в одном блоке", () => {
    const location = "подъезд 3\r\nэтаж 4\rу двери\nслева";
    const result = render({ description: DESCRIPTION, location: `  ${location}  ` });
    expect(result.body).toContain("Дополнительно указанное место: подъезд 3 этаж 4 у двери слева.");
  });

  it("сохраняет максимально допустимое место без усечения", () => {
    const location = `${"М".repeat(119)}Я`;
    const result = render({ description: DESCRIPTION, location });
    expect(result.body).toContain(location);
  });

  it.each([
    "М".repeat(121),
    null,
    42,
  ])("отклоняет невалидное место до материализации: %j", (location) => {
    const input = { description: DESCRIPTION, location };
    expect(generateRequestInputSchema.safeParse(input).success).toBe(false);
    expect(() =>
      materializePrimaryRequestDraft(input as GenerateRequestInput, PROVIDER_DRAFT),
    ).toThrow();
  });

  it("вмещает полные location и desiredActions вместе с prose и самым длинным нормативным модулем ровно в 2500 символов", () => {
    const description = "В помещении общего пользования грязный пол.";
    const location = `${"М".repeat(119)}Я`;
    const desiredActions = `${"Д".repeat(499)}Я`;
    const input = {
      description,
      location,
      desiredActions,
      confirmedProblemSubject: "common_area_premises_cleaning",
    } satisfies GenerateRequestInput;
    const subject = {
      kind: "common_area_premises_cleaning",
      evidence: [{ sourceField: "description", quote: description }],
    };
    const suffix = [
      `Дополнительно указанное место: ${location}.`,
      COMMON_LEGAL_BASIS_BLOCK,
      ...COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE.paragraphs,
      `Прошу:\n1. ${desiredActions}.`,
    ].join("\n\n");
    const problem = "П".repeat(2500 - suffix.length - ".\n\n".length);
    const result = render(input, { problem, subject });

    expect(result.body).toHaveLength(2500);
    expect(result.body).toContain(problem);
    expect(result.body).toContain(location);
    expect(result.body.endsWith(`Прошу:\n1. ${desiredActions}.`)).toBe(true);
    expect(result.body).not.toContain("Устранить наблюдаемую проблему");

    // На один символ сверх лимита отклоняется вся заявка, а не часть явного ввода.
    expect(() => render(input, { problem: `${problem}П`, subject })).toThrow();
    expect(input.location).toBe(location);
    expect(input.desiredActions).toBe(desiredActions);
  });
});
