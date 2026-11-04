import { describe, expect, it } from "vitest";
import { repeatRequestInputSchema } from "../src/index.js";
import { repeatScenarios } from "./repeat-fixtures.js";

describe("repeat semantic corpus", () => {
  it("содержит 12 разных сценариев без подмены критических повторов новыми fixtures", () => {
    expect(repeatScenarios).toHaveLength(12);
    expect(new Set(repeatScenarios.map(({ id }) => id)).size).toBe(12);
    expect(
      repeatScenarios.filter(({ expectedOutcome }) => expectedOutcome === "generated"),
    ).toHaveLength(10);
    expect(
      repeatScenarios.find(({ id }) => id === "repeat-unrelated-issues")?.expectedOutcome,
    ).toBe("multiple_issues");
    expect(
      repeatScenarios.find(({ id }) => id === "repeat-conflicting-history")?.expectedOutcome,
    ).toBe("insufficient_history");
  });

  it.each(
    repeatScenarios,
  )("принимает offline-ввод $id и содержит независимые смысловые anchors", (scenario) => {
    expect(repeatRequestInputSchema.safeParse(scenario.input).success).toBe(true);
    expect(scenario.mustPreserveFacts.length).toBeGreaterThan(0);
    expect(scenario.mustNotInvent.length).toBeGreaterThan(0);
    expect(scenario.semanticExpectations.length).toBeGreaterThan(0);
  });
});
