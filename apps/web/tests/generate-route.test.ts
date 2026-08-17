import { generateRequestLimits, type LlmGateway } from "@uo-request-generator/core";
import { DisabledLlmGateway } from "@uo-request-generator/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

type ApiErrorCode =
  | "generation_provider_unavailable"
  | "internal_error"
  | "multiple_issues"
  | "validation_error";

const generationRateLimitConfig = {
  ipRequestLimit: 100,
  ipWindowMs: 60_000,
  clientDailyLimit: 100,
  cookieSecret: "test-cookie-signing-secret-32-characters",
  trustedProxies: [],
  stateCapacity: 1_000,
} as const;

const generationSafeguardConfig = {
  enabled: true,
  dailyLimit: 100,
  concurrencyLimit: 100,
} as const;

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
  gateway: LlmGateway = new DisabledLlmGateway(),
) {
  const app = createApp({
    llmGateway: gateway,
    generationRateLimitConfig,
    generationSafeguardConfig,
    smartCaptchaConfig: { mode: "disabled" },
  });
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
  it("возвращает результат настроенного gateway", async () => {
    const generatedRequest = {
      title: "Не работает освещение",
      body: "На лестничной площадке не горит свет.\nПрошу: проверить и восстановить освещение.",
      warnings: [],
    };
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue({ status: "generated", result: generatedRequest });
    const gateway: LlmGateway = { generateRequest };
    const input = {
      description: "На лестничной площадке не горит свет",
      location: "Третий этаж",
    };

    const response = await injectGenerate(input, gateway);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(generatedRequest);
    expect(generateRequest).toHaveBeenCalledOnce();
    expect(generateRequest).toHaveBeenCalledWith(input, expect.any(String));
  });

  it("возвращает контролируемый HTTP 400 для multiple_issues", async () => {
    const generateRequest = vi
      .fn<LlmGateway["generateRequest"]>()
      .mockResolvedValue({ status: "multiple_issues" });
    const gateway: LlmGateway = { generateRequest };
    const input = {
      description: "На детской площадке сломаны качели, а в соседнем дворе лежит старый диван.",
    };

    const response = await injectGenerate(input, gateway);

    expect(response.statusCode).toBe(400);
    expectApiError(response.json(), {
      code: "multiple_issues",
      message: "Опишите одну проблему. Для каждой отдельной проблемы составьте отдельную заявку.",
    });
    expect(response.body).not.toContain(input.description);
    expect(generateRequest).toHaveBeenCalledOnce();
  });

  it("passes valid input to the disabled gateway and returns its public error", async () => {
    const gateway = new DisabledLlmGateway();
    const generateRequest = vi.spyOn(gateway, "generateRequest");
    const input = {
      description: "На лестничной площадке не горит свет",
    };

    const response = await injectGenerate(input, gateway);

    expect(generateRequest).toHaveBeenCalledOnce();
    expect(generateRequest).toHaveBeenCalledWith(input, expect.any(String));
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

    expect(generateRequest).toHaveBeenCalledWith(input, expect.any(String));
    expect(response.statusCode).toBe(503);
  });

  it("не передаёт подтверждение предмета по умолчанию в gateway", async () => {
    const gateway = new DisabledLlmGateway();
    const generateRequest = vi.spyOn(gateway, "generateRequest");
    const input = {
      description: "Входная дверь подъезда не закрывается",
    };

    const response = await injectGenerate(input, gateway);

    expect(generateRequest).toHaveBeenCalledWith(input, expect.any(String));
    expect(response.statusCode).toBe(503);
  });

  it("отклоняет неподдерживаемое значение подтверждённого предмета", async () => {
    const response = await injectGenerate({
      description: "Входная дверь подъезда не закрывается",
      confirmedProblemSubject: "door",
    } as never);

    expect(response.statusCode).toBe(400);
    expectApiError(response.json(), {
      code: "validation_error",
      message: "Проверьте формат и содержание запроса",
    });
  });

  it.each([
    ["common_area_entrance_door", "Входная дверь подъезда не закрывается"],
    [
      "common_area_premises_lighting",
      "В общем коридоре многоквартирного дома не работает освещение",
    ],
    ["common_area_premises_cleaning", "В подъезде многоквартирного дома не выполнена уборка"],
    ["common_area_roof", "На кровле многоквартирного дома обнаружена протечка"],
    [
      "common_area_ventilation",
      "Общедомовой вентиляционный канал, обслуживающий помещения подъезда, не работает",
    ],
  ] as const)("передаёт gateway явный выбранный предмет проблемы: %s", async (confirmedProblemSubject, description) => {
    const gateway = new DisabledLlmGateway();
    const generateRequest = vi.spyOn(gateway, "generateRequest");
    const input = {
      description,
      confirmedProblemSubject,
    };

    const response = await injectGenerate(input, gateway);

    expect(generateRequest).toHaveBeenCalledWith(input, expect.any(String));
    expect(response.statusCode).toBe(503);
  });

  it.each([
    ["только последствия", { consequences: "В вечернее время проход затруднён" }],
    ["только желаемые действия", { desiredActions: "Проверить и восстановить освещение" }],
    [
      "оба дополнительных поля",
      {
        consequences: "В вечернее время проход затруднён",
        desiredActions: "Проверить и восстановить освещение",
      },
    ],
  ])("передаёт gateway %s", async (_caseName, context) => {
    const gateway = new DisabledLlmGateway();
    const generateRequest = vi.spyOn(gateway, "generateRequest");
    const input = {
      description: "На лестничной площадке не горит свет",
      ...context,
    };

    const response = await injectGenerate(input, gateway);

    expect(generateRequest).toHaveBeenCalledWith(input, expect.any(String));
    expect(response.statusCode).toBe(503);
  });

  it.each([
    ["пустые последствия", { consequences: "" }],
    ["пробельные последствия", { consequences: "   " }],
    ["пустые желаемые действия", { desiredActions: "" }],
    ["пробельные желаемые действия", { desiredActions: "   " }],
  ])("отклоняет %s", async (_caseName, context) => {
    const response = await injectGenerate({
      description: "На лестничной площадке не горит свет",
      ...context,
    });

    expect(response.statusCode).toBe(400);
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

  it.each([
    ["последствия", "consequences", generateRequestLimits.consequences.max],
    ["желаемые действия", "desiredActions", generateRequestLimits.desiredActions.max],
  ] as const)("отклоняет слишком длинные %s", async (_caseName, field, max) => {
    const response = await injectGenerate({
      description: "На лестничной площадке не горит свет",
      [field]: "а".repeat(max + 1),
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not expose user input in an infrastructure error", async () => {
    const privateInput = "На площадке пахнет, личная деталь 8472";

    const response = await injectGenerate({ description: privateInput });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(privateInput);
    expect(response.body).not.toContain("Generation provider is not configured");
  });

  it("does not report an unknown gateway error as provider unavailability", async () => {
    const privateInput = "На площадке пахнет, личная деталь 8472";
    const gatewayErrorMessage = "Unexpected gateway failure 9135";
    const failingGateway: LlmGateway = {
      async generateRequest() {
        throw new Error(gatewayErrorMessage);
      },
    };

    const response = await injectGenerate({ description: privateInput }, failingGateway);

    expect(response.statusCode).toBe(500);
    expectApiError(response.json(), {
      code: "internal_error",
      message: "Не удалось составить заявку",
    });
    expect(response.body).not.toContain(privateInput);
    expect(response.body).not.toContain(gatewayErrorMessage);
  });
});
