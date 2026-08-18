import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  generateRequestResultSchema,
  type GenerateRequestInput,
  type GenerateRequestOutcome,
} from "@uo-request-generator/core";
import {
  CHAT_COMPLETIONS_OUTPUT_TOKEN_PARAMETERS,
  createOpenAiCompatibleRequestBody,
  LLM_API_PROTOCOLS,
  type LlmProviderUsage,
  OpenAiCompatibleGateway,
  type OpenAiCompatibleGatewayConfig,
} from "@uo-request-generator/llm";
import { z } from "zod";
import { scenarios, type TestScenario } from "../../../../packages/core/tests/fixtures.js";
import { findGeneratedResultError } from "./llm-result-checks.js";

export const DEFAULT_BENCHMARK_REPEATS = 1;
export const MAX_BENCHMARK_REPEATS = 5;
export const MAX_BENCHMARK_REQUESTS = 100;
export const BENCHMARK_REPORT_DIRECTORY = ".tmp/llm-benchmark";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

type BenchmarkModel = {
  label: string;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
};

export type BenchmarkConfig = {
  currency: string;
  apiProtocol: (typeof LLM_API_PROTOCOLS)[number];
  maxOutputTokens: number;
  chatCompletionsOutputTokenParameter?: (typeof CHAT_COMPLETIONS_OUTPUT_TOKEN_PARAMETERS)[number];
  models: BenchmarkModel[];
};

type BenchmarkCliOptions = {
  configPath: string;
  scenarioIds: string[];
  limit?: number;
  repeats: number;
  run: boolean;
};

export type ScenarioSelection = {
  scenarioIds: string[];
  limit?: number;
};

type PlannedBenchmarkRequest = {
  model: BenchmarkModel;
  scenario: TestScenario;
  repeat: number;
  inputTokenUpperBound: number;
  maximumCost: number;
};

export type BenchmarkPlan = {
  config: BenchmarkConfig;
  scenarios: readonly TestScenario[];
  repeats: number;
  totalRequests: number;
  maximumCost: number;
  reportPath: string;
  requests: PlannedBenchmarkRequest[];
};

type BenchmarkRequestRecord = {
  request: PlannedBenchmarkRequest;
  durationMs: number;
  outcome?: GenerateRequestOutcome;
  usage?: LlmProviderUsage;
  actualEstimatedCost?: number;
  automaticCheck?: string;
  error?: string;
  failureKind?: "request" | "provider";
  statusCode?: number;
};

type BenchmarkRunStatus = "running" | "completed" | "interrupted" | "provider_unavailable";

type BenchmarkRunReport = {
  plan: BenchmarkPlan;
  startedAt: Date;
  finishedAt: Date;
  status: BenchmarkRunStatus;
  records: BenchmarkRequestRecord[];
};

type BenchmarkGeneration =
  | {
      status: "success";
      outcome: GenerateRequestOutcome;
      usage?: LlmProviderUsage;
    }
  | {
      status: "failure";
      error: "request failed" | "provider unavailable";
      failureKind: "request" | "provider";
      statusCode?: number;
      usage?: LlmProviderUsage;
    };

type BenchmarkGateway = {
  generateRequestWithMetadata(input: GenerateRequestInput): Promise<BenchmarkGeneration>;
};

export type BenchmarkDependencies = {
  environment: NodeJS.ProcessEnv;
  isStdinTty: boolean;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  confirm(prompt: string): Promise<string>;
  writeLine(message: string): void;
  now(): Date;
  monotonicNow(): number;
  isInterrupted(): boolean;
  createGateway(config: OpenAiCompatibleGatewayConfig): BenchmarkGateway;
};

const benchmarkModelSchema = z
  .object({
    label: z.string().trim().min(1),
    model: z.string().trim().min(1),
    inputPricePerMillion: z.number().finite().nonnegative(),
    outputPricePerMillion: z.number().finite().nonnegative(),
  })
  .strict();

const benchmarkConfigSchema = z
  .object({
    currency: z.string().trim().min(1),
    apiProtocol: z.enum(LLM_API_PROTOCOLS),
    maxOutputTokens: z.number().int().min(1).max(4000),
    chatCompletionsOutputTokenParameter: z
      .enum(CHAT_COMPLETIONS_OUTPUT_TOKEN_PARAMETERS)
      .optional(),
    models: z
      .array(benchmarkModelSchema)
      .min(1, "Нужно явно указать хотя бы одну benchmark-модель")
      .max(10),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.apiProtocol === "chat-completions" &&
      config.chatCompletionsOutputTokenParameter === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["chatCompletionsOutputTokenParameter"],
        message: "Для Chat Completions нужно явно выбрать max_tokens или max_completion_tokens",
      });
    }

    if (
      config.apiProtocol === "responses" &&
      config.chatCompletionsOutputTokenParameter !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["chatCompletionsOutputTokenParameter"],
        message: "chatCompletionsOutputTokenParameter применим только к Chat Completions",
      });
    }

    const labels = config.models.map((model) => model.label);
    const modelIds = config.models.map((model) => model.model);

    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: "custom",
        path: ["models"],
        message: "Model labels должны быть уникальны",
      });
    }

    if (new Set(modelIds).size !== modelIds.length) {
      context.addIssue({
        code: "custom",
        path: ["models"],
        message: "Model IDs должны быть уникальны",
      });
    }
  });

const benchmarkProviderEnvironmentSchema = z.object({
  LLM_API_URL: z.url(),
  LLM_API_KEY: z.string().trim().min(1),
  LLM_AUTH_SCHEME: z.string().trim().min(1),
  LLM_PROVIDER: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  LLM_FOLDER_ID: z.string().trim().min(1).optional(),
});

class BenchmarkInputError extends Error {}

function validationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Некорректная benchmark-конфигурация";
}

export function parseBenchmarkConfig(input: unknown): BenchmarkConfig {
  const result = benchmarkConfigSchema.safeParse(input);

  if (!result.success) {
    throw new BenchmarkInputError(validationMessage(result.error));
  }

  return {
    currency: result.data.currency,
    apiProtocol: result.data.apiProtocol,
    maxOutputTokens: result.data.maxOutputTokens,
    models: result.data.models,
    ...(result.data.chatCompletionsOutputTokenParameter === undefined
      ? {}
      : {
          chatCompletionsOutputTokenParameter: result.data.chatCompletionsOutputTokenParameter,
        }),
  };
}

function parsePositiveInteger(value: string | undefined, option: string): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new BenchmarkInputError(`${option} должен быть положительным целым числом`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new BenchmarkInputError(`${option} должен быть положительным целым числом`);
  }

  return parsed;
}

function parseBenchmarkCliArguments(arguments_: string[]): BenchmarkCliOptions {
  const cliArguments = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  let configPath: string | undefined;
  const scenarioIds: string[] = [];
  let limit: number | undefined;
  let repeats = DEFAULT_BENCHMARK_REPEATS;
  let run = false;

  for (let index = 0; index < cliArguments.length; index += 1) {
    const argument = cliArguments[index];

    if (argument === "--config") {
      configPath = cliArguments[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--scenario") {
      const scenarioId = cliArguments[index + 1];
      if (scenarioId === undefined || scenarioId.startsWith("--")) {
        throw new BenchmarkInputError("--scenario требует scenario ID");
      }
      scenarioIds.push(scenarioId);
      index += 1;
      continue;
    }

    if (argument === "--limit") {
      limit = parsePositiveInteger(cliArguments[index + 1], "--limit");
      index += 1;
      continue;
    }

    if (argument === "--repeats") {
      repeats = parsePositiveInteger(cliArguments[index + 1], "--repeats");
      index += 1;
      continue;
    }

    if (argument === "--run") {
      if (run) {
        throw new BenchmarkInputError("--run указан повторно");
      }
      run = true;
      continue;
    }

    throw new BenchmarkInputError(`Неизвестный аргумент: ${argument ?? "(пусто)"}`);
  }

  if (configPath === undefined || configPath.startsWith("--")) {
    throw new BenchmarkInputError("Нужно явно указать --config");
  }

  if (repeats > MAX_BENCHMARK_REPEATS) {
    throw new BenchmarkInputError(
      `--repeats не может быть больше ${String(MAX_BENCHMARK_REPEATS)}`,
    );
  }

  return {
    configPath,
    scenarioIds,
    ...(limit === undefined ? {} : { limit }),
    repeats,
    run,
  };
}

export function selectBenchmarkScenarios(
  selection: ScenarioSelection,
  scenarioFixtures: readonly TestScenario[] = scenarios,
): readonly TestScenario[] {
  if (selection.scenarioIds.length > 0 && selection.limit !== undefined) {
    throw new BenchmarkInputError("Нельзя одновременно использовать --scenario и --limit");
  }

  if (selection.limit !== undefined) {
    if (selection.limit > scenarioFixtures.length) {
      throw new BenchmarkInputError(
        `--limit не может быть больше числа scenarios (${String(scenarioFixtures.length)})`,
      );
    }
    return scenarioFixtures.slice(0, selection.limit);
  }

  if (selection.scenarioIds.length === 0) {
    return scenarioFixtures;
  }

  const selectedIds = new Set(selection.scenarioIds);
  if (selectedIds.size !== selection.scenarioIds.length) {
    throw new BenchmarkInputError("Нельзя указывать один scenario ID несколько раз");
  }

  const selected = scenarioFixtures.filter((scenario) => selectedIds.has(scenario.id));
  const missingIds = selection.scenarioIds.filter(
    (scenarioId) => !scenarioFixtures.some((scenario) => scenario.id === scenarioId),
  );

  if (missingIds.length > 0) {
    throw new BenchmarkInputError(`Неизвестные scenario IDs: ${missingIds.join(", ")}`);
  }

  return selected;
}

function createRequestBody(config: BenchmarkConfig, model: string, input: GenerateRequestInput) {
  return createOpenAiCompatibleRequestBody(
    {
      apiProtocol: config.apiProtocol,
      model,
      maxOutputTokens: config.maxOutputTokens,
      ...(config.chatCompletionsOutputTokenParameter === undefined
        ? {}
        : {
            chatCompletionsOutputTokenParameter: config.chatCompletionsOutputTokenParameter,
          }),
    },
    input,
  );
}

function estimateInputTokenUpperBound(requestBody: unknown): number {
  return Buffer.byteLength(JSON.stringify(requestBody), "utf8");
}

function estimateCost(inputTokens: number, outputTokens: number, model: BenchmarkModel): number {
  return (
    (inputTokens * model.inputPricePerMillion) / 1_000_000 +
    (outputTokens * model.outputPricePerMillion) / 1_000_000
  );
}

function reportTimestamp(timestamp: Date): string {
  return timestamp.toISOString().replaceAll("-", "").replaceAll(":", "").replaceAll(".", "");
}

export function createBenchmarkPlan(
  config: BenchmarkConfig,
  selectedScenarios: readonly TestScenario[],
  repeats: number,
  timestamp: Date,
): BenchmarkPlan {
  const requests: PlannedBenchmarkRequest[] = [];

  for (const model of config.models) {
    for (const scenario of selectedScenarios) {
      const inputTokenUpperBound = estimateInputTokenUpperBound(
        createRequestBody(config, model.model, scenario.input),
      );
      const maximumCost = estimateCost(inputTokenUpperBound, config.maxOutputTokens, model);

      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        requests.push({ model, scenario, repeat, inputTokenUpperBound, maximumCost });
      }
    }
  }

  if (requests.length > MAX_BENCHMARK_REQUESTS) {
    throw new BenchmarkInputError(
      `План не может содержать больше ${String(MAX_BENCHMARK_REQUESTS)} запросов`,
    );
  }

  return {
    config,
    scenarios: selectedScenarios,
    repeats,
    totalRequests: requests.length,
    maximumCost: requests.reduce((sum, request) => sum + request.maximumCost, 0),
    reportPath: path.join(
      BENCHMARK_REPORT_DIRECTORY,
      `llm-benchmark-${reportTimestamp(timestamp)}.md`,
    ),
    requests,
  };
}

function formatMoney(value: number, currency: string): string {
  return `${value.toFixed(6)} ${currency}`;
}

function writePlan(plan: BenchmarkPlan, writeLine: (message: string) => void): void {
  writeLine("LLM benchmark plan (provider requests: 0)");
  writeLine(`Protocol: ${plan.config.apiProtocol}`);
  writeLine(`Models (${String(plan.config.models.length)}):`);
  for (const model of plan.config.models) {
    writeLine(`- ${model.label}: ${model.model}`);
    writeLine(
      `  pricing: input ${String(model.inputPricePerMillion)}, output ${String(model.outputPricePerMillion)} ${plan.config.currency} / 1M tokens`,
    );
  }
  writeLine(
    `Scenarios (${String(plan.scenarios.length)}): ${plan.scenarios.map((scenario) => scenario.id).join(", ")}`,
  );
  writeLine(`Repeats: ${String(plan.repeats)}`);
  writeLine(`Total requests: ${String(plan.totalRequests)}`);
  writeLine(`Max output tokens: ${String(plan.config.maxOutputTokens)}`);
  writeLine(
    "Input estimate: upper-bound approximation using at most one token per UTF-8 request byte; provider billing may be lower.",
  );
  writeLine(
    `Максимальная оценочная стоимость: ${formatMoney(plan.maximumCost, plan.config.currency)}`,
  );
  writeLine(`Будущий локальный отчёт: ${plan.reportPath}`);
}

function providerConfig(
  environment: NodeJS.ProcessEnv,
): Omit<OpenAiCompatibleGatewayConfig, "model" | "apiProtocol" | "maxOutputTokens"> {
  const result = benchmarkProviderEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    throw new BenchmarkInputError(
      "Для paid run нужны LLM_API_URL, LLM_API_KEY, LLM_AUTH_SCHEME и LLM_PROVIDER",
    );
  }

  const { LLM_API_URL, LLM_API_KEY, LLM_AUTH_SCHEME, LLM_FOLDER_ID, LLM_PROVIDER } = result.data;
  return {
    apiUrl: LLM_API_URL,
    apiKey: LLM_API_KEY,
    authScheme: LLM_AUTH_SCHEME,
    provider: LLM_PROVIDER,
    ...(LLM_FOLDER_ID === undefined ? {} : { extraHeaders: { "x-folder-id": LLM_FOLDER_ID } }),
  };
}

function automaticCheck(scenario: TestScenario, outcome: GenerateRequestOutcome): string {
  if (scenario.expectedOutcome === "multiple_issues") {
    return outcome.status === "multiple_issues"
      ? "passed"
      : "failed: outcome не соответствует expectedOutcome";
  }

  if (outcome.status !== "generated") {
    return "failed: outcome не соответствует expectedOutcome";
  }

  const result = generateRequestResultSchema.safeParse(outcome.result);
  if (!result.success) {
    return "failed: результат не соответствует публичному контракту";
  }

  const generatedResultError = findGeneratedResultError(result.data);
  if (generatedResultError !== undefined) {
    return `failed: ${generatedResultError}`;
  }

  const hasWarnings = result.data.warnings.length > 0;
  return hasWarnings === scenario.expectWarning
    ? "passed"
    : "failed: наличие warnings не соответствует expectation";
}

function formatInput(input: GenerateRequestInput): string {
  return JSON.stringify(input, null, 2);
}

function formatExpectations(scenario: TestScenario): string[] {
  if (scenario.expectedOutcome === "multiple_issues") {
    return ["- expectedOutcome: multiple_issues"];
  }

  return [
    "- expectedOutcome: generated",
    `- expectWarning: ${scenario.expectWarning ? "да" : "нет"}`,
    "- mustPreserveFacts:",
    ...scenario.mustPreserveFacts.map((fact) => `  - ${fact}`),
    "- mustNotInvent:",
    ...scenario.mustNotInvent.map((fact) => `  - ${fact}`),
  ];
}

function formatOutcome(outcome: GenerateRequestOutcome): string[] {
  if (outcome.status === "multiple_issues") {
    return ["Outcome: `multiple_issues`"];
  }

  return [
    "Outcome: `generated`",
    "",
    `Title: ${outcome.result.title}`,
    "",
    "Body:",
    "",
    "```text",
    outcome.result.body,
    "```",
    "",
    "Warnings:",
    ...(outcome.result.warnings.length === 0
      ? ["- (нет)"]
      : outcome.result.warnings.map((warning) => `- ${warning}`)),
  ];
}

function aggregateUsage(records: BenchmarkRequestRecord[]): {
  usageRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
} {
  return records.reduce(
    (aggregate, record) => {
      if (record.usage === undefined) {
        return aggregate;
      }
      aggregate.usageRequests += 1;
      aggregate.inputTokens += record.usage.inputTokens;
      aggregate.outputTokens += record.usage.outputTokens;
      aggregate.totalTokens += record.usage.totalTokens;
      aggregate.cost += record.actualEstimatedCost ?? 0;
      return aggregate;
    },
    { usageRequests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
  );
}

function formatReport(report: BenchmarkRunReport): string {
  const durationMs = Math.max(0, report.finishedAt.getTime() - report.startedAt.getTime());
  const usage = aggregateUsage(report.records);
  const lines = [
    "# Локальный LLM benchmark",
    "",
    `- Timestamp: ${report.startedAt.toISOString()}`,
    `- Finished at: ${report.finishedAt.toISOString()}`,
    `- Status: ${report.status}`,
    `- Protocol: ${report.plan.config.apiProtocol}`,
    `- Models: ${report.plan.config.models.map((model) => `${model.label} (${model.model})`).join(", ")}`,
    `- Scenario IDs: ${report.plan.scenarios.map((scenario) => scenario.id).join(", ")}`,
    `- Repeats: ${String(report.plan.repeats)}`,
    `- Planned requests: ${String(report.plan.totalRequests)}`,
    `- Completed requests: ${String(report.records.length)} / ${String(report.plan.totalRequests)}`,
    `- Max output tokens: ${String(report.plan.config.maxOutputTokens)}`,
    `- Estimated maximum cost: ${formatMoney(report.plan.maximumCost, report.plan.config.currency)}`,
    `- Total duration: ${durationMs.toFixed(0)} ms`,
    `- Usage available: ${String(usage.usageRequests)} / ${String(report.records.length)}`,
    ...(usage.usageRequests === 0
      ? ["- Actual aggregate usage: unavailable", "- Actual estimated cost: unavailable"]
      : [
          `- Actual aggregate usage: input ${String(usage.inputTokens)}, output ${String(usage.outputTokens)}, total ${String(usage.totalTokens)}`,
          `- Actual estimated cost for requests with usage: ${formatMoney(usage.cost, report.plan.config.currency)}`,
        ]),
    "",
    "Pricing snapshot:",
    "",
    ...report.plan.config.models.map(
      (model) =>
        `- ${model.label}: input ${String(model.inputPricePerMillion)}, output ${String(model.outputPricePerMillion)} ${report.plan.config.currency} / 1M tokens`,
    ),
    "",
    "## Ручная смысловая оценка",
    "",
    "Проверьте сохранение explicit facts, приоритет consequences и desiredActions, допустимость safe inferred impact, отсутствие каскада драматичных рисков, обоснованность procedural enrichment, отсутствие искусственного раздувания простого дефекта и корректный outcome для несвязанных проблем.",
    "",
    "Структурный успех и exit code не подтверждают смысловое качество.",
  ];

  for (const [index, record] of report.records.entries()) {
    lines.push(
      "",
      `## Request ${String(index + 1)}: ${record.request.model.label} / ${record.request.scenario.id} / repeat ${String(record.request.repeat)}`,
      "",
      `- Model ID: ${record.request.model.model}`,
      `- Duration: ${record.durationMs.toFixed(0)} ms`,
      `- Automatic checks: ${record.automaticCheck ?? "not completed"}`,
      ...(record.usage === undefined
        ? ["- Usage: unavailable", "- Actual estimated cost: unavailable"]
        : [
            `- Usage: input ${String(record.usage.inputTokens)}, output ${String(record.usage.outputTokens)}, total ${String(record.usage.totalTokens)}`,
            `- Actual estimated cost: ${formatMoney(record.actualEstimatedCost ?? 0, report.plan.config.currency)}`,
          ]),
      ...(record.error === undefined ? [] : [`- Error: ${record.error}`]),
      ...(record.failureKind === undefined ? [] : [`- Failure kind: ${record.failureKind}`]),
      ...(record.statusCode === undefined ? [] : [`- HTTP status: ${String(record.statusCode)}`]),
      "",
      "Input:",
      "",
      "```json",
      formatInput(record.request.scenario.input),
      "```",
      "",
      "Semantic expectations:",
      ...formatExpectations(record.request.scenario),
      "",
      ...(record.outcome === undefined ? [] : formatOutcome(record.outcome)),
    );
  }

  return `${lines.join("\n")}\n`;
}

async function saveReport(
  report: BenchmarkRunReport,
  dependencies: BenchmarkDependencies,
): Promise<void> {
  await dependencies.mkdir(path.dirname(report.plan.reportPath));
  await dependencies.writeFile(report.plan.reportPath, formatReport(report));
}

async function saveReportOrWriteFailure(
  report: BenchmarkRunReport,
  dependencies: BenchmarkDependencies,
  failureMessage: string,
): Promise<boolean> {
  try {
    await saveReport(report, dependencies);
    return true;
  } catch {
    dependencies.writeLine(
      `${failureMessage} Выполнено ${String(report.records.length)} из ${String(report.plan.totalRequests)} запросов.`,
    );
    return false;
  }
}

async function executeBenchmark(
  plan: BenchmarkPlan,
  dependencies: BenchmarkDependencies,
  connection: ReturnType<typeof providerConfig>,
): Promise<0 | 1> {
  const startedAt = dependencies.now();
  const report: BenchmarkRunReport = {
    plan,
    startedAt,
    finishedAt: startedAt,
    status: "running",
    records: [],
  };
  const gateways = new Map<string, BenchmarkGateway>();
  let hasErrors = false;

  if (
    !(await saveReportOrWriteFailure(report, dependencies, "Не удалось создать локальный отчёт."))
  ) {
    return 1;
  }

  for (const request of plan.requests) {
    if (dependencies.isInterrupted()) {
      report.status = "interrupted";
      hasErrors = true;
      break;
    }

    let gateway = gateways.get(request.model.label);
    if (gateway === undefined) {
      gateway = dependencies.createGateway({
        ...connection,
        model: request.model.model,
        apiProtocol: plan.config.apiProtocol,
        maxOutputTokens: plan.config.maxOutputTokens,
        ...(plan.config.chatCompletionsOutputTokenParameter === undefined
          ? {}
          : {
              chatCompletionsOutputTokenParameter: plan.config.chatCompletionsOutputTokenParameter,
            }),
      });
      gateways.set(request.model.label, gateway);
    }

    const requestStartedAt = dependencies.monotonicNow();
    let record: BenchmarkRequestRecord;
    let stopAfterRecord = false;

    try {
      const generation = await gateway.generateRequestWithMetadata(request.scenario.input);
      const durationMs = dependencies.monotonicNow() - requestStartedAt;
      const usageMetadata =
        generation.usage === undefined
          ? {}
          : {
              usage: generation.usage,
              actualEstimatedCost: estimateCost(
                generation.usage.inputTokens,
                generation.usage.outputTokens,
                request.model,
              ),
            };

      if (generation.status === "failure") {
        record = {
          request,
          durationMs,
          error: generation.error,
          failureKind: generation.failureKind,
          ...(generation.statusCode === undefined ? {} : { statusCode: generation.statusCode }),
          ...usageMetadata,
        };
        hasErrors = true;
        stopAfterRecord = generation.failureKind === "provider";
      } else {
        record = {
          request,
          durationMs,
          outcome: generation.outcome,
          ...usageMetadata,
          automaticCheck: automaticCheck(request.scenario, generation.outcome),
        };
        if (record.automaticCheck !== "passed") {
          hasErrors = true;
        }
      }
    } catch {
      record = {
        request,
        durationMs: dependencies.monotonicNow() - requestStartedAt,
        error: "generation failed",
        failureKind: "request",
      };
      hasErrors = true;
    }

    report.records.push(record);
    report.finishedAt = dependencies.now();
    if (stopAfterRecord) {
      report.status = "provider_unavailable";
    }
    if (
      !(await saveReportOrWriteFailure(
        report,
        dependencies,
        "Не удалось обновить локальный отчёт.",
      ))
    ) {
      return 1;
    }
    if (stopAfterRecord) {
      break;
    }
  }

  if (report.status === "running") {
    report.status = dependencies.isInterrupted() ? "interrupted" : "completed";
    if (report.status === "interrupted") {
      hasErrors = true;
    }
  }

  report.finishedAt = dependencies.now();
  if (
    !(await saveReportOrWriteFailure(report, dependencies, "Не удалось завершить локальный отчёт."))
  ) {
    return 1;
  }
  dependencies.writeLine(
    `Отчёт сохранён: ${plan.reportPath}. Выполнено ${String(report.records.length)} из ${String(plan.totalRequests)} запросов.`,
  );
  return hasErrors ? 1 : 0;
}

async function loadConfig(
  configPath: string,
  dependencies: BenchmarkDependencies,
): Promise<BenchmarkConfig> {
  let content: string;
  try {
    content = await dependencies.readFile(configPath);
  } catch {
    throw new BenchmarkInputError(`Не удалось прочитать benchmark config: ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new BenchmarkInputError("Benchmark config должен содержать валидный JSON");
  }

  return parseBenchmarkConfig(parsed);
}

export async function runLlmBenchmark(
  arguments_: string[],
  dependencies: BenchmarkDependencies,
): Promise<0 | 1> {
  try {
    const options = parseBenchmarkCliArguments(arguments_);
    const config = await loadConfig(options.configPath, dependencies);
    const selectedScenarios = selectBenchmarkScenarios({
      scenarioIds: options.scenarioIds,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    });
    const plan = createBenchmarkPlan(
      config,
      selectedScenarios,
      options.repeats,
      dependencies.now(),
    );
    writePlan(plan, dependencies.writeLine);

    if (!options.run) {
      return 0;
    }

    if (!dependencies.isStdinTty) {
      dependencies.writeLine(
        "Платный запуск доступен только в интерактивном терминале. Выполнено 0 запросов.",
      );
      return 1;
    }

    const connection = providerConfig(dependencies.environment);
    const confirmation = `RUN ${String(plan.totalRequests)}`;
    dependencies.writeLine(`Будет выполнено ${String(plan.totalRequests)} платных запросов.`);
    const answer = await dependencies.confirm(`Введите ${confirmation} для продолжения: `);

    if (answer !== confirmation) {
      dependencies.writeLine("Запуск отменён. Выполнено 0 запросов.");
      return 1;
    }

    return await executeBenchmark(plan, dependencies, connection);
  } catch (error) {
    const message =
      error instanceof BenchmarkInputError ? error.message : "Benchmark завершён с ошибкой";
    dependencies.writeLine(message);
    dependencies.writeLine("Выполнено 0 запросов.");
    return 1;
  }
}

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function confirm(prompt: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await reader.question(prompt);
  } finally {
    reader.close();
  }
}

async function main(): Promise<void> {
  let interrupted = false;
  const requestInterruption = () => {
    interrupted = true;
    writeLine("Получен сигнал остановки. Новые LLM-запросы запускаться не будут.");
  };
  process.once("SIGINT", requestInterruption);
  process.once("SIGTERM", requestInterruption);

  try {
    process.exitCode = await runLlmBenchmark(process.argv.slice(2), {
      environment: process.env,
      isStdinTty: process.stdin.isTTY === true,
      readFile: (filePath) => readFile(path.resolve(REPOSITORY_ROOT, filePath), "utf8"),
      writeFile: (filePath, content) =>
        writeFile(path.resolve(REPOSITORY_ROOT, filePath), content, "utf8"),
      mkdir: (directoryPath) =>
        mkdir(path.resolve(REPOSITORY_ROOT, directoryPath), { recursive: true }).then(
          () => undefined,
        ),
      confirm,
      writeLine,
      now: () => new Date(),
      monotonicNow: () => performance.now(),
      isInterrupted: () => interrupted,
      createGateway: (config) => new OpenAiCompatibleGateway(config),
    });
  } finally {
    process.off("SIGINT", requestInterruption);
    process.off("SIGTERM", requestInterruption);
  }
}

const entryPoint = process.argv[1];

if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void main();
}
