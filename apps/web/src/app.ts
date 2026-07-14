import { fileURLToPath } from "node:url";
import type { LlmGateway } from "@uo-request-generator/core";
import { DisabledLlmGateway } from "@uo-request-generator/llm";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGenerateRoute } from "./routes/generate.js";
import { registerHealthRoute } from "./routes/health.js";

export type CreateAppOptions = {
  llmGateway?: LlmGateway;
};

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
  });
  const llmGateway = options.llmGateway ?? new DisabledLlmGateway();

  registerHealthRoute(app);
  registerGenerateRoute(app, llmGateway);

  app.register(fastifyStatic, {
    root: publicDirectory,
    wildcard: false,
  });

  return app;
}
