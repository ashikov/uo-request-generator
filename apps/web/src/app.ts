import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { LlmGateway } from "@uo-request-generator/core";
import { DisabledLlmGateway } from "@uo-request-generator/llm";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import {
  createGenerationRateLimitConfig,
  type GenerationRateLimitConfig,
} from "./generation-rate-limit-config.js";
import { GenerationRateLimiter } from "./generation-rate-limiter.js";
import { registerGenerateRoute } from "./routes/generate.js";
import { registerHealthRoute } from "./routes/health.js";

export type CreateAppOptions = {
  llmGateway?: LlmGateway;
  generationRateLimitConfig?: GenerationRateLimitConfig;
  generationRateLimiterNow?: () => number;
  generateGenerationClientId?: () => string;
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
  const app = Fastify({
    logger: false,
    trustProxy: generationRateLimitConfig.trustProxy,
  });
  const generationRateLimiter = new GenerationRateLimiter(
    generationRateLimitConfig,
    options.generationRateLimiterNow,
  );

  app.register(fastifyCookie, {
    secret: generationRateLimitConfig.cookieSecret,
  });

  registerHealthRoute(app);
  registerGenerateRoute(app, {
    llmGateway,
    generationRateLimiter,
    generateClientId: options.generateGenerationClientId ?? randomUUID,
  });

  app.register(fastifyStatic, {
    root: publicDirectory,
    wildcard: false,
  });

  return app;
}
