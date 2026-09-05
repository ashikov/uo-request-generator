import { ZodError } from "zod";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/request-draft.js", () => ({
  validateProviderRequestDraft: () => ({
    success: false,
    error: new ZodError([
      { code: "custom", path: ["problem"], message: "SECRET_VALIDATION_MESSAGE_247" },
    ]),
  }),
}));

import { parseRequestDraftForEvaluation } from "../src/evaluation-diagnostics.js";

describe("evaluation canonical validation diagnostics", () => {
  it("отделяет canonical validation от успешного wire validation", () => {
    const result = parseRequestDraftForEvaluation(
      JSON.stringify({
        draft: {
          outcome: "generated",
          title: "Не работает освещение",
          problem: "В помещении общего пользования не работает освещение.",
          circumstances: null,
          impact: null,
          subject: null,
          warnings: [],
        },
      }),
    );

    expect(result).toMatchObject({
      status: "failure",
      firstFailureStage: "canonical_validation",
      stages: [
        { stage: "json_parse", status: "pass" },
        { stage: "provider_wire_validation", status: "pass" },
        { stage: "canonical_validation", status: "fail" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_VALIDATION_MESSAGE_247");
  });
});
