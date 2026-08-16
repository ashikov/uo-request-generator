import { describe, expect, it } from "vitest";
import { generateRequestInputSchema } from "../src/index.js";
import { scenarios, type ScenarioCategory } from "./fixtures.js";

const REQUIRED_CATEGORIES: ScenarioCategory[] = [
  "only_required_description",
  "description_with_location",
  "known_consequences",
  "desired_actions",
  "all_fields",
  "emotional_description",
  "wording_normalization",
  "minimum_sufficient_requests",
  "simple_defect",
  "location_preservation",
  "conflicting_location",
  "compatible_location",
  "multiple_unrelated_issues",
];

describe("test scenario fixtures", () => {
  it("все id уникальны", () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("покрыты все обязательные категории", () => {
    const categories = new Set(scenarios.map((s) => s.category));

    for (const cat of REQUIRED_CATEGORIES) {
      expect(categories.has(cat)).toBe(true);
    }
  });

  it("каждый input проходит Zod-схему", () => {
    for (const scenario of scenarios) {
      const result = generateRequestInputSchema.safeParse(scenario.input);
      expect(result.success).toBe(true);
    }
  });

  it("каждый сценарий имеет поддерживаемый expectedOutcome", () => {
    for (const scenario of scenarios) {
      expect(["generated", "multiple_issues"]).toContain(scenario.expectedOutcome);
    }
  });

  it("generated-сценарии содержат инварианты готового текста", () => {
    const generatedScenarios = scenarios.filter(
      (scenario) => scenario.expectedOutcome === "generated",
    );

    expect(generatedScenarios.length).toBeGreaterThan(0);
    for (const scenario of generatedScenarios) {
      expect(scenario.mustPreserveFacts.length).toBeGreaterThan(0);
      expect(scenario.mustNotInvent.length).toBeGreaterThan(0);
      expect(typeof scenario.expectWarning).toBe("boolean");
    }
  });

  it("multiple_issues-сценарии не содержат инварианты готового текста", () => {
    const rejectedScenarios = scenarios.filter(
      (scenario) => scenario.expectedOutcome === "multiple_issues",
    );

    expect(rejectedScenarios.length).toBeGreaterThan(0);
    for (const scenario of rejectedScenarios) {
      expect("mustPreserveFacts" in scenario).toBe(false);
      expect("mustNotInvent" in scenario).toBe(false);
      expect("expectWarning" in scenario).toBe(false);
    }
  });

  it("multiple_unrelated_issues ожидает multiple_issues", () => {
    const multiIssues = scenarios.filter(
      (scenario) => scenario.category === "multiple_unrelated_issues",
    );

    expect(multiIssues.length).toBeGreaterThan(0);
    for (const scenario of multiIssues) {
      expect(scenario.expectedOutcome).toBe("multiple_issues");
    }
  });

  it("покрывает безопасное смысловое и процедурное обогащение без роста набора", () => {
    expect(scenarios).toHaveLength(13);

    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
    const lighting = byId.get("only-description");
    const door = byId.get("wording-normalization");
    const explicitRisk = byId.get("consequences");
    const procedural = byId.get("minimum-sufficient-requests");
    const simpleDefect = byId.get("simple-defect");

    for (const scenario of [lighting, door, explicitRisk, procedural, simpleDefect]) {
      expect(scenario?.expectedOutcome).toBe("generated");
    }

    if (
      lighting?.expectedOutcome !== "generated" ||
      door?.expectedOutcome !== "generated" ||
      explicitRisk?.expectedOutcome !== "generated" ||
      procedural?.expectedOutcome !== "generated" ||
      simpleDefect?.expectedOutcome !== "generated"
    ) {
      throw new Error("Ожидались generated-сценарии смыслового обогащения");
    }

    expect(lighting.mustPreserveFacts).toContain(
      "отсутствие освещения затрудняет безопасное пользование лестничной площадкой",
    );
    expect(lighting.mustNotInvent).toEqual(
      expect.arrayContaining(["факт падения", "факт травмы", "угроза жизни"]),
    );

    expect(door.mustPreserveFacts).toEqual(
      expect.arrayContaining([
        "риск несанкционированного доступа",
        "установление необходимой для ремонта причины",
        "проверка нормального открывания и закрывания после работ",
      ]),
    );
    expect(door.mustNotInvent).toEqual(
      expect.arrayContaining(["неисправность доводчика", "уже произошедшая кража"]),
    );

    expect(explicitRisk.mustPreserveFacts).toContain("явно переданный риск утраты имущества");
    expect(explicitRisk.mustNotInvent).toContain("утверждение, что имущество уже утрачено");

    expect(procedural.mustPreserveFacts).toEqual(
      expect.arrayContaining([
        "установление источника поступления воды",
        "устранение причины протечки",
        "проверка прекращения поступления воды после работ",
      ]),
    );
    expect(procedural.mustNotInvent).toEqual(
      expect.arrayContaining(["крыша как источник протечки", "труба как источник протечки"]),
    );

    expect(simpleDefect.mustNotInvent).toEqual(
      expect.arrayContaining(["необоснованное практическое значение или риск"]),
    );
  });
});

const FIELD_MAP: Record<ScenarioCategory, { present: string[]; absent: string[] }> = {
  only_required_description: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  description_with_location: {
    present: ["description", "location"],
    absent: ["consequences", "desiredActions", "confirmedProblemSubject"],
  },
  known_consequences: {
    present: ["description", "consequences", "confirmedProblemSubject"],
    absent: ["location", "desiredActions"],
  },
  desired_actions: {
    present: ["description", "desiredActions"],
    absent: ["location", "consequences", "confirmedProblemSubject"],
  },
  all_fields: {
    present: ["description", "location", "consequences", "desiredActions"],
    absent: ["confirmedProblemSubject"],
  },
  emotional_description: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  wording_normalization: {
    present: ["description", "confirmedProblemSubject"],
    absent: ["location", "consequences", "desiredActions"],
  },
  minimum_sufficient_requests: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  simple_defect: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  location_preservation: {
    present: ["description", "location", "confirmedProblemSubject"],
    absent: ["consequences", "desiredActions"],
  },
  conflicting_location: {
    present: ["description", "location", "confirmedProblemSubject"],
    absent: ["consequences", "desiredActions"],
  },
  compatible_location: {
    present: ["description", "location", "confirmedProblemSubject"],
    absent: ["consequences", "desiredActions"],
  },
  multiple_unrelated_issues: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
};

describe("scenario input field structure", () => {
  for (const scenario of scenarios) {
    it(`"${scenario.id}" (${scenario.category}) имеет корректный набор полей`, () => {
      const expected = FIELD_MAP[scenario.category];

      for (const field of expected.present) {
        expect(scenario.input[field as keyof typeof scenario.input]).toBeDefined();
      }

      for (const field of expected.absent) {
        expect(scenario.input[field as keyof typeof scenario.input]).toBeUndefined();
      }
    });
  }
});
