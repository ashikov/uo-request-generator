import { generateRequestLimits } from "@uo-request-generator/core";
import { DisabledLlmGateway } from "@uo-request-generator/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

type ApiErrorCode = "generation_provider_unavailable" | "validation_error";

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function expectApiError(payload: unknown, expected: { code: ApiErrorCode; message: string }): void {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    throw new Error("Expected an API error object");
  }

  const apiError = payload.error;
  if (
    typeof apiError !== "object" ||
    apiError === null ||
    !("requestId" in apiError) ||
    typeof apiError.requestId !== "string"
  ) {
    throw new Error("Expected an API error with a request ID");
  }

  expect(payload).toEqual({
    error: {
      ...expected,
      requestId: apiError.requestId,
    },
  });
  expect(apiError.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
}

async function injectGenerate(
  payload: Record<string, unknown>,
  gateway = new DisabledLlmGateway(),
) {
  const app = createApp({ llmGateway: gateway });
  apps.push(app);

  return await app.inject({
    method: "POST",
    url: "/api/generate",
    headers: {
      "content-type": "application/json",
    },
    payload,
  });
}

describe("POST /api/generate", () => {
  it("passes valid input to the disabled gateway and returns its public error", async () => {
    const gateway = new DisabledLlmGateway();
    const generateRequest = vi.spyOn(gateway, "generateRequest");
    const input = {
      description: "На лестничной площадке не горит свет",
    };

    const response = await injectGenerate(input, gateway);

    expect(generateRequest).toHaveBeenCalledOnce();
    expect(generateRequest).toHaveBeenCalledWith(input);
    expect(response.statusCode).toBe(503);
    expectApiError(response.json(), {
      code: "generation_provider_unavailable",
      message: "Генерация пока не подключена",
    });
  });

  it("rejects a description shorter than the minimum", async () => {
    const response = await injectGenerate({ description: "Течь" });

    expect(response.statusCode).toBe(400);
    expectApiError(response.json(), {
      code: "validation_error",
      message: "Проверьте формат и содержание запроса",
    });
  });

  it("returns the validation error format for malformed JSON", async () => {
    const app = createApp();
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/generate",
      headers: {
        "content-type": "application/json",
      },
      payload: '{"description":',
    });

    expect(response.statusCode).toBe(400);
    expectApiError(response.json(), {
      code: "validation_error",
      message: "Проверьте формат и содержание запроса",
    });
  });

  it("rejects a description longer than the maximum", async () => {
    const response = await injectGenerate({
      description: "а".repeat(generateRequestLimits.description.max + 1),
    });

    expect(response.statusCode).toBe(400);
    expectApiError(response.json(), {
      code: "validation_error",
      message: "Проверьте формат и содержание запроса",
    });
  });

  it("accepts the optional location", async () => {
    const gateway = new DisabledLlmGateway();
    const generateRequest = vi.spyOn(gateway, "generateRequest");
    const input = {
      description: "На лестничной площадке не горит свет",
      location: "Третий этаж",
    };

    const response = await injectGenerate(input, gateway);

    expect(generateRequest).toHaveBeenCalledWith(input);
    expect(response.statusCode).toBe(503);
  });

  it("rejects a location longer than the maximum", async () => {
    const response = await injectGenerate({
      description: "На лестничной площадке не горит свет",
      location: "а".repeat(generateRequestLimits.location.max + 1),
    });

    expect(response.statusCode).toBe(400);
    expectApiError(response.json(), {
      code: "validation_error",
      message: "Проверьте формат и содержание запроса",
    });
  });

  it("does not expose user input in an infrastructure error", async () => {
    const privateInput = "На площадке пахнет, личная деталь 8472";

    const response = await injectGenerate({ description: privateInput });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(privateInput);
    expect(response.body).not.toContain("Generation provider is not configured");
  });
});
