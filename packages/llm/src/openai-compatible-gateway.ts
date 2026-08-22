import {
  renderPrimaryRequestDraft,
  selectSpecificLegalBasisModule,
  type GenerateRequestInput,
  type GenerateRequestOutcome,
  type LlmGateway,
  type LlmGenerationFailureStatus,
  type LlmGenerationMetadata,
  type LlmUsage,
  type LlmUsageStatus,
  type PrimaryRequestDraft,
} from "@uo-request-generator/core";
import { z } from "zod";
import {
  GenerationInvalidResponseError,
  GenerationNetworkError,
  GenerationProviderUnavailableError,
  GenerationTimeoutError,
} from "./generation-error.js";
import {
  createRequestDraftJsonSchema,
  createRequestDraftSystemPrompt,
  createRequestDraftSystemPromptHash,
  parseRequestDraft,
  REQUEST_DRAFT_RESPONSE_FORMAT_NAME,
} from "./request-draft.js";

export type OpenAiCompatibleGatewayConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  authScheme: string;
  apiProtocol: LlmApiProtocol;
  provider: string;
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

export type LlmProviderUsage = LlmUsage;

type OpenAiCompatibleGenerationSuccess = {
  status: "success";
  outcome: GenerateRequestOutcome;
  metadata: LlmGenerationMetadata;
  usage?: LlmProviderUsage;
};

type OpenAiCompatibleGenerationFailure = {
  status: "failure";
  failureKind: "request" | "provider";
  error: "request failed" | "provider unavailable";
  failureStatus: LlmGenerationFailureStatus;
  metadata: LlmGenerationMetadata;
  statusCode?: number;
  usage?: LlmProviderUsage;
};

export type OpenAiCompatibleGeneration =
  | OpenAiCompatibleGenerationSuccess
  | OpenAiCompatibleGenerationFailure;

export type OpenAiCompatibleEvaluationObservation = {
  draft?: PrimaryRequestDraft;
  selectedNormativeModule?: string | null;
};

export type OpenAiCompatibleEvaluationGeneration =
  | (OpenAiCompatibleGenerationSuccess & {
      observation: OpenAiCompatibleEvaluationObservation;
      systemPromptHash: string;
    })
  | OpenAiCompatibleGenerationFailure;

type UnannotatedGenerationSuccess = Omit<OpenAiCompatibleGenerationSuccess, "metadata"> &
  OpenAiCompatibleEvaluationObservation & {
    usageStatus: LlmUsageStatus;
  };

type UnannotatedGenerationFailure = Omit<OpenAiCompatibleGenerationFailure, "metadata"> & {
  usageStatus: LlmUsageStatus;
};

type InternalGenerationFailure = UnannotatedGenerationFailure & {
  productionError: Error;
};

type UnannotatedGeneration = UnannotatedGenerationSuccess | InternalGenerationFailure;
type TimedGeneration =
  | (UnannotatedGenerationSuccess & { providerDurationMs: number })
  | (InternalGenerationFailure & { providerDurationMs: number });
type InternalGeneration =
  | (OpenAiCompatibleGenerationSuccess & {
      draft?: PrimaryRequestDraft;
      selectedNormativeModule?: string | null;
      usageStatus: LlmUsageStatus;
      providerDurationMs: number;
    })
  | (OpenAiCompatibleGenerationFailure & {
      productionError: Error;
      usageStatus: LlmUsageStatus;
      providerDurationMs: number;
    });

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
      schema: ReturnType<typeof createRequestDraftJsonSchema>;
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
      schema: ReturnType<typeof createRequestDraftJsonSchema>;
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
  systemPrompt = createRequestDraftSystemPrompt(input.confirmedProblemSubject),
): OpenAiChatCompletionRequest | OpenAiResponsesRequest {
  const userMessage = createUserMessage(input);
  const jsonSchema = createRequestDraftJsonSchema(input.confirmedProblemSubject);

  if (config.apiProtocol === "responses") {
    return {
      model: config.model,
      instructions: systemPrompt,
      input: userMessage,
      temperature: TEMPERATURE,
      max_output_tokens: config.maxOutputTokens,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: REQUEST_DRAFT_RESPONSE_FORMAT_NAME,
          strict: true,
          schema: jsonSchema,
        },
      },
    };
  }

  const requestBody: OpenAiChatCompletionRequest = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: TEMPERATURE,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: REQUEST_DRAFT_RESPONSE_FORMAT_NAME,
        strict: true,
        schema: jsonSchema,
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
    throw new GenerationInvalidResponseError();
  }

  if (responseResult.data.status !== undefined && responseResult.data.status !== "completed") {
    throw new GenerationInvalidResponseError();
  }

  const aggregatedText = responseResult.data.output_text;

  if (typeof aggregatedText === "string" && aggregatedText.trim().length > 0) {
    return aggregatedText;
  }

  if (responseResult.data.status === undefined && responseResult.data.output !== undefined) {
    throw new GenerationInvalidResponseError();
  }

  const textParts: string[] = [];

  for (const outputItem of responseResult.data.output ?? []) {
    const outputItemResult = openAiResponsesOutputItemSchema.safeParse(outputItem);

    if (!outputItemResult.success) {
      throw new GenerationInvalidResponseError();
    }

    if (outputItemResult.data.type !== "message") {
      continue;
    }

    const messageResult = openAiResponsesMessageSchema.safeParse(outputItem);

    if (!messageResult.success) {
      throw new GenerationInvalidResponseError();
    }

    for (const contentItem of messageResult.data.content) {
      const contentItemResult = openAiResponsesContentItemSchema.safeParse(contentItem);

      if (!contentItemResult.success) {
        throw new GenerationInvalidResponseError();
      }

      if (contentItemResult.data.type !== "output_text") {
        continue;
      }

      const outputTextResult = openAiResponsesOutputTextSchema.safeParse(contentItem);

      if (!outputTextResult.success) {
        throw new GenerationInvalidResponseError();
      }

      textParts.push(outputTextResult.data.text);
    }
  }

  return textParts.join("");
}

type UsageExtraction = {
  usage?: LlmProviderUsage;
  usageStatus: LlmUsageStatus;
};

function extractUsage(apiProtocol: LlmApiProtocol, responseBody: unknown): UsageExtraction {
  const responseResult = usageEnvelopeSchema.safeParse(responseBody);
  if (!responseResult.success || responseResult.data.usage === undefined) {
    return { usageStatus: "missing" };
  }

  if (apiProtocol === "responses") {
    const usageResult = responsesUsageSchema.safeParse(responseResult.data.usage);
    return usageResult.success
      ? {
          usage: {
            inputTokens: usageResult.data.input_tokens,
            outputTokens: usageResult.data.output_tokens,
            totalTokens: usageResult.data.total_tokens,
          },
          usageStatus: "available",
        }
      : { usageStatus: "invalid" };
  }

  const usageResult = chatCompletionsUsageSchema.safeParse(responseResult.data.usage);
  return usageResult.success
    ? {
        usage: {
          inputTokens: usageResult.data.prompt_tokens,
          outputTokens: usageResult.data.completion_tokens,
          totalTokens: usageResult.data.total_tokens,
        },
        usageStatus: "available",
      }
    : { usageStatus: "invalid" };
}

function createFailureStatus(productionError: Error): LlmGenerationFailureStatus {
  if (productionError instanceof GenerationTimeoutError) {
    return "timeout";
  }
  if (productionError instanceof GenerationNetworkError) {
    return "network_error";
  }
  if (productionError instanceof GenerationInvalidResponseError) {
    return "invalid_response";
  }
  return "provider_unavailable";
}

function classifyHttpFailure(statusCode: number): "request" | "provider" {
  return statusCode === 400 || statusCode === 404 || statusCode === 422 ? "request" : "provider";
}

function createGenerationFailure(
  failureKind: "request" | "provider",
  productionError: Error,
  metadata: { statusCode?: number } & Partial<UsageExtraction> = {},
): InternalGenerationFailure {
  return {
    status: "failure",
    failureKind,
    error: failureKind === "request" ? "request failed" : "provider unavailable",
    failureStatus: createFailureStatus(productionError),
    productionError,
    ...(metadata.statusCode === undefined ? {} : { statusCode: metadata.statusCode }),
    ...(metadata.usage === undefined ? {} : { usage: metadata.usage }),
    usageStatus: metadata.usageStatus ?? "missing",
  };
}

function withProviderDuration(
  generation: UnannotatedGeneration,
  providerDurationMs: number,
): TimedGeneration {
  return { ...generation, providerDurationMs };
}

function extractResponseText(apiProtocol: LlmApiProtocol, responseBody: unknown): string {
  if (apiProtocol === "responses") {
    return extractResponsesText(responseBody);
  }

  const apiResult = openAiChatCompletionResponseSchema.safeParse(responseBody);

  if (!apiResult.success) {
    throw new GenerationInvalidResponseError();
  }

  const firstChoice = apiResult.data.choices[0];

  if (firstChoice === undefined) {
    throw new GenerationInvalidResponseError();
  }

  return firstChoice.message.content;
}

export class OpenAiCompatibleGateway implements LlmGateway {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly provider: string;
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
    this.provider = config.provider;
    this.authScheme = config.authScheme;
    this.apiProtocol = config.apiProtocol;
    this.extraHeaders = config.extraHeaders ?? {};
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.chatCompletionsOutputTokenParameter = config.chatCompletionsOutputTokenParameter;
  }

  async generateRequest(
    input: GenerateRequestInput,
    _requestId?: string,
  ): Promise<GenerateRequestOutcome> {
    const generation = await this.executeGeneration(input);
    if (generation.status === "failure") {
      throw generation.productionError;
    }

    return generation.outcome;
  }

  async generateRequestWithMetadata(
    input: GenerateRequestInput,
    _requestId?: string,
  ): Promise<OpenAiCompatibleGeneration> {
    const generation = await this.executeGeneration(input);
    if (generation.status === "success") {
      const {
        usageStatus: _usageStatus,
        providerDurationMs: _providerDurationMs,
        draft: _draft,
        selectedNormativeModule: _selectedNormativeModule,
        ...success
      } = generation;
      return success;
    }

    const {
      productionError: _productionError,
      usageStatus: _usageStatus,
      providerDurationMs: _providerDurationMs,
      ...failure
    } = generation;
    return failure;
  }

  async generateRequestForEvaluation(
    input: GenerateRequestInput,
  ): Promise<OpenAiCompatibleEvaluationGeneration> {
    const generation = await this.executeGeneration(input);
    if (generation.status === "failure") {
      const {
        productionError: _productionError,
        usageStatus: _usageStatus,
        providerDurationMs: _providerDurationMs,
        ...failure
      } = generation;
      return failure;
    }

    const {
      usageStatus: _usageStatus,
      providerDurationMs: _providerDurationMs,
      draft,
      selectedNormativeModule,
      ...success
    } = generation;
    return {
      ...success,
      systemPromptHash: success.metadata.systemPromptHash,
      observation: {
        ...(draft === undefined ? {} : { draft }),
        ...(selectedNormativeModule === undefined ? {} : { selectedNormativeModule }),
      },
    };
  }

  private async executeGeneration(input: GenerateRequestInput): Promise<InternalGeneration> {
    const systemPrompt = createRequestDraftSystemPrompt(input.confirmedProblemSubject);
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
      systemPrompt,
    );

    const generation = await this.executeProviderGeneration(input, requestBody);
    const metadata: LlmGenerationMetadata = {
      provider: this.provider,
      model: this.model,
      usage: generation.usage ?? null,
      usageStatus: generation.usageStatus,
      systemPromptHash: createRequestDraftSystemPromptHash(systemPrompt),
      durationMs: generation.providerDurationMs,
    };

    return { ...generation, metadata };
  }

  private async executeProviderGeneration(
    input: GenerateRequestInput,
    requestBody: OpenAiChatCompletionRequest | OpenAiResponsesRequest,
  ): Promise<TimedGeneration> {
    const startedAt = performance.now();
    const providerDurationMs = () => Math.round(performance.now() - startedAt);
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;

    try {
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
    } catch {
      if (signal.aborted) {
        return withProviderDuration(
          createGenerationFailure("provider", new GenerationTimeoutError()),
          providerDurationMs(),
        );
      }
      return withProviderDuration(
        createGenerationFailure("provider", new GenerationNetworkError()),
        providerDurationMs(),
      );
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      if (signal.aborted) {
        return withProviderDuration(
          createGenerationFailure("provider", new GenerationTimeoutError(), {
            statusCode: response.status,
          }),
          providerDurationMs(),
        );
      }

      const failureKind = response.ok ? "request" : classifyHttpFailure(response.status);
      const productionError = response.ok
        ? new GenerationInvalidResponseError()
        : new GenerationProviderUnavailableError();
      return withProviderDuration(
        createGenerationFailure(failureKind, productionError, {
          statusCode: response.status,
        }),
        providerDurationMs(),
      );
    }

    const completedProviderDurationMs = providerDurationMs();
    const usage = extractUsage(this.apiProtocol, data);

    if (!response.ok) {
      return withProviderDuration(
        createGenerationFailure(
          classifyHttpFailure(response.status),
          new GenerationProviderUnavailableError(),
          {
            statusCode: response.status,
            ...usage,
          },
        ),
        completedProviderDurationMs,
      );
    }

    let content: string;

    try {
      content = extractResponseText(this.apiProtocol, data);
    } catch (error) {
      return withProviderDuration(
        createGenerationFailure(
          "request",
          error instanceof GenerationInvalidResponseError
            ? error
            : new GenerationInvalidResponseError(),
          usage,
        ),
        completedProviderDurationMs,
      );
    }

    if (!content || content.trim().length === 0) {
      return withProviderDuration(
        createGenerationFailure(
          "request",
          new GenerationInvalidResponseError("LLM API вернул пустой ответ"),
          usage,
        ),
        completedProviderDurationMs,
      );
    }

    try {
      const draft = parseRequestDraft(content);

      if (draft.outcome === "multiple_issues") {
        return withProviderDuration(
          {
            status: "success",
            outcome: { status: "multiple_issues" },
            ...usage,
          },
          completedProviderDurationMs,
        );
      }

      const { outcome: _outcome, ...primaryRequestDraft } = draft;
      const selectedNormativeModule = selectSpecificLegalBasisModule(
        primaryRequestDraft.subject,
        input,
      );

      return withProviderDuration(
        {
          status: "success",
          outcome: {
            status: "generated",
            result: renderPrimaryRequestDraft(primaryRequestDraft, input),
          },
          draft: primaryRequestDraft,
          selectedNormativeModule: selectedNormativeModule?.id ?? null,
          ...usage,
        },
        completedProviderDurationMs,
      );
    } catch (error) {
      return withProviderDuration(
        createGenerationFailure(
          "request",
          error instanceof GenerationInvalidResponseError
            ? error
            : new GenerationInvalidResponseError(),
          usage,
        ),
        completedProviderDurationMs,
      );
    }
  }
}
