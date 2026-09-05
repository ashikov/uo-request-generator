import {
  PRIMARY_REQUEST_SUBJECT_KINDS,
  primaryRequestDraftLimits,
  primaryRequestSubjectLimits,
} from "@uo-request-generator/core";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestDraftJsonSchema } from "../../../packages/llm/src/request-draft.js";

const DESCRIPTION = "На лестничной площадке не работает освещение.";

function createDraft(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    outcome: "generated",
    title: "Не работает освещение",
    problem: DESCRIPTION,
    circumstances: null,
    impact: null,
    subject: null,
    warnings: [],
    ...overrides,
  };
}

async function providerSchemaAccepts(
  app: FastifyInstance,
  route: "/without-subject" | "/with-subject",
  draft: unknown,
): Promise<{ accepted: boolean; error: string }> {
  const response = await app.inject({ method: "POST", url: route, payload: { draft } });
  return { accepted: response.statusCode === 200, error: response.body };
}

describe("provider JSON Schema", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
    app.post(
      "/without-subject",
      { schema: { body: createRequestDraftJsonSchema(undefined) } },
      async () => ({ accepted: true }),
    );
    app.post(
      "/with-subject",
      { schema: { body: createRequestDraftJsonSchema(PRIMARY_REQUEST_SUBJECT_KINDS[0]) } },
      async () => ({ accepted: true }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("принимает generated и canonical multiple_issues", async () => {
    expect((await providerSchemaAccepts(app, "/without-subject", createDraft())).accepted).toBe(
      true,
    );
    expect(
      (
        await providerSchemaAccepts(app, "/without-subject", {
          outcome: "multiple_issues",
          title: null,
          problem: null,
          circumstances: null,
          impact: null,
          subject: null,
          warnings: [],
        })
      ).accepted,
    ).toBe(true);
  });

  it("не содержит полей для формирования раздела требований", () => {
    const serializedSchema = JSON.stringify(createRequestDraftJsonSchema(undefined));

    for (const obsoleteField of [
      "verificationDecision",
      "actionPlanDecision",
      "desiredActionsAllocation",
      "preliminaryCheck",
      "remedyActions",
      "resultCheck",
      "resolve_observed_problem",
    ]) {
      expect(serializedSchema).not.toContain(obsoleteField);
    }
  });

  it("сохраняет границы Unicode для описательных полей и subject evidence", async () => {
    const astral = "😀";
    const drafts = [
      {
        name: "title",
        route: "/without-subject" as const,
        draft: createDraft({ title: astral.repeat(primaryRequestDraftLimits.title.max) }),
      },
      {
        name: "warning",
        route: "/without-subject" as const,
        draft: createDraft({ warnings: [astral.repeat(primaryRequestDraftLimits.warning.max)] }),
      },
      {
        name: "subject evidence",
        route: "/with-subject" as const,
        draft: createDraft({
          subject: {
            kind: PRIMARY_REQUEST_SUBJECT_KINDS[0],
            evidence: [
              {
                sourceField: "description",
                quote: astral.repeat(primaryRequestSubjectLimits.quote.max),
              },
            ],
          },
        }),
      },
    ];

    for (const { draft, name, route } of drafts) {
      const providerResult = await providerSchemaAccepts(app, route, draft);
      expect(providerResult.accepted, `${name}: ${providerResult.error}`).toBe(true);
    }
  });

  it("fail closed отклоняет старую ontology и malformed результат", async () => {
    const drafts = [
      createDraft({ actionPlanDecision: null }),
      createDraft({ requestItems: ["Восстановить освещение"] }),
      createDraft({ title: { malformed: true } }),
      createDraft({ outcome: "unknown" }),
      { outcome: "multiple_issues", providerText: "Лишнее поле" },
    ];

    for (const draft of drafts) {
      expect((await providerSchemaAccepts(app, "/without-subject", draft)).accepted).toBe(false);
    }
  });

  it("subject evidence остаётся разрешён только при подтверждённом subject path", async () => {
    const subject = {
      kind: PRIMARY_REQUEST_SUBJECT_KINDS[0],
      evidence: [{ sourceField: "description", quote: "лестничной площадке" }],
    };

    expect(
      (await providerSchemaAccepts(app, "/with-subject", createDraft({ subject }))).accepted,
    ).toBe(true);
    expect(
      (await providerSchemaAccepts(app, "/without-subject", createDraft({ subject }))).accepted,
    ).toBe(false);
  });
});
