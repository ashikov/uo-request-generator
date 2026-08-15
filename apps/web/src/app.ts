import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { LlmGateway } from "@uo-request-generator/core";
import { DisabledLlmGateway } from "@uo-request-generator/llm";
import Fastify, { type FastifyInstance } from "fastify";
import { type GenerationEventWriter, writeGenerationEventToStdout } from "./generation-log.js";
import {
  createGenerationRateLimitConfig,
  type GenerationRateLimitConfig,
} from "./generation-rate-limit-config.js";
import { GenerationRateLimiter } from "./generation-rate-limiter.js";
import {
  createGenerationSafeguardConfig,
  type GenerationSafeguardConfig,
} from "./generation-safeguard-config.js";
import { GenerationSafeguard } from "./generation-safeguard.js";
import { registerCaptchaConfigRoute } from "./routes/captcha-config.js";
import { registerGenerateRoute } from "./routes/generate.js";
import { registerHealthRoute } from "./routes/health.js";
import type { SmartCaptchaConfig } from "./smartcaptcha-config.js";
import { SmartCaptchaVerifier } from "./smartcaptcha-verifier.js";

export type CreateAppOptions = {
  llmGateway?: LlmGateway;
  generationRateLimitConfig?: GenerationRateLimitConfig;
  generationRateLimiterNow?: () => number;
  generationRateLimiter?: GenerationRateLimiter;
  generateGenerationClientId?: () => string;
  generationSafeguardConfig?: GenerationSafeguardConfig;
  generationSafeguardNow?: () => number;
  generationSafeguard?: GenerationSafeguard;
  smartCaptchaConfig?: SmartCaptchaConfig;
  smartCaptchaVerifier?: Pick<SmartCaptchaVerifier, "verify">;
  writeGenerationEvent?: GenerationEventWriter;
};

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const llmGateway = options.llmGateway ?? new DisabledLlmGateway();
  const generationRateLimitConfig =
    options.generationRateLimitConfig ??
    createGenerationRateLimitConfig(
      {},
      {
        allowEphemeralCookieSecret: llmGateway instanceof DisabledLlmGateway,
      },
    );
  const smartCaptchaConfig =
    options.smartCaptchaConfig ??
    (llmGateway instanceof DisabledLlmGateway ? { mode: "disabled" } : undefined);
  if (smartCaptchaConfig === undefined) {
    throw new Error("SmartCaptcha configuration is required");
  }
  const generationSafeguardConfig =
    options.generationSafeguard === undefined
      ? (options.generationSafeguardConfig ??
        createGenerationSafeguardConfig(
          {},
          { allowImplicitDisabledGateway: llmGateway instanceof DisabledLlmGateway },
        ))
      : undefined;
  const app = Fastify({
    logger: false,
    trustProxy:
      generationRateLimitConfig.trustedProxies.length === 0
        ? false
        : [...generationRateLimitConfig.trustedProxies],
  });
  const generationRateLimiter =
    options.generationRateLimiter ??
    new GenerationRateLimiter(generationRateLimitConfig, options.generationRateLimiterNow);
  const generationSafeguard =
    options.generationSafeguard ??
    new GenerationSafeguard(generationSafeguardConfig, options.generationSafeguardNow);
  const smartCaptchaVerifier =
    options.smartCaptchaVerifier ??
    (smartCaptchaConfig.mode === "required"
      ? new SmartCaptchaVerifier({ serverKey: smartCaptchaConfig.serverKey })
      : undefined);
  const writeGenerationEvent = options.writeGenerationEvent ?? writeGenerationEventToStdout;

  app.register(fastifyCookie, {
    secret: generationRateLimitConfig.cookieSecret,
  });

  registerHealthRoute(app);
  registerCaptchaConfigRoute(app, smartCaptchaConfig);
  registerGenerateRoute(app, {
    llmGateway,
    generationRateLimiter,
    generationSafeguard,
    generateClientId: options.generateGenerationClientId ?? randomUUID,
    smartCaptchaConfig,
    writeGenerationEvent,
    ...(smartCaptchaVerifier === undefined ? {} : { smartCaptchaVerifier }),
  });

  app.register(fastifyStatic, {
    root: publicDirectory,
    wildcard: false,
  });

  return app;
}
