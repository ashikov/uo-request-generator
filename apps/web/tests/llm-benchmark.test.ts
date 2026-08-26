import type {
  GenerateRequestInput,
  GenerateRequestOutcome,
  PrimaryRequestDraft,
} from "@uo-request-generator/core";
import { readFileSync } from "node:fs";
import { OpenAiCompatibleGateway } from "@uo-request-generator/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scenarios } from "../../../packages/core/tests/fixtures.js";
import {
  createBenchmarkPlan,
  DEFAULT_BENCHMARK_REPEATS,
  MAX_BENCHMARK_REQUESTS,
  MAX_BENCHMARK_REPEATS,
  parseBenchmarkConfig,
  runLlmBenchmark,
  selectBenchmarkScenarios,
  type BenchmarkDependencies,
} from "./manual/llm-benchmark.js";

const CONFIG_PATH = ".llm-benchmark.local.json";
const API_KEY = "benchmark-secret-key";
const VALID_CONFIG = {
  currency: "RUB",
  apiProtocol: "responses",
  maxOutputTokens: 1200,
  models: [
    {
      label: "current",
      model: "model-current",
      inputPricePerMillion: 10,
      outputPricePerMillion: 20,
    },
    {
      label: "candidate",
      model: "model-candidate",
      inputPricePerMillion: 30,
      outputPricePerMillion: 40,
    },
  ],
} as const;

const GENERATED_OUTCOME: GenerateRequestOutcome = {
  status: "generated",
  result: {
    title: "Не работает освещение",
    body: [
      "На лестничной площадке не работает освещение.",
      "",
      "В соответствии с частями 1 и 2.3 статьи 161 Жилищного кодекса РФ управление многоквартирным домом должно обеспечивать благоприятные и безопасные условия проживания граждан, а управляющая организация несёт ответственность за надлежащее содержание общего имущества.",
      "",
      "Подпункт «з» пункта 4 Правил осуществления деятельности по управлению многоквартирными домами, утверждённых постановлением Правительства РФ от 15.05.2013 № 416, предусматривает приём и рассмотрение заявок, предложений и обращений собственников и пользователей помещений.",
      "",
      "Прошу:",
      "1. Проверить и восстановить освещение",
    ].join("\n"),
    warnings: [],
  },
};

const EVALUATION_DRAFT: PrimaryRequestDraft = {
  title: "Не работает освещение",
  problem: "На лестничной площадке не работает освещение.",
  circumstances: null,
  impact: null,
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck: null,
    remedyActions: ["Проверить и восстановить освещение"],
    resultCheck: null,
  },
  warnings: [],
};

function dependencies(overrides: Partial<BenchmarkDependencies> = {}): BenchmarkDependencies {
  return {
    environment: {
      LLM_API_URL: "https://provider.example/v1/responses",
      LLM_API_KEY: API_KEY,
      LLM_AUTH_SCHEME: "Bearer",
      LLM_PROVIDER: "benchmark-provider",
    },
    isStdinTty: true,
    readFile: vi.fn().mockResolvedValue(JSON.stringify(VALID_CONFIG)),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(""),
    writeLine: vi.fn(),
    now: () => new Date("2026-08-13T04:00:00.000Z"),
    monotonicNow: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(25),
    isInterrupted: () => false,
    sourceState: () => ({ status: "clean", commitSha: "test-commit" }),
    createGateway: vi.fn(() => ({
      generateRequestForEvaluation: vi.fn().mockResolvedValue({
        status: "success",
        outcome: GENERATED_OUTCOME,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }),
    })),
    ...overrides,
  };
}

function configForModels(modelLabels: readonly string[]) {
  return {
    ...VALID_CONFIG,
    models: modelLabels.map((label, index) => ({
      label,
      model: label,
      inputPricePerMillion: 10 + index,
      outputPricePerMillion: 20 + index,
    })),
  };
}

describe("LLM benchmark", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("отклоняет конфигурацию без явно выбранных моделей", () => {
    expect(() => parseBenchmarkConfig({ ...VALID_CONFIG, models: [] })).toThrow(
      "Нужно явно указать хотя бы одну benchmark-модель",
    );
  });

  it("по умолчанию строит только план и не создаёт gateway", async () => {
    const runtime = dependencies();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(runLlmBenchmark(["--config", CONFIG_PATH], runtime)).resolves.toBe(0);

    expect(runtime.createGateway).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runtime.writeFile).not.toHaveBeenCalled();
    expect(runtime.confirm).not.toHaveBeenCalled();
    expect(runtime.writeLine).toHaveBeenCalledWith("Source state: clean (test-commit)");
  });

  it("показывает безопасное dirty source state в plan mode без платных side effects", async () => {
    const runtime = dependencies({
      sourceState: () => ({ status: "dirty", tracked: true, untracked: true }),
    });

    await expect(runLlmBenchmark(["--config", CONFIG_PATH], runtime)).resolves.toBe(0);

    expect(runtime.writeLine).toHaveBeenCalledWith(
      "Source state: dirty (tracked: yes, untracked: yes)",
    );
    expect(runtime.confirm).not.toHaveBeenCalled();
    expect(runtime.createGateway).not.toHaveBeenCalled();
    expect(runtime.writeFile).not.toHaveBeenCalled();
  });

  it("допускает paid run только для clean source state", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await expect(
      runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime),
    ).resolves.toBe(0);

    expect(runtime.confirm).toHaveBeenCalledOnce();
    expect(generateRequestForEvaluation).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["dirty", { status: "dirty" as const, tracked: true, untracked: false }],
    ["unavailable", { status: "unavailable" as const }],
  ])("блокирует paid run для %s source state до всех платных side effects", async (_name, sourceState) => {
    const runtime = dependencies({
      sourceState: () => sourceState,
      confirm: vi.fn().mockResolvedValue("RUN 2"),
    });

    await expect(
      runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime),
    ).resolves.toBe(1);

    expect(runtime.confirm).not.toHaveBeenCalled();
    expect(runtime.createGateway).not.toHaveBeenCalled();
    expect(runtime.writeFile).not.toHaveBeenCalled();
  });

  it("plan mode работает без API key и provider environment", async () => {
    const runtime = dependencies({ environment: {} });

    await expect(runLlmBenchmark(["--config", CONFIG_PATH], runtime)).resolves.toBe(0);

    expect(runtime.createGateway).not.toHaveBeenCalled();
  });

  it("принимает ведущий pnpm separator из документированной команды", async () => {
    const runtime = dependencies();

    await expect(runLlmBenchmark(["--", "--config", CONFIG_PATH], runtime)).resolves.toBe(0);

    expect(runtime.createGateway).not.toHaveBeenCalled();
  });

  it("не выполняет запрос без отдельного интерактивного подтверждения", async () => {
    const runtime = dependencies({ confirm: vi.fn().mockResolvedValue("") });

    await expect(runLlmBenchmark(["--config", CONFIG_PATH, "--run"], runtime)).resolves.toBe(1);

    expect(runtime.createGateway).not.toHaveBeenCalled();
    expect(runtime.writeLine).toHaveBeenCalledWith("Запуск отменён. Выполнено 0 запросов.");
  });

  it("блокирует --run при non-TTY stdin", async () => {
    const runtime = dependencies({ isStdinTty: false });

    await expect(runLlmBenchmark(["--config", CONFIG_PATH, "--run"], runtime)).resolves.toBe(1);

    expect(runtime.confirm).not.toHaveBeenCalled();
    expect(runtime.createGateway).not.toHaveBeenCalled();
    expect(runtime.writeLine).toHaveBeenCalledWith(
      "Платный запуск доступен только в интерактивном терминале. Выполнено 0 запросов.",
    );
  });

  it("не принимает неверную confirmation phrase", async () => {
    const runtime = dependencies({ confirm: vi.fn().mockResolvedValue("RUN 5") });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(runtime.createGateway).not.toHaveBeenCalled();
    expect(runtime.writeLine).toHaveBeenCalledWith("Запуск отменён. Выполнено 0 запросов.");
  });

  it("считает models × scenarios × repeats", () => {
    const config = parseBenchmarkConfig(VALID_CONFIG);
    const selectedScenarios = selectBenchmarkScenarios({ scenarioIds: [], limit: 3 });
    const plan = createBenchmarkPlan(
      config,
      selectedScenarios,
      4,
      new Date("2026-08-13T04:00:00.000Z"),
    );

    expect(plan.totalRequests).toBe(2 * 3 * 4);
    expect(plan.maximumCost).toBeCloseTo(
      plan.requests.reduce(
        (sum, request) =>
          sum +
          (request.inputTokenUpperBound * request.model.inputPricePerMillion) / 1_000_000 +
          (VALID_CONFIG.maxOutputTokens * request.model.outputPricePerMillion) / 1_000_000,
        0,
      ),
      12,
    );
    expect(
      plan.requests.map((request) => [request.model.label, request.scenario.id, request.repeat]),
    ).toEqual([
      ["current", scenarios[0]?.id, 1],
      ["current", scenarios[0]?.id, 2],
      ["current", scenarios[0]?.id, 3],
      ["current", scenarios[0]?.id, 4],
      ["current", scenarios[1]?.id, 1],
      ["current", scenarios[1]?.id, 2],
      ["current", scenarios[1]?.id, 3],
      ["current", scenarios[1]?.id, 4],
      ["current", scenarios[2]?.id, 1],
      ["current", scenarios[2]?.id, 2],
      ["current", scenarios[2]?.id, 3],
      ["current", scenarios[2]?.id, 4],
      ["candidate", scenarios[0]?.id, 1],
      ["candidate", scenarios[0]?.id, 2],
      ["candidate", scenarios[0]?.id, 3],
      ["candidate", scenarios[0]?.id, 4],
      ["candidate", scenarios[1]?.id, 1],
      ["candidate", scenarios[1]?.id, 2],
      ["candidate", scenarios[1]?.id, 3],
      ["candidate", scenarios[1]?.id, 4],
      ["candidate", scenarios[2]?.id, 1],
      ["candidate", scenarios[2]?.id, 2],
      ["candidate", scenarios[2]?.id, 3],
      ["candidate", scenarios[2]?.id, 4],
    ]);
  });

  it("выбирает scenarios в fixture-порядке и запрещает смешивать IDs с limit", () => {
    const selected = selectBenchmarkScenarios({
      scenarioIds: ["minimum-sufficient-requests", "only-description"],
    });

    expect(selected.map((scenario) => scenario.id)).toEqual([
      "only-description",
      "minimum-sufficient-requests",
    ]);
    expect(() => selectBenchmarkScenarios({ scenarioIds: ["only-description"], limit: 1 })).toThrow(
      "Нельзя одновременно использовать --scenario и --limit",
    );
  });

  it("использует repeats=1 по умолчанию и консервативный верхний предел", async () => {
    expect(DEFAULT_BENCHMARK_REPEATS).toBe(1);
    expect(MAX_BENCHMARK_REPEATS).toBe(5);

    const runtime = dependencies();
    await expect(
      runLlmBenchmark(
        ["--config", CONFIG_PATH, "--repeats", String(MAX_BENCHMARK_REPEATS + 1)],
        runtime,
      ),
    ).resolves.toBe(1);
    expect(runtime.createGateway).not.toHaveBeenCalled();
  });

  it("fail closed отклоняет план со слишком большим общим числом запросов", () => {
    const config = parseBenchmarkConfig({
      ...VALID_CONFIG,
      models: Array.from({ length: 10 }, (_, index) => ({
        label: `model-${String(index)}`,
        model: `model-id-${String(index)}`,
        inputPricePerMillion: 1,
        outputPricePerMillion: 1,
      })),
    });

    expect(MAX_BENCHMARK_REQUESTS).toBe(100);
    expect(() => createBenchmarkPlan(config, scenarios, 1, new Date())).toThrow(
      "План не может содержать больше 100 запросов",
    );
  });

  it("запрещает paid run без pricing", async () => {
    const configWithoutPrice = {
      ...VALID_CONFIG,
      models: [{ label: "candidate", model: "candidate-id" }],
    };
    const runtime = dependencies({
      readFile: vi.fn().mockResolvedValue(JSON.stringify(configWithoutPrice)),
      confirm: vi.fn().mockResolvedValue("RUN 14"),
    });

    await expect(runLlmBenchmark(["--config", CONFIG_PATH, "--run"], runtime)).resolves.toBe(1);
    expect(runtime.createGateway).not.toHaveBeenCalled();
  });

  it("показывает maximum cost до первого provider request", async () => {
    const events: string[] = [];
    const gateway = {
      generateRequestForEvaluation: vi.fn(async () => {
        events.push("request");
        return { status: "success" as const, outcome: GENERATED_OUTCOME };
      }),
    };
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      writeLine: vi.fn((line: string) => events.push(line)),
      createGateway: vi.fn(() => gateway),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(
      events.findIndex((event) => event.startsWith("Максимальная оценочная стоимость:")),
    ).toBeGreaterThanOrEqual(0);
    expect(
      events.findIndex((event) => event.startsWith("Максимальная оценочная стоимость:")),
    ).toBeLessThan(events.indexOf("request"));
  });

  it("продолжает benchmark после request-level failure без retry", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        providerHttpStatus: 400,
      })
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(generateRequestForEvaluation).toHaveBeenCalledTimes(2);
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Status: completed");
    expect(report).toContain("Failure kind: request");
    expect(report).toContain("HTTP status: 400");
    expect(report).toContain("Outcome: `generated`");
  });

  it("локализует provider failure после части requests первой модели", async () => {
    const modelAGenerate = vi
      .fn()
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME })
      .mockResolvedValueOnce({
        status: "failure",
        failureKind: "provider",
        error: "provider unavailable",
      });
    const modelBGenerate = vi
      .fn()
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const createGateway = vi.fn(({ model }: { model: string }) => ({
      generateRequestForEvaluation: model === "model-a" ? modelAGenerate : modelBGenerate,
    }));
    const runtime = dependencies({
      readFile: vi.fn().mockResolvedValue(JSON.stringify(configForModels(["model-a", "model-b"]))),
      confirm: vi.fn().mockResolvedValue("RUN 8"),
      monotonicNow: vi.fn().mockReturnValue(10),
      createGateway,
    });

    const exitCode = await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "2", "--repeats", "2"],
      runtime,
    );

    expect(exitCode).toBe(1);
    expect(modelAGenerate).toHaveBeenCalledTimes(2);
    expect(modelBGenerate).toHaveBeenCalledTimes(4);
    expect(modelAGenerate.mock.calls.length + modelBGenerate.mock.calls.length).toBeLessThanOrEqual(
      8,
    );
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Status: partial");
    expect(report).toContain("Attempted requests: 6 / 8");
    expect(report).toContain("Provider failures: 1");
    expect(report).toContain("Skipped after model provider failure: 2");
    expect(report).toContain(
      "model-a / description-location / repeat 1: skipped after provider failure for this model",
    );
    expect(report).toContain(
      "model-a / description-location / repeat 2: skipped after provider failure for this model",
    );
  });

  it("пропускает остаток модели после provider failure на первом request", async () => {
    const modelAGenerate = vi.fn().mockResolvedValue({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
    });
    const modelBGenerate = vi
      .fn()
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      readFile: vi.fn().mockResolvedValue(JSON.stringify(configForModels(["model-a", "model-b"]))),
      confirm: vi.fn().mockResolvedValue("RUN 6"),
      monotonicNow: vi.fn().mockReturnValue(10),
      createGateway: vi.fn(({ model }) => ({
        generateRequestForEvaluation: model === "model-a" ? modelAGenerate : modelBGenerate,
      })),
    });

    await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1", "--repeats", "3"],
      runtime,
    );

    expect(modelAGenerate).toHaveBeenCalledOnce();
    expect(modelBGenerate).toHaveBeenCalledTimes(3);
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Attempted requests: 4 / 6");
    expect(report).toContain("Skipped after model provider failure: 2");
  });

  it("продолжает третью модель после provider failure средней модели", async () => {
    const modelAGenerate = vi
      .fn()
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const modelBGenerate = vi.fn().mockResolvedValue({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
    });
    const modelCGenerate = vi
      .fn()
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const generators = new Map([
      ["model-a", modelAGenerate],
      ["model-b", modelBGenerate],
      ["model-c", modelCGenerate],
    ]);
    const runtime = dependencies({
      readFile: vi
        .fn()
        .mockResolvedValue(JSON.stringify(configForModels(["model-a", "model-b", "model-c"]))),
      confirm: vi.fn().mockResolvedValue("RUN 6"),
      monotonicNow: vi.fn().mockReturnValue(10),
      createGateway: vi.fn(({ model }) => {
        const generateRequestForEvaluation = generators.get(model);
        if (generateRequestForEvaluation === undefined) {
          throw new Error("unexpected synthetic model");
        }
        return { generateRequestForEvaluation };
      }),
    });

    await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1", "--repeats", "2"],
      runtime,
    );

    expect(modelAGenerate).toHaveBeenCalledTimes(2);
    expect(modelBGenerate).toHaveBeenCalledOnce();
    expect(modelCGenerate).toHaveBeenCalledTimes(2);
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Attempted requests: 5 / 6");
    expect(report).toContain("model-b / only-description / repeat 2: skipped");
  });

  it("не локализует request-level failure на всю model group", async () => {
    const modelAGenerate = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failure",
        failureKind: "request",
        error: "request failed",
      })
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME });
    const modelBGenerate = vi
      .fn()
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      readFile: vi.fn().mockResolvedValue(JSON.stringify(configForModels(["model-a", "model-b"]))),
      confirm: vi.fn().mockResolvedValue("RUN 4"),
      monotonicNow: vi.fn().mockReturnValue(10),
      createGateway: vi.fn(({ model }) => ({
        generateRequestForEvaluation: model === "model-a" ? modelAGenerate : modelBGenerate,
      })),
    });

    const exitCode = await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1", "--repeats", "2"],
      runtime,
    );

    expect(exitCode).toBe(1);
    expect(modelAGenerate).toHaveBeenCalledTimes(2);
    expect(modelBGenerate).toHaveBeenCalledTimes(2);
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Status: completed");
    expect(report).toContain("Request failures: 1");
    expect(report).toContain("Skipped after model provider failure: 0");
  });

  it("оставляет single-model plan partial без retry после provider failure", async () => {
    const generateRequestForEvaluation = vi.fn().mockResolvedValue({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
    });
    const runtime = dependencies({
      readFile: vi.fn().mockResolvedValue(JSON.stringify(configForModels(["model-a"]))),
      confirm: vi.fn().mockResolvedValue("RUN 3"),
      monotonicNow: vi.fn().mockReturnValue(10),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    const exitCode = await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1", "--repeats", "3"],
      runtime,
    );

    expect(exitCode).toBe(1);
    expect(generateRequestForEvaluation).toHaveBeenCalledOnce();
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Status: partial");
    expect(report).toContain("Attempted requests: 1 / 3");
    expect(report).toContain("Skipped after model provider failure: 2");
    expect(report).toContain("hard-failing attempted repeats 1 / 1");
  });

  it("reports aggregate hard-check failure and exit 1 when a request failure precedes success", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failure",
        failureKind: "request",
        error: "first-request-failure",
        providerHttpStatus: 422,
      })
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    const exitCode = await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(exitCode).toBe(1);
    expect(report).toContain("Status: completed");
    expect(report).toContain("Failure kind: request");
    expect(report).toContain("Hard checks: FAIL");
  });

  it("reports aggregate hard-check failure and exit 1 for a provider partial run", async () => {
    const generateRequestForEvaluation = vi.fn().mockResolvedValue({
      status: "failure",
      failureKind: "provider",
      error: "provider-partial-run-failure",
    });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    const exitCode = await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(exitCode).toBe(1);
    expect(report).toContain("Status: partial");
    expect(report).toContain("Attempted requests: 2 / 2");
    expect(report).toContain("Provider failures: 2");
    expect(report).toContain("Hard checks: FAIL");
    expect(report).toContain(
      "current / only-description: planned repeats 1; attempted repeats 1 / 1; successful attempts 0; request failures 0; provider failures 1; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 1 / 1",
    );
    expect(report).toContain(
      "candidate / only-description: planned repeats 1; attempted repeats 1 / 1; successful attempts 0; request failures 0; provider failures 1; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 1 / 1",
    );
  });

  it("reports aggregate hard-check failure and exit 1 for an interrupted incomplete run", async () => {
    let interrupted = false;
    const generateRequestForEvaluation = vi.fn(async (_input: GenerateRequestInput) => {
      interrupted = true;
      return { status: "success" as const, outcome: GENERATED_OUTCOME };
    });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      isInterrupted: () => interrupted,
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    const exitCode = await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(exitCode).toBe(1);
    expect(report).toContain("Status: interrupted");
    expect(report).toContain("Attempted requests: 1 / 2");
    expect(report).toContain("Globally not run: 1");
    expect(report).toContain("Hard checks: FAIL");
    expect(report).toContain(
      "current / only-description: planned repeats 1; attempted repeats 1 / 1; successful attempts 1; request failures 0; provider failures 0; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 0 / 1",
    );
    expect(report).toContain(
      "candidate / only-description: planned repeats 1; attempted repeats 0 / 1; successful attempts 0; request failures 0; provider failures 0; skipped after model provider failure 0; globally not run 1; hard-failing attempted repeats 0 / 0",
    );
    expect(report).toContain(
      "candidate / only-description / repeat 1: not attempted because the whole run was interrupted",
    );
  });

  it("reports aggregate hard-check pass and exit 0 only for a fully completed successful run", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME })
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    const exitCode = await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(exitCode).toBe(0);
    expect(report).toContain("Status: completed");
    expect(report).toContain("Attempted requests: 2 / 2");
    expect(report).toContain("Hard checks: PASS");
  });

  it("aggregates all successful repeats separately by safe model label and scenario", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 6"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1", "--repeats", "3"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain(
      "current / only-description: planned repeats 3; attempted repeats 3 / 3; successful attempts 3; request failures 0; provider failures 0; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 0 / 3",
    );
    expect(report).toContain(
      "candidate / only-description: planned repeats 3; attempted repeats 3 / 3; successful attempts 3; request failures 0; provider failures 0; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 0 / 3",
    );
  });

  it("isolates one hard-check failure among three repeats from the other model label", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME })
      .mockResolvedValueOnce({ status: "success", outcome: { status: "multiple_issues" } })
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 6"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1", "--repeats", "3"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain(
      "current / only-description: planned repeats 3; attempted repeats 3 / 3; successful attempts 3; request failures 0; provider failures 0; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 1 / 3",
    );
    expect(report).toContain(
      "candidate / only-description: planned repeats 3; attempted repeats 3 / 3; successful attempts 3; request failures 0; provider failures 0; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 0 / 3",
    );
  });

  it("counts a request-level failure as one completed hard-failing repeat", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failure",
        failureKind: "request",
        error: "request failed",
      })
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 6"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1", "--repeats", "3"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain(
      "current / only-description: planned repeats 3; attempted repeats 3 / 3; successful attempts 2; request failures 1; provider failures 0; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 1 / 3",
    );
  });

  it("records a failed generation prompt hash without provider metadata or raw errors", async () => {
    const safeSystemPromptHash = "sha256:prompt-9f4c2a";
    const rawProviderError = `provider rejected model-current at https://provider.example/v1/responses with Bearer ${API_KEY}`;
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failure",
        failureKind: "request",
        error: rawProviderError,
        systemPromptHash: safeSystemPromptHash,
      })
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    const exitCode = await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--limit", "1"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(exitCode).toBe(1);
    expect(report).toContain(`Prompt hash: ${safeSystemPromptHash}`);
    expect(report).not.toContain("model-current");
    expect(report).not.toContain("https://provider.example/v1/responses");
    expect(report).not.toContain(API_KEY);
    expect(report).not.toContain("Bearer");
    expect(report).not.toContain(rawProviderError);
  });

  it("продолжает следующую model group после provider failure", async () => {
    const generateRequestForEvaluation = vi.fn().mockResolvedValue({
      status: "failure",
      failureKind: "provider",
      error: "provider unavailable",
    });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(generateRequestForEvaluation).toHaveBeenCalledTimes(2);
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Status: partial");
    expect(report).toContain("Attempted requests: 2 / 2");
  });

  it("учитывает usage failed request в строке и aggregate cost", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failure",
        failureKind: "request",
        error: "request failed",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      })
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(generateRequestForEvaluation).toHaveBeenCalledTimes(2);
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Actual aggregate usage: input 100, output 50, total 150");
    expect(report).toContain("Actual estimated cost for requests with usage: 0.002000 RUB");
    expect(report).toContain("Actual estimated cost: 0.002000 RUB");
  });

  it("продолжает следующий request после Responses incomplete", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "incomplete",
            output_text: JSON.stringify({ draft: { outcome: "generated" } }),
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            output_text: JSON.stringify({
              draft: {
                outcome: "generated",
                title: "Не работает освещение",
                problem: "На лестничной площадке не работает освещение.",
                circumstances: null,
                impact: null,
                verification: null,
                subject: null,
                actionPlan: {
                  preliminaryCheck: null,
                  remedyActions: ["Проверить и восстановить освещение"],
                  resultCheck: null,
                },
                warnings: [],
              },
            }),
          }),
          { status: 200 },
        ),
      );
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn((config) => new OpenAiCompatibleGateway(config)),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Failure kind: request");
    expect(report).toContain("Usage: input 100, output 50, total 150");
    expect(report).toContain("Outcome: `generated`");
    expect(report).toContain(
      "current / only-description: planned repeats 1; attempted repeats 1 / 1; successful attempts 0; request failures 1; provider failures 0; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 1 / 1",
    );
    expect(report).toContain(
      "candidate / only-description: planned repeats 1; attempted repeats 1 / 1; successful attempts 1; request failures 0; provider failures 0; skipped after model provider failure 0; globally not run 0; hard-failing attempted repeats 0 / 1",
    );
  });

  it("не использует LLM_MODEL и передаёт в gateway только явно выбранные model IDs", async () => {
    const runtime = dependencies({
      environment: {
        LLM_API_URL: "https://provider.example/v1/responses",
        LLM_API_KEY: API_KEY,
        LLM_AUTH_SCHEME: "Bearer",
        LLM_PROVIDER: "benchmark-provider",
        LLM_MODEL: "production-default-must-not-be-used",
      },
      confirm: vi.fn().mockResolvedValue("RUN 2"),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(runtime.createGateway).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runtime.createGateway).mock.calls.map(([config]) => config.model)).toEqual([
      "model-current",
      "model-candidate",
    ]);
  });

  it("не записывает API key и raw error в report или stdout", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockRejectedValue(new Error(`Authorization: Bearer ${API_KEY}`));
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    const output = vi.mocked(runtime.writeLine).mock.calls.flat().join("\n");
    expect(report).not.toContain(API_KEY);
    expect(report).not.toContain("Authorization");
    expect(output).not.toContain(API_KEY);
  });

  it("передаёт independent semantic review безопасный label и hard summary без provider model ID", async () => {
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Model labels: current, candidate");
    expect(report).toContain("Scenarios: 1");
    expect(report).toContain("Hard checks: PASS");
    expect(report).toContain("Сохранить: на лестничной площадке не работает освещение.");
    expect(report).toContain("Не добавлять: факт травмы.");
    expect(report).not.toContain("model-current");
    expect(report).not.toContain("model-candidate");
  });

  it("показывает structured observation и каждый hard check отдельно", async () => {
    const generateRequestForEvaluation = vi.fn().mockResolvedValue({
      status: "success",
      outcome: GENERATED_OUTCOME,
      observation: {
        draftOutcome: "generated",
        draft: EVALUATION_DRAFT,
        selectedNormativeModule: null,
        specificLegalBasisSelectionStatus: "subject_absent",
      },
      systemPromptHash: "safe-prompt-hash",
    });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Validated structured output:");
    expect(report).toContain('"actionPlan"');
    expect(report).toContain("Specific legal basis selection: subject_absent");
    expect(report).toContain("PASS: warning presence: absent");
    expect(report).toContain("Prompt hash: safe-prompt-hash");
  });

  it("проверяет subject и normative module по structured observation, а не rendered text", async () => {
    const draft: PrimaryRequestDraft = {
      ...EVALUATION_DRAFT,
      subject: {
        kind: "common_area_premises_cleaning",
        evidence: [{ sourceField: "description", quote: "исправной кабине лифта" }],
      },
    };
    const generateRequestForEvaluation = vi.fn().mockResolvedValue({
      status: "success",
      outcome: GENERATED_OUTCOME,
      observation: {
        draftOutcome: "generated",
        draft,
        selectedNormativeModule: "common-area-cleaning",
        specificLegalBasisSelectionStatus: "applied",
      },
    });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--scenario", "cleaning-elevator-cabin"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("PASS: subject.kind: common_area_premises_cleaning");
    expect(report).toContain("PASS: subject.kind is not common_area_elevator");
    expect(report).toContain("PASS: selected normative module: common-area-cleaning");
    expect(report).toContain(
      "Issue provenance: [#200](https://github.com/ashikov/uo-request-generator/issues/200)",
    );
  });

  it("считает missing structured observation hard failure", async () => {
    const generateRequestForEvaluation = vi.fn().mockResolvedValue({
      status: "success",
      outcome: GENERATED_OUTCOME,
    });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--scenario", "cleaning-elevator-cabin"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("FAIL: subject.kind: common_area_premises_cleaning");
    expect(report).toContain("selected normative module: unavailable");
  });

  it("сохраняет фактический validated multiple_issues draft со всеми пустыми полями", async () => {
    const multipleIssuesDraft = {
      outcome: "multiple_issues" as const,
      title: null,
      problem: null,
      circumstances: null,
      impact: null,
      verification: null,
      subject: null,
      actionPlan: null,
      warnings: [],
    };
    const generateRequestForEvaluation = vi.fn().mockResolvedValue({
      status: "success",
      outcome: { status: "multiple_issues" },
      observation: { draftOutcome: "multiple_issues", multipleIssuesDraft },
    });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(
      ["--config", CONFIG_PATH, "--run", "--scenario", "multiple-issues"],
      runtime,
    );

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain(JSON.stringify(multipleIssuesDraft, null, 2));
    expect(report).toContain('"title": null');
    expect(report).toContain('"warnings": []');
  });

  it("сохраняет usage для поддерживаемого ответа и допускает его отсутствие", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValueOnce({
        status: "success",
        outcome: GENERATED_OUTCOME,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      })
      .mockResolvedValueOnce({ status: "success", outcome: GENERATED_OUTCOME });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("input 100, output 50, total 150");
    expect(report).toContain("Usage: unavailable");
  });

  it("сохраняет partial report и не запускает новые requests после interruption", async () => {
    let interrupted = false;
    const generateRequestForEvaluation = vi.fn(async (_input: GenerateRequestInput) => {
      interrupted = true;
      return { status: "success" as const, outcome: GENERATED_OUTCOME };
    });
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      isInterrupted: () => interrupted,
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(generateRequestForEvaluation).toHaveBeenCalledOnce();
    const report = vi.mocked(runtime.writeFile).mock.calls.at(-1)?.[1];
    expect(report).toContain("Attempted requests: 1 / 2");
    expect(report).toContain("Globally not run: 1");
    expect(report).toContain("Status: interrupted");
  });

  it("останавливается и сообщает точное число requests при ошибке записи report", async () => {
    const generateRequestForEvaluation = vi
      .fn()
      .mockResolvedValue({ status: "success", outcome: GENERATED_OUTCOME });
    const writeFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));
    const runtime = dependencies({
      confirm: vi.fn().mockResolvedValue("RUN 2"),
      writeFile,
      createGateway: vi.fn(() => ({ generateRequestForEvaluation })),
    });

    await runLlmBenchmark(["--config", CONFIG_PATH, "--run", "--limit", "1"], runtime);

    expect(generateRequestForEvaluation).toHaveBeenCalledOnce();
    expect(runtime.writeLine).toHaveBeenCalledWith(
      "Не удалось обновить локальный отчёт. Выполнено 1 из 2 запросов.",
    );
  });

  it("использует существующий массив synthetic fixtures напрямую", () => {
    const selected = selectBenchmarkScenarios({ scenarioIds: [] });

    expect(selected).toEqual(scenarios);
    expect(selected[0]).toBe(scenarios[0]);
    expect(selected).toHaveLength(32);
  });

  it("исключает local config и report directory из Git", () => {
    const gitignore = readFileSync(".gitignore", "utf8").split("\n");
    const dockerignore = readFileSync(".dockerignore", "utf8").split("\n");

    expect(gitignore).toContain(".llm-benchmark.local.json");
    expect(gitignore).toContain(".tmp/");
    expect(dockerignore).toContain(".llm-benchmark.local.json");
    expect(dockerignore).toContain(".tmp");
  });

  it("committed example содержит только placeholders и явный pricing", () => {
    const exampleText = readFileSync(".llm-benchmark.example.json", "utf8");
    const example = parseBenchmarkConfig(JSON.parse(exampleText));

    expect(example.models.every((model) => model.model.startsWith("replace-with-"))).toBe(true);
    expect(example.models.every((model) => model.inputPricePerMillion > 0)).toBe(true);
    expect(example.models.every((model) => model.outputPricePerMillion > 0)).toBe(true);
    expect(exampleText).not.toContain("apiKey");
    expect(exampleText).not.toContain("Authorization");
  });
});
