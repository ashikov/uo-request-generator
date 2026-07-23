import { pathToFileURL } from "node:url";
import type { LlmGateway } from "@uo-request-generator/core";
import { DisabledLlmGateway, GenerationProviderUnavailableError } from "@uo-request-generator/llm";
import { createLlmGateway } from "./llm-config.js";

const SMOKE_INPUT = {
  description: "В общем коридоре не работает освещение",
};

type WriteLine = (message: string) => void;

export async function runLlmSmokeCheck(gateway: LlmGateway, writeLine: WriteLine): Promise<0 | 1> {
  if (gateway instanceof DisabledLlmGateway) {
    writeLine("LLM smoke-check: конфигурация провайдера недоступна");
    return 1;
  }

  try {
    await gateway.generateRequest(SMOKE_INPUT);
    writeLine("LLM smoke-check выполнен успешно");
    return 0;
  } catch (error) {
    if (error instanceof GenerationProviderUnavailableError) {
      writeLine("LLM smoke-check: провайдер недоступен");
      return 1;
    }

    writeLine("LLM smoke-check: результат не прошёл проверку");
    return 1;
  }
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
