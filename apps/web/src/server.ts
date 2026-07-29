import { DisabledLlmGateway } from "@uo-request-generator/llm";
import { createApp } from "./app.js";
import { createGenerationRateLimitConfig } from "./generation-rate-limit-config.js";
import { createGenerationSafeguardConfig } from "./generation-safeguard-config.js";
import { createLlmGateway } from "./llm-config.js";
import { createSmartCaptchaConfig } from "./smartcaptcha-config.js";

const DEFAULT_PORT = 3000;

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

async function main(): Promise<void> {
  const llmGateway = createLlmGateway(process.env);
  const generationRateLimitConfig = createGenerationRateLimitConfig(process.env, {
    allowEphemeralCookieSecret: llmGateway instanceof DisabledLlmGateway,
  });
  const smartCaptchaConfig = createSmartCaptchaConfig(process.env, {
    allowImplicitDisabled: llmGateway instanceof DisabledLlmGateway,
  });
  const generationSafeguardConfig = createGenerationSafeguardConfig(process.env, {
    allowImplicitDisabledGateway: llmGateway instanceof DisabledLlmGateway,
  });
  const app = createApp({
    llmGateway,
    generationRateLimitConfig,
    smartCaptchaConfig,
    ...(generationSafeguardConfig === undefined ? {} : { generationSafeguardConfig }),
  });
  let isClosing = false;

  async function close(): Promise<void> {
    if (isClosing) {
      return;
    }

    isClosing = true;
    await app.close();
  }

  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });

  try {
    await app.listen({
      host: process.env.HOST ?? "0.0.0.0",
      port: readPort(process.env.PORT),
    });
  } catch {
    process.exitCode = 1;
    await close();
  }
}

void main();
