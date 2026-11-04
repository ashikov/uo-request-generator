import { validateHeaderName, validateHeaderValue } from "node:http";
import type { LlmGateway } from "@uo-request-generator/core";
import {
  DisabledLlmGateway,
  LLM_API_PROTOCOLS,
  type LlmApiProtocol,
  OpenAiCompatibleGateway,
} from "@uo-request-generator/llm";
import { z } from "zod";

const YANDEX_CHAT_COMPLETIONS_API_URL = "https://ai.api.cloud.yandex.net/v1/chat/completions";
const YANDEX_RESPONSES_API_URL = "https://ai.api.cloud.yandex.net/v1/responses";
const YANDEX_AUTH_SCHEME = "Api-Key";
const DEFAULT_LLM_API_PROTOCOL: LlmApiProtocol = "chat-completions";
const LLM_CONFIGURATION_VARIABLES = [
  "LLM_API_PROTOCOL",
  "LLM_API_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_PROVIDER",
  "LLM_AUTH_SCHEME",
  "LLM_FOLDER_ID",
  "LLM_EXTRA_HEADERS",
] as const;
const providerIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

const llmEnvironmentSchema = z.object({
  LLM_API_PROTOCOL: z.enum(LLM_API_PROTOCOLS).default(DEFAULT_LLM_API_PROTOCOL),
  LLM_API_URL: z.url().optional(),
  LLM_API_KEY: z.string().trim().min(1).optional(),
  LLM_MODEL: z.string().trim().min(1).optional(),
  LLM_PROVIDER: providerIdentifierSchema.optional(),
  LLM_AUTH_SCHEME: z.string().trim().min(1).optional(),
  LLM_FOLDER_ID: z.string().trim().min(1).optional(),
  LLM_EXTRA_HEADERS: z.string().optional(),
});

const reservedExtraHeaderNames = new Set([
  "authorization",
  "content-type",
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "content-encoding",
  "accept-encoding",
  "expect",
  "te",
  "trailer",
  "upgrade",
  "cookie",
  "cookie2",
  "set-cookie",
  "origin",
  "referer",
  "via",
  "x-folder-id",
  "x-data-logging-enabled",
]);

function readExtraHeaders(serialized: string | undefined): Record<string, string> {
  if (serialized === undefined) return {};

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error();
    }
    const entries: Array<[string, string]> = [];
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== "string") throw new Error();
      validateHeaderName(name);
      validateHeaderValue(name, value);
      const normalizedName = name.toLowerCase();
      if (
        reservedExtraHeaderNames.has(normalizedName) ||
        /^(?:proxy-|sec-)/u.test(normalizedName)
      ) {
        throw new Error();
      }
      entries.push([name, value]);
    }

    // JSON.parse теряет повторные ключи, включая прежние нестроковые значения.
    // Каждая итоговая пара даёт два токена, а дубликат добавляет хотя бы токен имени.
    const stringTokens = serialized.match(/"(?:[^"\\]|\\.)*"/gu) ?? [];
    if (stringTokens.length !== entries.length * 2) throw new Error();
    const names = new Set<string>();
    for (let index = 0; index < stringTokens.length; index += 2) {
      const token = stringTokens[index];
      if (token === undefined) throw new Error();
      const name: unknown = JSON.parse(token);
      if (typeof name !== "string") throw new Error();
      const normalizedName = name.toLowerCase();
      if (names.has(normalizedName)) throw new Error();
      names.add(normalizedName);
    }
    return Object.fromEntries(entries);
  } catch {
    throw new Error("Invalid LLM configuration");
  }
}

function isLlmConfigurationAbsent(environment: NodeJS.ProcessEnv): boolean {
  return LLM_CONFIGURATION_VARIABLES.every(
    (variableName) => environment[variableName] === undefined,
  );
}

export function createLlmGateway(environment: NodeJS.ProcessEnv): LlmGateway {
  if (isLlmConfigurationAbsent(environment)) {
    return new DisabledLlmGateway();
  }

  const environmentValidation = llmEnvironmentSchema.safeParse(environment);

  if (!environmentValidation.success) {
    throw new Error("Invalid LLM configuration");
  }

  const {
    LLM_API_PROTOCOL,
    LLM_API_KEY,
    LLM_API_URL,
    LLM_AUTH_SCHEME,
    LLM_FOLDER_ID,
    LLM_MODEL,
    LLM_PROVIDER,
    LLM_EXTRA_HEADERS,
  } = environmentValidation.data;

  if (LLM_API_KEY === undefined) {
    throw new Error("Invalid LLM configuration");
  }

  const extraHeaders = {
    ...readExtraHeaders(LLM_EXTRA_HEADERS),
    ...(LLM_FOLDER_ID === undefined ? {} : { "x-folder-id": LLM_FOLDER_ID }),
    ...(LLM_API_URL === undefined || LLM_PROVIDER === "yandex"
      ? { "x-data-logging-enabled": "false" }
      : {}),
  };

  if (LLM_API_URL !== undefined) {
    if (LLM_MODEL === undefined || LLM_AUTH_SCHEME === undefined || LLM_PROVIDER === undefined) {
      throw new Error("Invalid LLM configuration");
    }

    return new OpenAiCompatibleGateway({
      apiUrl: LLM_API_URL,
      apiKey: LLM_API_KEY,
      model: LLM_MODEL,
      authScheme: LLM_AUTH_SCHEME,
      apiProtocol: LLM_API_PROTOCOL,
      provider: LLM_PROVIDER,
      configurationClass: "custom-openai-compatible",
      extraHeaders,
    });
  }

  const model =
    LLM_MODEL ??
    (LLM_FOLDER_ID === undefined
      ? undefined
      : LLM_API_PROTOCOL === "responses"
        ? `gpt://${LLM_FOLDER_ID}/aliceai-llm-flash/latest`
        : `gpt://${LLM_FOLDER_ID}/yandexgpt/latest`);

  if (model === undefined) {
    throw new Error("Invalid LLM configuration");
  }

  return new OpenAiCompatibleGateway({
    apiUrl:
      LLM_API_PROTOCOL === "responses" ? YANDEX_RESPONSES_API_URL : YANDEX_CHAT_COMPLETIONS_API_URL,
    apiKey: LLM_API_KEY,
    model,
    authScheme: LLM_AUTH_SCHEME ?? YANDEX_AUTH_SCHEME,
    apiProtocol: LLM_API_PROTOCOL,
    provider: "yandex",
    configurationClass: "builtin-yandex",
    extraHeaders,
  });
}
