import { pathToFileURL } from "node:url";
import {
  type GenerateRequestInput,
  type GenerateRequestOutcome,
  type GenerateRequestResult,
  generateRequestResultSchema,
  type LlmGateway,
} from "@uo-request-generator/core";
import {
  COMMON_LEGAL_BASIS_BLOCK,
  DisabledLlmGateway,
  GenerationProviderUnavailableError,
} from "@uo-request-generator/llm";
import { scenarios, type TestScenario } from "../../../../packages/core/tests/fixtures.js";
import { createLlmGateway } from "../../src/llm-config.js";

const MAX_REQUESTS = 3;

type WriteLine = (message: string) => void;

type SmokeStatistics = {
  requests: number;
  automaticallyPassedScenarios: number;
  automaticErrors: number;
};

function writeSummary(
  scenarioCount: number,
  statistics: SmokeStatistics,
  writeLine: WriteLine,
): void {
  writeLine("Итог:");
  writeLine(`Сценариев: ${String(scenarioCount)}`);
  writeLine(`LLM-запросов: ${String(statistics.requests)}`);
  writeLine(`Автоматически прошли: ${String(statistics.automaticallyPassedScenarios)}`);
  writeLine(`Автоматических ошибок: ${String(statistics.automaticErrors)}`);
  writeLine("Смысловые mustPreserveFacts и mustNotInvent проверяются человеком.");
  writeLine("Автоматический успех не подтверждает смысловое качество результата.");
}

function findGeneratedResultError(result: GenerateRequestResult): string | undefined {
  if (result.title.trim().length === 0 || result.body.trim().length === 0) {
    return "результат не соответствует публичному контракту";
  }

  if (result.warnings.some((warning) => result.body.includes(warning))) {
    return "предупреждения смешаны с текстом заявки";
  }

  if (
    result.body.includes("http://") ||
    result.body.includes("https://") ||
    result.body.includes("Общие нормативные основания:")
  ) {
    return "нарушен формат нормативных оснований";
  }

  const legalBasisPosition = result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK);
  const requestPosition = result.body.indexOf("Прошу:\n");

  if (
    legalBasisPosition === -1 ||
    legalBasisPosition !== result.body.lastIndexOf(COMMON_LEGAL_BASIS_BLOCK)
  ) {
    return "нарушен формат нормативных оснований";
  }

  if (requestPosition === -1) {
    return "нарушен формат раздела «Прошу:»";
  }

  if (requestPosition < legalBasisPosition + COMMON_LEGAL_BASIS_BLOCK.length) {
    return "нарушен формат нормативных оснований";
  }

  const beforeLegal = result.body.slice(0, legalBasisPosition);
  const afterLegal = result.body.slice(legalBasisPosition + COMMON_LEGAL_BASIS_BLOCK.length);
  const requestBlock = result.body.slice(requestPosition);

  if (!beforeLegal.endsWith("\n\n") || afterLegal !== `\n\n${requestBlock}`) {
    return "нарушен формат нормативных оснований";
  }

  const introPart = beforeLegal.slice(0, -"\n\n".length);
  const introBlocks = introPart.split("\n\n");

  if (introBlocks.length === 0 || introBlocks.some((block) => block.trim().length === 0)) {
    return "нарушен формат раздела «Прошу:»";
  }

  const requestLines = requestBlock.split("\n").slice(1);

  if (requestLines.length < 1 || requestLines.length > MAX_REQUESTS) {
    return "нарушен формат раздела «Прошу:»";
  }

  for (const [index, request] of requestLines.entries()) {
    if (!request.startsWith(`${String(index + 1)}. `) || request.slice(3).trim().length === 0) {
      return "нарушен формат раздела «Прошу:»";
    }
  }

  return undefined;
}

function formatInput(input: GenerateRequestInput): string[] {
  const fields: Array<[keyof GenerateRequestInput, string]> = [
    ["description", "description"],
    ["location", "location"],
    ["consequences", "consequences"],
    ["desiredActions", "desiredActions"],
  ];

  return fields.flatMap(([field, label]) => {
    const value = input[field];
    return value === undefined ? [] : [`${label}: ${value}`];
  });
}

function formatList(values: string[]): string {
  return values.length === 0 ? "(нет)" : values.map((value) => `- ${value}`).join("\n");
}

function writeManualReviewReport(
  scenario: Extract<TestScenario, { expectedOutcome: "generated" }>,
  result: GenerateRequestResult,
  writeLine: WriteLine,
): void {
  writeLine("");
  writeLine(`id: ${scenario.id}`);
  writeLine(`category: ${scenario.category}`);
  writeLine("input:");

  for (const inputLine of formatInput(scenario.input)) {
    writeLine(inputLine);
  }

  writeLine(`title: ${result.title}`);
  writeLine(`body:\n${result.body}`);
  writeLine(`warnings:\n${formatList(result.warnings)}`);
  writeLine(`mustPreserveFacts:\n${formatList(scenario.mustPreserveFacts)}`);
  writeLine(`mustNotInvent:\n${formatList(scenario.mustNotInvent)}`);
  writeLine(`expectWarning: ${scenario.expectWarning ? "да" : "нет"}`);
}

export async function runLlmSmokeCheck(
  gateway: LlmGateway,
  writeLine: WriteLine,
  scenarioFixtures: readonly TestScenario[] = scenarios,
): Promise<0 | 1> {
  const statistics: SmokeStatistics = {
    requests: 0,
    automaticallyPassedScenarios: 0,
    automaticErrors: 0,
  };

  if (gateway instanceof DisabledLlmGateway) {
    writeLine("LLM smoke-check: конфигурация провайдера недоступна");
    statistics.automaticErrors += 1;
    writeSummary(scenarioFixtures.length, statistics, writeLine);
    return 1;
  }

  for (const scenario of scenarioFixtures) {
    let outcome: GenerateRequestOutcome;

    try {
      statistics.requests += 1;
      outcome = await gateway.generateRequest(scenario.input);
    } catch (error) {
      statistics.automaticErrors += 1;

      if (error instanceof GenerationProviderUnavailableError) {
        writeLine(`Сценарий ${scenario.id}: провайдер недоступен, проверка остановлена`);
        break;
      }

      writeLine(`Сценарий ${scenario.id}: ошибка генерации`);
      continue;
    }

    if (scenario.expectedOutcome === "multiple_issues") {
      if (outcome.status === "multiple_issues") {
        statistics.automaticallyPassedScenarios += 1;
        writeLine(`Сценарий ${scenario.id}: автоматические проверки пройдены`);
      } else {
        statistics.automaticErrors += 1;
        writeLine(`Сценарий ${scenario.id}: outcome не соответствует ожидаемому`);
      }
      continue;
    }

    if (outcome.status !== "generated") {
      statistics.automaticErrors += 1;
      writeLine(`Сценарий ${scenario.id}: outcome не соответствует ожидаемому`);
      continue;
    }

    const resultValidation = generateRequestResultSchema.safeParse(outcome.result);

    if (!resultValidation.success) {
      statistics.automaticErrors += 1;
      writeLine(`Сценарий ${scenario.id}: результат не соответствует публичному контракту`);
      continue;
    }

    const result = resultValidation.data;
    writeManualReviewReport(scenario, result, writeLine);
    const resultError = findGeneratedResultError(result);

    if (resultError !== undefined) {
      statistics.automaticErrors += 1;
      writeLine(`Сценарий ${scenario.id}: ${resultError}`);
      continue;
    }

    const hasWarnings = result.warnings.length > 0;

    if (hasWarnings !== scenario.expectWarning) {
      statistics.automaticErrors += 1;
      writeLine(`Сценарий ${scenario.id}: наличие предупреждений не соответствует ожидаемому`);
      continue;
    }

    statistics.automaticallyPassedScenarios += 1;
    writeLine(`Сценарий ${scenario.id}: автоматические проверки пройдены`);
  }

  writeSummary(scenarioFixtures.length, statistics, writeLine);
  return statistics.automaticErrors === 0 ? 0 : 1;
}

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  process.exitCode = await runLlmSmokeCheck(createLlmGateway(process.env), writeLine);
}

const entryPoint = process.argv[1];

if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void main();
}
