import {
  renderPrimaryRequestDraft,
  type GenerateRequestInput,
  type GenerateRequestOutcome,
  type LlmGateway,
} from "@uo-request-generator/core";
import { z } from "zod";
import { GenerationProviderUnavailableError } from "./disabled-llm-gateway.js";
import {
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
  chatCompletionsOutputTokenParameter?: ChatCompletionsOutputTokenParameter;
};

export const LLM_API_PROTOCOLS = ["chat-completions", "responses"] as const;
export type LlmApiProtocol = (typeof LLM_API_PROTOCOLS)[number];
export const CHAT_COMPLETIONS_OUTPUT_TOKEN_PARAMETERS = [
  "max_tokens",
  "max_completion_tokens",
] as const;
export type ChatCompletionsOutputTokenParameter =
  (typeof CHAT_COMPLETIONS_OUTPUT_TOKEN_PARAMETERS)[number];

export type LlmProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type OpenAiCompatibleGenerationSuccess = {
  status: "success";
  outcome: GenerateRequestOutcome;
  usage?: LlmProviderUsage;
};

type OpenAiCompatibleGenerationFailure = {
  status: "failure";
  failureKind: "request" | "provider";
  error: "request failed" | "provider unavailable";
  statusCode?: number;
  usage?: LlmProviderUsage;
};

export type OpenAiCompatibleGeneration =
  | OpenAiCompatibleGenerationSuccess
  | OpenAiCompatibleGenerationFailure;

type InternalGenerationFailure = OpenAiCompatibleGenerationFailure & {
  productionError: Error;
};

type InternalGeneration = OpenAiCompatibleGenerationSuccess | InternalGenerationFailure;

type OpenAiChatMessage = {
  role: "system" | "user";
  content: string;
};

type OpenAiChatCompletionRequest = {
  model: string;
  messages: OpenAiChatMessage[];
  temperature: number;
  response_format: {
    type: "json_schema";
    json_schema: {
      name: typeof REQUEST_DRAFT_RESPONSE_FORMAT_NAME;
      strict: true;
      schema: typeof REQUEST_DRAFT_JSON_SCHEMA;
    };
  };
  max_tokens?: number;
  max_completion_tokens?: number;
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
  usage: z.unknown().optional(),
});

const openAiResponsesResponseSchema = z
  .object({
    status: z.string().optional(),
    output_text: z.string().nullable().optional(),
    output: z.array(z.unknown()).optional(),
    usage: z.unknown().optional(),
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

const DEFAULT_MAX_OUTPUT_TOKENS = 4000;
const TEMPERATURE = 0.3;

const chatCompletionsUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

const responsesUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

const usageEnvelopeSchema = z
  .object({
    usage: z.unknown().optional(),
  })
  .passthrough();

export type OpenAiCompatibleRequestBodyConfig = {
  apiProtocol: LlmApiProtocol;
  model: string;
  maxOutputTokens: number;
  chatCompletionsOutputTokenParameter?: ChatCompletionsOutputTokenParameter;
};

export function createOpenAiCompatibleRequestBody(
  config: OpenAiCompatibleRequestBodyConfig,
  input: GenerateRequestInput,
): OpenAiChatCompletionRequest | OpenAiResponsesRequest {
  const userMessage = createUserMessage(input);

  if (config.apiProtocol === "responses") {
    return {
      model: config.model,
      instructions: REQUEST_DRAFT_SYSTEM_PROMPT,
      input: userMessage,
      temperature: TEMPERATURE,
      max_output_tokens: config.maxOutputTokens,
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

  const requestBody: OpenAiChatCompletionRequest = {
    model: config.model,
    messages: [
      { role: "system", content: REQUEST_DRAFT_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: TEMPERATURE,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: REQUEST_DRAFT_RESPONSE_FORMAT_NAME,
        strict: true,
        schema: REQUEST_DRAFT_JSON_SCHEMA,
      },
    },
  };

  if (config.chatCompletionsOutputTokenParameter !== undefined) {
    requestBody[config.chatCompletionsOutputTokenParameter] = config.maxOutputTokens;
  }

  return requestBody;
}

function createUserMessage(input: GenerateRequestInput): string {
  const location = input.location?.trim();
  const consequences = input.consequences?.trim();
  const desiredActions = input.desiredActions?.trim();

  return JSON.stringify({
    description: input.description,
    location: location || null,
    consequences: consequences || null,
    desiredActions: desiredActions || null,
  });
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

function extractUsage(
  apiProtocol: LlmApiProtocol,
  responseBody: unknown,
): LlmProviderUsage | undefined {
  const responseResult = usageEnvelopeSchema.safeParse(responseBody);
  if (!responseResult.success || responseResult.data.usage === undefined) {
    return undefined;
  }

  if (apiProtocol === "responses") {
    const usageResult = responsesUsageSchema.safeParse(responseResult.data.usage);
    return usageResult.success
      ? {
          inputTokens: usageResult.data.input_tokens,
          outputTokens: usageResult.data.output_tokens,
          totalTokens: usageResult.data.total_tokens,
        }
      : undefined;
  }

  const usageResult = chatCompletionsUsageSchema.safeParse(responseResult.data.usage);
  return usageResult.success
    ? {
        inputTokens: usageResult.data.prompt_tokens,
        outputTokens: usageResult.data.completion_tokens,
        totalTokens: usageResult.data.total_tokens,
      }
    : undefined;
}

function classifyHttpFailure(statusCode: number): "request" | "provider" {
  return statusCode === 400 || statusCode === 404 || statusCode === 422 ? "request" : "provider";
}

function createGenerationFailure(
  failureKind: "request" | "provider",
  productionError: Error,
  metadata: { statusCode?: number; usage?: LlmProviderUsage } = {},
): InternalGenerationFailure {
  return {
    status: "failure",
    failureKind,
    error: failureKind === "request" ? "request failed" : "provider unavailable",
    productionError,
    ...(metadata.statusCode === undefined ? {} : { statusCode: metadata.statusCode }),
    ...(metadata.usage === undefined ? {} : { usage: metadata.usage }),
  };
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
  private readonly chatCompletionsOutputTokenParameter:
    | ChatCompletionsOutputTokenParameter
    | undefined;

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
    this.chatCompletionsOutputTokenParameter = config.chatCompletionsOutputTokenParameter;
  }

  async generateRequest(input: GenerateRequestInput): Promise<GenerateRequestOutcome> {
    const generation = await this.executeGeneration(input);
    if (generation.status === "failure") {
      throw generation.productionError;
    }

    return generation.outcome;
  }

  async generateRequestWithMetadata(
    input: GenerateRequestInput,
  ): Promise<OpenAiCompatibleGeneration> {
    const generation = await this.executeGeneration(input);
    if (generation.status === "success") {
      return generation;
    }

    const { productionError: _productionError, ...failure } = generation;
    return failure;
  }

  private async executeGeneration(input: GenerateRequestInput): Promise<InternalGeneration> {
    const requestBody = createOpenAiCompatibleRequestBody(
      {
        apiProtocol: this.apiProtocol,
        model: this.model,
        maxOutputTokens: this.maxOutputTokens,
        ...(this.chatCompletionsOutputTokenParameter === undefined
          ? {}
          : {
              chatCompletionsOutputTokenParameter: this.chatCompletionsOutputTokenParameter,
            }),
      },
      input,
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
        return createGenerationFailure("provider", new GenerationProviderUnavailableError());
      }
      return createGenerationFailure("provider", new GenerationProviderUnavailableError());
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      const failureKind = response.ok ? "request" : classifyHttpFailure(response.status);
      return createGenerationFailure(failureKind, new GenerationProviderUnavailableError(), {
        statusCode: response.status,
      });
    }

    const usage = extractUsage(this.apiProtocol, data);

    if (!response.ok) {
      return createGenerationFailure(
        classifyHttpFailure(response.status),
        new GenerationProviderUnavailableError(),
        {
          statusCode: response.status,
          ...(usage === undefined ? {} : { usage }),
        },
      );
    }

    let content: string;

    try {
      content = extractResponseText(this.apiProtocol, data);
    } catch (error) {
      return createGenerationFailure(
        "request",
        error instanceof Error ? error : new GenerationProviderUnavailableError(),
        usage === undefined ? {} : { usage },
      );
    }

    if (!content || content.trim().length === 0) {
      return createGenerationFailure(
        "request",
        new Error("LLM API вернул пустой ответ"),
        usage === undefined ? {} : { usage },
      );
    }

    try {
      const draft = parseRequestDraft(content);

      if (draft.outcome === "multiple_issues") {
        return {
          status: "success",
          outcome: { status: "multiple_issues" },
          ...(usage === undefined ? {} : { usage }),
        };
      }

      const { outcome: _outcome, ...primaryRequestDraft } = draft;

      return {
        status: "success",
        outcome: {
          status: "generated",
          result: renderPrimaryRequestDraft(primaryRequestDraft),
        },
        ...(usage === undefined ? {} : { usage }),
      };
    } catch (error) {
      return createGenerationFailure(
        "request",
        error instanceof Error ? error : new Error("LLM вернул некорректный формат заявки"),
        usage === undefined ? {} : { usage },
      );
    }
  }
}
