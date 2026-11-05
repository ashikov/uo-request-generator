import { COMMON_LEGAL_BASIS_BLOCK } from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import { applySemanticRepair, prepareSemanticRepair } from "./manual/semantic-repair.js";

const input = {
  description: "Входная дверь не закрывается. Мне трудно пройти с коляской.",
  desiredActions: "Проверить дверь, заменить только если ремонт невозможен",
};
const draft = {
  outcome: "generated" as const,
  title: "Входная дверь",
  problem: "Входная дверь не закрывается.",
  circumstances: null,
  impact: "Проход с коляской затруднён.",
  subject: null,
  warnings: [],
};

describe("isolated semantic repair", () => {
  it("validates input and original draft before preparing a request", () => {
    expect(() => prepareSemanticRepair({ description: " " }, draft)).toThrow();
    expect(() => prepareSemanticRepair(input, { ...draft, requestItems: [] })).toThrow();
    const prepared = prepareSemanticRepair(input, draft);
    expect(JSON.parse(prepared.userMessage)).toEqual({ input, draft });
  });

  it("keeps an unchanged draft exactly and renders backend requirements and norms", () => {
    const prepared = prepareSemanticRepair(input, draft);
    const result = applySemanticRepair(
      prepared,
      JSON.stringify({ status: "unchanged", draft: null }),
    );
    expect(result.status).toBe("unchanged");
    if (result.status === "rejected") throw new Error("unexpected rejection");
    expect(result.draft).toEqual(draft);
    expect(result.document.body).toContain(input.desiredActions);
    expect(result.document.body).toContain(COMMON_LEGAL_BASIS_BLOCK);
  });

  it("accepts a minimal correction through the existing renderer", () => {
    const corrected = { ...draft, impact: "Мне трудно пройти с коляской." };
    const result = applySemanticRepair(
      prepareSemanticRepair(input, draft),
      JSON.stringify({ status: "corrected", draft: corrected }),
    );
    expect(result.status).toBe("corrected");
    if (result.status === "rejected") throw new Error("unexpected rejection");
    expect(result.document.body).toContain("Мне трудно пройти с коляской.");
    expect(result.document.body).toContain(input.desiredActions);
  });

  it("returns no document on rejection", () => {
    expect(
      applySemanticRepair(
        prepareSemanticRepair(input, draft),
        JSON.stringify({ status: "rejected", draft: null }),
      ),
    ).toEqual({ status: "rejected" });
  });

  it.each([
    "not json",
    JSON.stringify({ status: "verified", draft: null }),
    JSON.stringify({ status: "unchanged", draft }),
    JSON.stringify({ status: "corrected", draft: null }),
    JSON.stringify({ status: "rejected", draft: null, body: "partial" }),
    JSON.stringify({
      status: "corrected",
      draft: {
        ...draft,
        subject: {
          kind: "common_area_door",
          evidence: [{ sourceField: "description", quote: "Входная дверь" }],
        },
      },
    }),
    JSON.stringify({ status: "corrected", draft: { ...draft, desiredActions: "Заменить дверь" } }),
  ])("fails closed without returning the original for invalid response %s", (response) => {
    expect(() => applySemanticRepair(prepareSemanticRepair(input, draft), response)).toThrow();
  });
});

import { runSemanticRepair } from "./manual/semantic-repair.js";

it("dispatches once with privacy and records usage even when semantic response is invalid", async () => {
  let calls = 0;
  const attempt = await runSemanticRepair(
    prepareSemanticRepair(input, draft),
    {
      apiUrl: "https://provider.invalid/responses",
      apiKey: "synthetic",
      model: "synthetic",
      authScheme: "Bearer",
      apiProtocol: "responses",
      provider: "custom",
    },
    async (_url, init) => {
      calls++;
      expect(init?.redirect).toBe("error");
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(JSON.parse(body.input)).toEqual({ input, draft });
      return new Response(
        JSON.stringify({
          status: "completed",
          output_text: "invalid",
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        }),
      );
    },
  );
  expect(calls).toBe(1);
  expect(attempt.error).toBe("invalid_response");
  expect(attempt.usage?.total_tokens).toBe(120);
  expect(attempt.result).toBeUndefined();
});
