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

const llmEnvironmentSchema = z.object({
  LLM_API_PROTOCOL: z.enum(LLM_API_PROTOCOLS).default(DEFAULT_LLM_API_PROTOCOL),
  LLM_API_URL: z.url().optional(),
  LLM_API_KEY: z.string().trim().min(1).optional(),
  LLM_MODEL: z.string().trim().min(1).optional(),
  LLM_AUTH_SCHEME: z.string().trim().min(1).optional(),
  LLM_FOLDER_ID: z.string().trim().min(1).optional(),
});

export function createLlmGateway(environment: NodeJS.ProcessEnv): LlmGateway {
  const environmentValidation = llmEnvironmentSchema.safeParse(environment);

  if (!environmentValidation.success) {
    return new DisabledLlmGateway();
  }

  const { LLM_API_PROTOCOL, LLM_API_KEY, LLM_API_URL, LLM_AUTH_SCHEME, LLM_FOLDER_ID, LLM_MODEL } =
    environmentValidation.data;

  if (LLM_API_KEY === undefined) {
    return new DisabledLlmGateway();
  }

  if (LLM_API_URL !== undefined) {
    if (LLM_MODEL === undefined || LLM_AUTH_SCHEME === undefined) {
      return new DisabledLlmGateway();
    }

    return new OpenAiCompatibleGateway({
      apiUrl: LLM_API_URL,
      apiKey: LLM_API_KEY,
      model: LLM_MODEL,
      authScheme: LLM_AUTH_SCHEME,
      apiProtocol: LLM_API_PROTOCOL,
      ...(LLM_FOLDER_ID === undefined ? {} : { extraHeaders: { "x-folder-id": LLM_FOLDER_ID } }),
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
    return new DisabledLlmGateway();
  }

  return new OpenAiCompatibleGateway({
    apiUrl:
      LLM_API_PROTOCOL === "responses" ? YANDEX_RESPONSES_API_URL : YANDEX_CHAT_COMPLETIONS_API_URL,
    apiKey: LLM_API_KEY,
    model,
    authScheme: LLM_AUTH_SCHEME ?? YANDEX_AUTH_SCHEME,
    apiProtocol: LLM_API_PROTOCOL,
    ...(LLM_FOLDER_ID === undefined ? {} : { extraHeaders: { "x-folder-id": LLM_FOLDER_ID } }),
  });
}
