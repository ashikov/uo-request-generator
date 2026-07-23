import type { LlmGateway } from "@uo-request-generator/core";
import { DisabledLlmGateway, GenerationProviderUnavailableError } from "@uo-request-generator/llm";
import { describe, expect, it, vi } from "vitest";
import { runLlmSmokeCheck } from "../src/llm-smoke.js";

describe("runLlmSmokeCheck", () => {
  it("выполняет один запрос с фиксированным обезличенным вводом", async () => {
    const generateRequest = vi.fn().mockResolvedValue({
      title: "Не работает освещение",
      body: "В общем коридоре не работает освещение. Прошу: восстановить освещение.",
      warnings: [],
    });
    const gateway: LlmGateway = { generateRequest };
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck(gateway, writeLine);

    expect(generateRequest).toHaveBeenCalledOnce();
    expect(generateRequest).toHaveBeenCalledWith({
      description: "В общем коридоре не работает освещение",
    });
    expect(writeLine).toHaveBeenCalledWith("LLM smoke-check выполнен успешно");
    expect(exitCode).toBe(0);
  });

  it("не выполняет запрос при отключённой конфигурации", async () => {
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck(new DisabledLlmGateway(), writeLine);

    expect(writeLine).toHaveBeenCalledWith("LLM smoke-check: конфигурация провайдера недоступна");
    expect(exitCode).toBe(1);
  });

  it("выводит безопасную категорию недоступности провайдера", async () => {
    const gateway: LlmGateway = {
      generateRequest: vi.fn().mockRejectedValue(new GenerationProviderUnavailableError()),
    };
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck(gateway, writeLine);

    expect(writeLine).toHaveBeenCalledWith("LLM smoke-check: провайдер недоступен");
    expect(exitCode).toBe(1);
  });

  it("не выводит детали неожиданной ошибки", async () => {
    const gateway: LlmGateway = {
      generateRequest: vi.fn().mockRejectedValue(new Error("секретные технические детали ответа")),
    };
    const writeLine = vi.fn();

    const exitCode = await runLlmSmokeCheck(gateway, writeLine);

    expect(writeLine).toHaveBeenCalledWith("LLM smoke-check: результат не прошёл проверку");
    expect(writeLine).not.toHaveBeenCalledWith(
      expect.stringContaining("секретные технические детали"),
    );
    expect(exitCode).toBe(1);
  });
});
