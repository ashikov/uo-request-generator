import { afterEach, describe, expect, it, vi } from "vitest";

const DESCRIPTION = "На лестничной площадке не работает освещение несколько дней.";
const INPUT = { description: DESCRIPTION };
const GATEWAY_CONFIG = {
  apiUrl: "https://provider.example/v1/chat/completions",
  apiKey: "test-key",
  model: "test-model",
  provider: "test-provider",
  authScheme: "Bearer",
  apiProtocol: "chat-completions" as const,
};

function mockSuccessfulProviderResponse(): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                draft: {
                  outcome: "generated",
                  title: "Не работает освещение",
                  problem: DESCRIPTION,
                  circumstances: null,
                  impact: null,
                  subject: null,
                  warnings: [],
                },
              }),
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );
}

function mockCoreFailure(stage: "subject_legal_selection" | "renderer", sentinel: string): void {
  vi.doMock("@uo-request-generator/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@uo-request-generator/core")>();
    if (stage === "subject_legal_selection") {
      return {
        ...actual,
        evaluateSpecificLegalBasisSelection: () => {
          throw new Error(sentinel);
        },
      };
    }
    return {
      ...actual,
      renderPrimaryRequestDraft: () => {
        throw new Error(sentinel);
      },
    };
  });
}

describe("evaluation downstream failure diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@uo-request-generator/core");
    vi.resetModules();
  });

  it.each([
    "subject_legal_selection",
    "renderer",
  ] as const)("фиксирует unexpected %s failure без деталей исключения", async (stage) => {
    const sentinel = `SECRET_${stage.toUpperCase()}_247`;
    mockCoreFailure(stage, sentinel);
    mockSuccessfulProviderResponse();
    const { OpenAiCompatibleGateway } = await import("../src/openai-compatible-gateway.js");

    const generation = await new OpenAiCompatibleGateway(
      GATEWAY_CONFIG,
    ).generateRequestForEvaluation(INPUT);

    expect(generation).toMatchObject({
      status: "failure",
      failureStatus: "invalid_response",
      diagnosticTrace: {
        status: "failed",
        firstFailureStage: stage,
        stages: expect.arrayContaining([{ stage, status: "fail" }]),
      },
    });
    expect(JSON.stringify(generation)).not.toContain(sentinel);
  });
});
