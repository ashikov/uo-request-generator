import { describe, expect, it } from "vitest";
import { generateRequestInputSchema } from "../src/index.js";
import { type ScenarioCategory, scenarios } from "./fixtures.js";

const REQUIRED_CATEGORIES: ScenarioCategory[] = [
  "only_required_description",
  "description_with_location",
  "known_consequences",
  "desired_actions",
  "all_fields",
  "emotional_description",
  "wording_normalization",
  "minimum_sufficient_requests",
  "location_action_deduplication",
  "simple_defect",
  "location_preservation",
  "ambiguous_location",
  "compatible_location",
  "impact_subject_preservation",
  "impact_normalization",
  "unconfirmed_remedy",
  "multiple_unrelated_issues",
  "cleaning",
  "lighting",
  "elevator",
  "unknown_remedy",
];

const RECLASSIFIED_BETA_SCENARIOS = [
  "wording-normalization",
  "minimum-sufficient-requests",
  "only-description",
  "simple-defect",
  "desired-actions",
  "all-fields",
  "unknown-remedy-lighting",
  "unconfirmed-remedy-lighting",
  "lighting-elevator-cabin",
] as const;

function scenarioById(id: string) {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`Не найден сценарий ${id}`);
  return scenario;
}

describe("test scenario fixtures", () => {
  it("содержит уникальные id, валидные inputs и актуальные категории", () => {
    expect(new Set(scenarios.map(({ id }) => id)).size).toBe(scenarios.length);
    const categories = new Set(scenarios.map(({ category }) => category));
    for (const category of REQUIRED_CATEGORIES) expect(categories.has(category)).toBe(true);

    for (const scenario of scenarios) {
      expect(generateRequestInputSchema.safeParse(scenario.input).success).toBe(true);
      expect(["generated", "multiple_issues"]).toContain(scenario.expectedOutcome);
      expect(new Set(scenario.semanticExpectations).size).toBe(
        scenario.semanticExpectations.length,
      );
    }
  });

  it("не закрепляет удалённую procedural ontology", () => {
    const serialized = JSON.stringify(scenarios);

    for (const removedConcept of [
      "procedural_plan",
      "preliminaryCheck",
      "remedyActions",
      "resultCheck",
      "desiredActionsAllocation",
      "actionPlanDecision",
      "verificationDecision",
    ]) {
      expect(serialized).not.toContain(removedConcept);
    }
  });

  it("явно классифицирует изменённые ожидания beta corpus", () => {
    for (const id of RECLASSIFIED_BETA_SCENARIOS) {
      const classification = scenarioById(id).expectationClassification;

      expect(classification?.blockerProductInvariants.length).toBeGreaterThan(0);
      expect(classification?.qualityExpectations.length).toBeGreaterThan(0);
      expect(classification?.acceptedBetaLimitations.length).toBeGreaterThan(0);
    }
  });

  it("wording-normalization сохраняет только пользовательские факты и non-invention", () => {
    const scenario = scenarioById("wording-normalization");
    if (scenario.expectedOutcome !== "generated") throw new Error("Ожидался generated");

    expect(scenario.mustPreserveFacts).toEqual([
      "дверь в помещении общего пользования не закрывается полностью",
    ]);
    expect(JSON.stringify(scenario.mustPreserveFacts)).not.toMatch(
      /несанкционирован|установлен|проверка/u,
    );
    expect(scenario.mustNotInvent).toEqual(
      expect.arrayContaining(["неисправность доводчика", "неисправность замка или петель"]),
    );
  });

  it("minimum-sufficient-requests не требует выведенную цепочку работ", () => {
    const scenario = scenarioById("minimum-sufficient-requests");
    if (scenario.expectedOutcome !== "generated") throw new Error("Ожидался generated");

    expect(scenario.mustPreserveFacts).toEqual([
      "с потолка в общем коридоре капает вода",
      "источник протечки неизвестен",
    ]);
    expect(JSON.stringify(scenario.mustPreserveFacts)).not.toMatch(/устран|провер/u);
    expect(scenario.mustNotInvent).toEqual(
      expect.arrayContaining([
        "крыша как источник протечки",
        "труба как источник протечки",
        "квартира как источник протечки",
      ]),
    );
  });

  it.each([
    "desired-actions",
    "all-fields",
    "unconfirmed-remedy-lighting",
  ])("%s считает explicit desiredActions authoritative whole content", (id) => {
    const scenario = scenarioById(id);

    expect(scenario.input.desiredActions).toBeTruthy();
    expect(scenario.expectationClassification?.blockerProductInvariants.join(" ")).toContain(
      "целиком",
    );
    expect(scenario.expectationClassification?.acceptedBetaLimitations.join(" ")).toMatch(
      /не сегментируется|не разбивается|не добавлять/iu,
    );
  });

  it("description-only scenarios принимают один generic request item как beta contract", () => {
    for (const id of ["only-description", "simple-defect", "unknown-remedy-lighting"]) {
      const scenario = scenarioById(id);
      expect(scenario.input.desiredActions).toBeUndefined();
      expect(scenario.expectationClassification?.acceptedBetaLimitations.join(" ")).toMatch(
        /generic request item|проверка причины/iu,
      );
    }
  });

  it("сохраняет subject и normative-module blockers для ключевых regressions", () => {
    expect(scenarioById("lighting-elevator-cabin")).toMatchObject({
      provenance: { issue: 201 },
      hardExpectations: expect.arrayContaining([
        { kind: "subject_kind", expected: "common_area_premises_lighting" },
        { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
        { kind: "selected_normative_module", expected: "common-area-lighting" },
      ]),
    });
    expect(scenarioById("elevator-position-indicator")).toMatchObject({
      provenance: { issue: 218 },
      hardExpectations: expect.arrayContaining([
        { kind: "subject_kind", expected: "common_area_elevator" },
        { kind: "selected_normative_module", expected: "common-area-elevator" },
      ]),
    });
    expect(scenarioById("cleaning-elevator-cabin")).toMatchObject({
      provenance: { issue: 200 },
      hardExpectations: expect.arrayContaining([
        { kind: "subject_kind", expected: "common_area_premises_cleaning" },
        { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
      ]),
    });
  });

  it("multiple_issues не содержит ожиданий готового текста", () => {
    const scenario = scenarioById("multiple-issues");

    expect(scenario.expectedOutcome).toBe("multiple_issues");
    expect("mustPreserveFacts" in scenario).toBe(false);
    expect("mustNotInvent" in scenario).toBe(false);
    expect(scenario.hardExpectations).toEqual([]);
  });
});
