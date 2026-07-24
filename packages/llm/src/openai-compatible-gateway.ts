import type {
  GenerateRequestInput,
  GenerateRequestResult,
  LlmGateway,
} from "@uo-request-generator/core";
import { z } from "zod";
import { GenerationProviderUnavailableError } from "./disabled-llm-gateway.js";
import {
  formatRequestDraft,
  parseRequestDraft,
  REQUEST_DRAFT_JSON_SCHEMA,
  REQUEST_DRAFT_RESPONSE_FORMAT_NAME,
  REQUEST_DRAFT_SYSTEM_PROMPT,
} from "./request-draft.js";

export type OpenAiCompatibleGatewayConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  authScheme: string;
  apiProtocol: LlmApiProtocol;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxOutputTokens?: number;
};

export const LLM_API_PROTOCOLS = ["chat-completions", "responses"] as const;
export type LlmApiProtocol = (typeof LLM_API_PROTOCOLS)[number];

type OpenAiChatMessage = {
  role: "system" | "user";
  content: string;
};

type OpenAiChatCompletionRequest = {
  model: string;
  messages: OpenAiChatMessage[];
  temperature: number;
};

type OpenAiResponsesRequest = {
  model: string;
  instructions: string;
  input: string;
  temperature: number;
  max_output_tokens: number;
  store: false;
  text: {
    format: {
      type: "json_schema";
      name: typeof REQUEST_DRAFT_RESPONSE_FORMAT_NAME;
      strict: true;
      schema: typeof REQUEST_DRAFT_JSON_SCHEMA;
    };
  };
};

const openAiChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

const openAiResponsesResponseSchema = z
  .object({
    status: z.string().optional(),
    output_text: z.string().nullable().optional(),
    output: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .refine((response) => response.output_text !== undefined || response.output !== undefined);

const openAiResponsesOutputItemSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const openAiResponsesMessageSchema = z
  .object({
    type: z.literal("message"),
    content: z.array(z.unknown()),
  })
  .passthrough();

const openAiResponsesContentItemSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const openAiResponsesOutputTextSchema = z
  .object({
    type: z.literal("output_text"),
    text: z.string(),
  })
  .passthrough();

const DEFAULT_MAX_OUTPUT_TOKENS = 1000;
const TEMPERATURE = 0.3;

function createRequestBody(
  apiProtocol: LlmApiProtocol,
  model: string,
  userMessage: string,
  maxOutputTokens: number,
): OpenAiChatCompletionRequest | OpenAiResponsesRequest {
  if (apiProtocol === "responses") {
    return {
      model,
      instructions: REQUEST_DRAFT_SYSTEM_PROMPT,
      input: userMessage,
      temperature: TEMPERATURE,
      max_output_tokens: maxOutputTokens,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: REQUEST_DRAFT_RESPONSE_FORMAT_NAME,
          strict: true,
          schema: REQUEST_DRAFT_JSON_SCHEMA,
        },
      },
    };
  }

  return {
    model,
    messages: [
      { role: "system", content: REQUEST_DRAFT_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: TEMPERATURE,
  };
}

function extractResponsesText(responseBody: unknown): string {
  const responseResult = openAiResponsesResponseSchema.safeParse(responseBody);

  if (!responseResult.success) {
    throw new GenerationProviderUnavailableError();
  }

  if (responseResult.data.status !== undefined && responseResult.data.status !== "completed") {
    throw new GenerationProviderUnavailableError();
  }

  const aggregatedText = responseResult.data.output_text;

  if (typeof aggregatedText === "string" && aggregatedText.trim().length > 0) {
    return aggregatedText;
  }

  if (responseResult.data.status === undefined && responseResult.data.output !== undefined) {
    throw new GenerationProviderUnavailableError();
  }

  const textParts: string[] = [];

  for (const outputItem of responseResult.data.output ?? []) {
    const outputItemResult = openAiResponsesOutputItemSchema.safeParse(outputItem);

    if (!outputItemResult.success) {
      throw new GenerationProviderUnavailableError();
    }

    if (outputItemResult.data.type !== "message") {
      continue;
    }

    const messageResult = openAiResponsesMessageSchema.safeParse(outputItem);

    if (!messageResult.success) {
      throw new GenerationProviderUnavailableError();
    }

    for (const contentItem of messageResult.data.content) {
      const contentItemResult = openAiResponsesContentItemSchema.safeParse(contentItem);

      if (!contentItemResult.success) {
        throw new GenerationProviderUnavailableError();
      }

      if (contentItemResult.data.type !== "output_text") {
        continue;
      }

      const outputTextResult = openAiResponsesOutputTextSchema.safeParse(contentItem);

      if (!outputTextResult.success) {
        throw new GenerationProviderUnavailableError();
      }

      textParts.push(outputTextResult.data.text);
    }
  }

  return textParts.join("");
}

function extractResponseText(apiProtocol: LlmApiProtocol, responseBody: unknown): string {
  if (apiProtocol === "responses") {
    return extractResponsesText(responseBody);
  }

  const apiResult = openAiChatCompletionResponseSchema.safeParse(responseBody);

  if (!apiResult.success) {
    throw new GenerationProviderUnavailableError();
  }

  const firstChoice = apiResult.data.choices[0];

  if (firstChoice === undefined) {
    throw new GenerationProviderUnavailableError();
  }

  return firstChoice.message.content;
}

export class OpenAiCompatibleGateway implements LlmGateway {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly authScheme: string;
  private readonly apiProtocol: LlmApiProtocol;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;

  constructor(config: OpenAiCompatibleGatewayConfig) {
    if (!config.apiKey) {
      throw new Error("LLM_API_KEY не может быть пустым");
    }

    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.authScheme = config.authScheme;
    this.apiProtocol = config.apiProtocol;
    this.extraHeaders = config.extraHeaders ?? {};
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  async generateRequest(input: GenerateRequestInput): Promise<GenerateRequestResult> {
    const userMessage = input.location
      ? `Проблема: ${input.description}\n\nМесто: ${input.location}`
      : `Проблема: ${input.description}`;

    const requestBody = createRequestBody(
      this.apiProtocol,
      this.model,
      userMessage,
      this.maxOutputTokens,
    );

    let response: Response;

    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${this.authScheme} ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new GenerationProviderUnavailableError();
      }
      throw new GenerationProviderUnavailableError();
    }

    if (!response.ok) {
      throw new GenerationProviderUnavailableError();
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      throw new GenerationProviderUnavailableError();
    }

    const content = extractResponseText(this.apiProtocol, data);

    if (!content || content.trim().length === 0) {
      throw new Error("LLM API вернул пустой ответ");
    }

    return formatRequestDraft(parseRequestDraft(content));
  }
}
