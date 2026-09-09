import { describe, expect, it } from "vitest";
import {
  COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
  COMMON_LEGAL_BASIS_BLOCK,
  evaluateSpecificLegalBasisSelection,
  generatedRequestDraftSchema,
  materializePrimaryRequestDraft,
  renderPrimaryRequestDraft,
  type GenerateRequestInput,
} from "../src";

const INPUT = {
  description: "С потолка общего коридора капает вода.",
  desiredActions: "Прекратите потоп!",
} satisfies GenerateRequestInput;
const DRAFT = {
  outcome: "generated",
  title: "Вода в коридоре",
  problem: INPUT.description,
  circumstances: null,
  impact: null,
  requestItem: null,
  subject: null,
  warnings: [],
};

function render(input: GenerateRequestInput, overrides: Record<string, unknown> = {}) {
  const draft = materializePrimaryRequestDraft(input, { ...DRAFT, ...overrides });
  expect(draft.requestItems).toHaveLength(1);
  return { draft, result: renderPrimaryRequestDraft(draft, input) };
}

describe("кандидат B: единственный пункт требований", () => {
  it("использует строку provider и сохраняет оформление за backend", () => {
    const requestItem = "Принять меры для прекращения затопления";
    const { draft, result } = render(INPUT, { requestItem });
    expect(draft.requestItems).toEqual([requestItem]);
    expect(result.body.endsWith(`Прошу:\n1. ${requestItem}.`)).toBe(true);
    expect(result.body.match(/^Прошу:$/gmu)).toHaveLength(1);
    expect(result.body).not.toContain(INPUT.desiredActions);
    expect(Object.keys(result).sort()).toEqual(["body", "title", "warnings"]);
  });

  it("при null сохраняет полный исходный текст после существующей нормализации", () => {
    const { draft } = render({
      ...INPUT,
      desiredActions: "  Прошу: только осмотрите\r\nничего пока не ремонтируйте.  ",
    });
    expect(draft.requestItems).toEqual(["Только осмотрите ничего пока не ремонтируйте."]);
  });

  it.each([
    null,
    "Заменить кровлю и составить акт",
  ])("без desiredActions использует generic fallback для %j", (requestItem) => {
    const { draft, result } = render({ description: INPUT.description }, { requestItem });
    expect(draft.requestItems).toEqual(["Устранить наблюдаемую проблему"]);
    if (requestItem !== null) expect(result.body).not.toContain(requestItem);
  });

  it("оставляет несколько предложений и связанных действий одним элементом", () => {
    const requestItem = "Проверить крышу. Если она протекает, устранить протечку";
    const { draft } = render(
      { ...INPUT, desiredActions: "Проверьте крышу и, если она течёт, устраните протечку." },
      { requestItem },
    );
    expect(draft.requestItems).toEqual([requestItem]);
  });

  it.each([
    undefined,
    42,
    [],
    "",
    "  ",
    "Осмотреть\nустранить",
    "Осмотреть\rустранить",
  ])("отклоняет malformed requestItem %j даже без desiredActions", (requestItem) => {
    expect(() => render({ description: INPUT.description }, { requestItem })).toThrow();
  });

  it("отклоняет готовый префикс раздела при использовании строки модели", () => {
    expect(() => render(INPUT, { requestItem: "Прошу: устранить затопление" })).toThrow();
  });

  it.each([
    "А".repeat(500),
    "😀".repeat(250),
  ])("принимает максимальный request item без усечения", (requestItem) => {
    const { draft, result } = render(INPUT, { requestItem });
    expect(draft.requestItems).toEqual([requestItem]);
    expect(result.body).toContain(requestItem);
  });

  it.each([
    "А".repeat(501),
    `${"😀".repeat(250)}Я`,
  ])("отклоняет переполнение core request item", (requestItem) => {
    expect(() => render(INPUT, { requestItem })).toThrow();
  });

  it("сохраняет разницу Unicode provider/core: code points принимаются до проверки UTF-16", () => {
    const requestItem = "😀".repeat(251);
    expect(generatedRequestDraftSchema.safeParse({ ...DRAFT, requestItem }).success).toBe(true);
    expect(() => render(INPUT, { requestItem })).toThrow();
  });

  it("вмещает максимальные requestItem и location с нормативным модулем ровно в 2500, отклоняет 2501", () => {
    const description = "В помещении общего пользования грязный пол.";
    const requestItem = `${"Д".repeat(499)}Я`;
    const location = `${"М".repeat(119)}Я`;
    const input = {
      description,
      desiredActions: "Уберите грязь.",
      location,
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
      `Прошу:\n1. ${requestItem}.`,
    ].join("\n\n");
    const problem = "П".repeat(2500 - suffix.length - ".\n\n".length);
    const { result } = render(input, { problem, requestItem, subject });
    expect(result.body).toHaveLength(2500);
    expect(result.body).toContain(location);
    expect(result.body.endsWith(`Прошу:\n1. ${requestItem}.`)).toBe(true);
    expect(() => render(input, { problem: `${problem}П`, requestItem, subject })).toThrow();
  });

  it("сгенерированный requestItem не подтверждает subject через исходный desiredActions", () => {
    const requestItem = "Устранить протечку кровли многоквартирного дома";
    const input = {
      ...INPUT,
      confirmedProblemSubject: "common_area_roof",
    } satisfies GenerateRequestInput;
    const { draft, result } = render(input, {
      requestItem,
      subject: {
        kind: "common_area_roof",
        evidence: [{ sourceField: "desiredActions", quote: requestItem }],
      },
    });
    expect(result.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
    expect(evaluateSpecificLegalBasisSelection(draft.subject, input)).toMatchObject({
      status: "evidence_unverifiable",
    });
  });

  it("не принимает requestItem как новое sourceField evidence", () => {
    expect(() =>
      render(INPUT, {
        requestItem: "Устранить протечку кровли многоквартирного дома",
        subject: {
          kind: "common_area_roof",
          evidence: [{ sourceField: "requestItem", quote: "кровли многоквартирного дома" }],
        },
      }),
    ).toThrow();
  });
});
