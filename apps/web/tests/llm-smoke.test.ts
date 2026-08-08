import type { GenerateRequestInput, GenerateRequestOutcome } from "@uo-request-generator/core";
import {
  COMMON_LEGAL_BASIS_BLOCK,
  DisabledLlmGateway,
  GenerationProviderUnavailableError,
} from "@uo-request-generator/llm";
import { describe, expect, it, vi } from "vitest";
import { scenarios, type TestScenario } from "../../../packages/core/tests/fixtures.js";
import { runLlmSmokeCheck } from "./manual/llm-smoke.js";

const GENERATED_REQUEST_BODY =
  "Описанная проблема требует проверки.\n\nПрошу:\n1. Проверить проблему";
const GENERATED_BODY = [GENERATED_REQUEST_BODY, COMMON_LEGAL_BASIS_BLOCK].join("\n\n");

function generatedOutcome(warnings: string[] = []): GenerateRequestOutcome {
  return {
    status: "generated",
    result: {
      title: "Проверить проблему",
      body: GENERATED_BODY,
      warnings,
    },
  };
}

function generatedScenario(overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    id: "generated-scenario",
    category: "only_required_description",
    expectedOutcome: "generated",
    input: {
      description: "В подъезде не работает освещение",
    },
    mustPreserveFacts: ["освещение не работает"],
    mustNotInvent: ["номер дома"],
    expectWarning: false,
    ...overrides,
  } as TestScenario;
}

function multipleIssuesScenario(overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    id: "multiple-issues-scenario",
    category: "multiple_unrelated_issues",
    expectedOutcome: "multiple_issues",
    input: {
      description: "Во дворе сломаны качели, а в подвале протекает труба",
    },
    ...overrides,
  } as TestScenario;
}

describe("runLlmSmokeCheck", () => {
  it("последовательно обрабатывает все fixtures ровно одним вызовом на сценарий", async () => {
    const calls: GenerateRequestInput[] = [];
    let activeCalls = 0;
    let maxActiveCalls = 0;
    const generateRequest = vi.fn(async (input: GenerateRequestInput) => {
      calls.push(input);
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await Promise.resolve();
      activeCalls -= 1;

      const scenario = scenarios.find((candidate) => candidate.input === input);
      return scenario?.expectedOutcome === "multiple_issues"
        ? ({ status: "multiple_issues" } as const)
        : generatedOutcome();
    });
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck({ generateRequest }, writeLine);

    expect(exitCode).toBe(0);
    expect(generateRequest).toHaveBeenCalledTimes(scenarios.length);
    expect(calls).toEqual(scenarios.map((scenario) => scenario.input));
    expect(maxActiveCalls).toBe(1);
    expect(writeLine).toHaveBeenCalledWith(`Сценариев: ${String(scenarios.length)}`);
    expect(writeLine).toHaveBeenCalledWith(`LLM-запросов: ${String(scenarios.length)}`);
    expect(writeLine).toHaveBeenCalledWith(`Автоматически прошли: ${String(scenarios.length)}`);
    expect(writeLine).not.toHaveBeenCalledWith(expect.stringContaining("Успешных сценариев"));
    expect(writeLine).toHaveBeenCalledWith("Автоматических ошибок: 0");
    expect(writeLine).toHaveBeenCalledWith(
      "Автоматический успех не подтверждает смысловое качество результата.",
    );
  });

  it.each([
    ["без нормативного блока", GENERATED_REQUEST_BODY],
    [
      "с изменённым нормативным блоком",
      [GENERATED_REQUEST_BODY, `${COMMON_LEGAL_BASIS_BLOCK} изменён`].join("\n\n"),
    ],
    [
      "с нормативным блоком дважды",
      [GENERATED_REQUEST_BODY, COMMON_LEGAL_BASIS_BLOCK, COMMON_LEGAL_BASIS_BLOCK].join("\n\n"),
    ],
    [
      "с произвольным текстом после нормативного блока",
      [GENERATED_BODY, "Дополнительный текст"].join("\n\n"),
    ],
  ])("отклоняет generated-результат %s", async (_caseName, body) => {
    const outcome = generatedOutcome();
    if (outcome.status !== "generated") {
      throw new Error("Ожидался generated outcome");
    }
    outcome.result.body = body;
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck(
      { generateRequest: vi.fn().mockResolvedValue(outcome) },
      writeLine,
      [generatedScenario()],
    );

    expect(exitCode).toBe(1);
    expect(writeLine).toHaveBeenCalledWith(
      "Сценарий generated-scenario: нарушен формат раздела «Общие нормативные основания»",
    );
  });

  it("обычный сценарий принимает только generated", async () => {
    const generateRequest = vi.fn().mockResolvedValue({ status: "multiple_issues" });
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck({ generateRequest }, writeLine, [generatedScenario()]);

    expect(exitCode).toBe(1);
    expect(generateRequest).toHaveBeenCalledOnce();
    expect(writeLine).toHaveBeenCalledWith(
      "Сценарий generated-scenario: outcome не соответствует ожидаемому",
    );
  });

  it("сценарий с несколькими проблемами принимает только multiple_issues", async () => {
    const generateRequest = vi.fn().mockResolvedValue(generatedOutcome());
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck({ generateRequest }, writeLine, [
      multipleIssuesScenario(),
    ]);

    expect(exitCode).toBe(1);
    expect(generateRequest).toHaveBeenCalledOnce();
    expect(writeLine).toHaveBeenCalledWith(
      "Сценарий multiple-issues-scenario: outcome не соответствует ожидаемому",
    );
  });

  it.each([
    {
      name: "ожидаемое предупреждение отсутствует",
      expectWarning: true,
      warnings: [],
    },
    {
      name: "неожиданное предупреждение присутствует",
      expectWarning: false,
      warnings: ["Нужна ручная проверка"],
    },
  ])("проверяет expectWarning: $name", async ({ expectWarning, warnings }) => {
    const scenario = generatedScenario({
      expectWarning,
    });
    const generateRequest = vi.fn().mockResolvedValue(generatedOutcome(warnings));
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck({ generateRequest }, writeLine, [scenario]);

    expect(exitCode).toBe(1);
    expect(generateRequest).toHaveBeenCalledOnce();
    expect(writeLine).toHaveBeenCalledWith(
      "Сценарий generated-scenario: наличие предупреждений не соответствует ожидаемому",
    );
    expect(writeLine).toHaveBeenCalledWith("id: generated-scenario");
    expect(writeLine).toHaveBeenCalledWith(`body:\n${GENERATED_BODY}`);
    expect(writeLine).toHaveBeenCalledWith("Автоматически прошли: 0");
    expect(writeLine).toHaveBeenCalledWith("Автоматических ошибок: 1");
  });

  it.each([
    {
      name: "не проходит публичный контракт",
      outcome: {
        status: "generated",
        result: {
          title: "",
          body: GENERATED_BODY,
          warnings: [],
        },
      },
      error: "результат не соответствует публичному контракту",
      printsReport: false,
    },
    {
      name: "не содержит отдельный раздел «Прошу:»",
      outcome: {
        status: "generated",
        result: {
          title: "Проверить проблему",
          body: ["Описанная проблема требует проверки.", COMMON_LEGAL_BASIS_BLOCK].join("\n\n"),
          warnings: [],
        },
      },
      error: "нарушен формат раздела «Прошу:»",
      printsReport: true,
    },
    {
      name: "смешивает предупреждение с заявкой",
      outcome: {
        status: "generated",
        result: {
          title: "Проверить проблему",
          body: `${GENERATED_BODY}\nНужна ручная проверка`,
          warnings: ["Нужна ручная проверка"],
        },
      },
      error: "предупреждения смешаны с текстом заявки",
      printsReport: true,
    },
  ])("отклоняет generated-результат, который $name", async ({ outcome, error, printsReport }) => {
    const scenario = generatedScenario({
      expectWarning: outcome.result.warnings.length > 0,
    });
    const generateRequest = vi.fn().mockResolvedValue(outcome);
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck({ generateRequest }, writeLine, [scenario]);

    expect(exitCode).toBe(1);
    expect(generateRequest).toHaveBeenCalledOnce();
    expect(writeLine).toHaveBeenCalledWith(`Сценарий generated-scenario: ${error}`);
    expect(writeLine).toHaveBeenCalledWith("Автоматически прошли: 0");
    expect(writeLine).toHaveBeenCalledWith("Автоматических ошибок: 1");

    const output = writeLine.mock.calls.map(([message]) => message);
    const errorPosition = output.indexOf(`Сценарий generated-scenario: ${error}`);

    if (printsReport) {
      const reportPosition = output.indexOf(`body:\n${outcome.result.body}`);
      expect(reportPosition).toBeGreaterThanOrEqual(0);
      expect(reportPosition).toBeLessThan(errorPosition);
    } else {
      expect(output).not.toContain("id: generated-scenario");
      expect(output).not.toContain(`title: ${outcome.result.title}`);
      expect(output).not.toContain(`body:\n${outcome.result.body}`);
    }
  });

  it("обычная ошибка сценария не скрывает результаты остальных и не раскрывает детали", async () => {
    const firstScenario = generatedScenario({ id: "first" });
    const secondScenario = generatedScenario({ id: "second" });
    const generateRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error("секретные технические детали ответа"))
      .mockResolvedValueOnce(generatedOutcome());
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck({ generateRequest }, writeLine, [
      firstScenario,
      secondScenario,
    ]);

    expect(exitCode).toBe(1);
    expect(generateRequest).toHaveBeenCalledTimes(2);
    expect(writeLine).toHaveBeenCalledWith("Сценарий first: ошибка генерации");
    expect(writeLine).toHaveBeenCalledWith("Сценарий second: автоматические проверки пройдены");
    expect(writeLine).not.toHaveBeenCalledWith(expect.stringContaining("секретные технические"));
    expect(writeLine).toHaveBeenCalledWith("LLM-запросов: 2");
    expect(writeLine).toHaveBeenCalledWith("Автоматически прошли: 1");
    expect(writeLine).toHaveBeenCalledWith("Автоматических ошибок: 1");
  });

  it("не вызывает LLM при отсутствующей конфигурации", async () => {
    class TestDisabledGateway extends DisabledLlmGateway {
      override generateRequest = vi.fn(super.generateRequest);
    }

    const gateway = new TestDisabledGateway();
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck(gateway, writeLine, scenarios);

    expect(exitCode).toBe(1);
    expect(gateway.generateRequest).not.toHaveBeenCalled();
    expect(writeLine).toHaveBeenCalledWith("LLM smoke-check: конфигурация провайдера недоступна");
    expect(writeLine).toHaveBeenCalledWith("LLM-запросов: 0");
  });

  it("общая недоступность провайдера прекращает дальнейшие запросы", async () => {
    const scenarioFixtures = [
      generatedScenario({ id: "first" }),
      generatedScenario({ id: "provider-error" }),
      generatedScenario({ id: "not-started" }),
    ];
    const generateRequest = vi
      .fn()
      .mockResolvedValueOnce(generatedOutcome())
      .mockRejectedValueOnce(new GenerationProviderUnavailableError())
      .mockResolvedValueOnce(generatedOutcome());
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck({ generateRequest }, writeLine, scenarioFixtures);

    expect(exitCode).toBe(1);
    expect(generateRequest).toHaveBeenCalledTimes(2);
    expect(writeLine).toHaveBeenCalledWith(
      "Сценарий provider-error: провайдер недоступен, проверка остановлена",
    );
    expect(writeLine).not.toHaveBeenCalledWith(
      "Сценарий not-started: автоматические проверки пройдены",
    );
    expect(writeLine).toHaveBeenCalledWith("LLM-запросов: 2");
    expect(writeLine).toHaveBeenCalledWith("Автоматически прошли: 1");
    expect(writeLine).toHaveBeenCalledWith("Автоматических ошибок: 1");
  });

  it("выводит данные для ручной смысловой проверки generated-сценария", async () => {
    const scenario = generatedScenario({
      input: {
        description: "В подъезде не работает освещение",
        location: "третий этаж",
      },
      mustPreserveFacts: ["освещение не работает", "третий этаж"],
      mustNotInvent: ["номер дома", "дата поломки"],
      expectWarning: true,
    });
    const outcome = generatedOutcome(["Проверьте место"]);
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck(
      { generateRequest: vi.fn().mockResolvedValue(outcome) },
      writeLine,
      [scenario],
    );

    expect(exitCode).toBe(0);
    expect(writeLine).toHaveBeenCalledWith("id: generated-scenario");
    expect(writeLine).toHaveBeenCalledWith("category: only_required_description");
    expect(writeLine).toHaveBeenCalledWith("input:");
    expect(writeLine).toHaveBeenCalledWith("description: В подъезде не работает освещение");
    expect(writeLine).toHaveBeenCalledWith("location: третий этаж");
    expect(writeLine).toHaveBeenCalledWith("title: Проверить проблему");
    expect(writeLine).toHaveBeenCalledWith(`body:\n${GENERATED_BODY}`);
    expect(writeLine).toHaveBeenCalledWith("warnings:\n- Проверьте место");
    expect(writeLine).toHaveBeenCalledWith(
      "mustPreserveFacts:\n- освещение не работает\n- третий этаж",
    );
    expect(writeLine).toHaveBeenCalledWith("mustNotInvent:\n- номер дома\n- дата поломки");
    expect(writeLine).toHaveBeenCalledWith("expectWarning: да");
    expect(writeLine).toHaveBeenCalledWith(
      "Смысловые mustPreserveFacts и mustNotInvent проверяются человеком.",
    );
  });
});
