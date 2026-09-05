import {
  evaluateSpecificLegalBasisSelection,
  type GenerateRequestInput,
  type GenerateRequestOutcome,
  type LlmGateway,
  type LlmGenerationFailureStatus,
  type LlmGenerationMetadata,
  type LlmUsage,
  type LlmUsageStatus,
  materializePrimaryRequestDraft,
  type PrimaryRequestDraft,
  renderPrimaryRequestDraft,
  type SpecificLegalBasisSelectionStatus,
} from "@uo-request-generator/core";
import { z } from "zod";
import {
  type EvaluationDiagnosticStageResult,
  type EvaluationDiagnosticTrace,
  type EvaluationDiagnosticUsage,
  type ProviderErrorCodeDiagnostic,
  parseRequestDraftForEvaluation,
} from "./evaluation-diagnostics.js";
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
  REQUEST_DRAFT_RESPONSE_FORMAT_NAME,
  type RequestDraft,
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

const RESPONSES_STATUSES = [
  "completed",
  "failed",
  "in_progress",
  "cancelled",
  "queued",
  "incomplete",
] as const;

const RESPONSES_ERROR_CODES = [
  "server_error",
  "rate_limit_exceeded",
  "invalid_prompt",
  "vector_store_timeout",
  "invalid_image",
  "invalid_image_format",
  "invalid_base64_image",
  "invalid_image_url",
  "image_too_large",
  "image_too_small",
  "image_parse_error",
  "image_content_policy_violation",
  "invalid_image_mode",
  "image_file_too_large",
  "unsupported_image_media_type",
  "empty_image_file",
  "failed_to_download_image",
  "image_file_not_found",
] as const;

const RESPONSES_INCOMPLETE_REASONS = ["max_output_tokens", "content_filter"] as const;

type ResponsesStatus = (typeof RESPONSES_STATUSES)[number];

export type ResponsesFailureDiagnostic = {
  readonly status: Exclude<ResponsesStatus, "completed">;
  readonly incompleteReason?: (typeof RESPONSES_INCOMPLETE_REASONS)[number];
} & ProviderErrorCodeDiagnostic;

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
  readonly providerHttpStatus?: number;
  usage?: LlmProviderUsage;
};

export type OpenAiCompatibleGeneration =
  | OpenAiCompatibleGenerationSuccess
  | OpenAiCompatibleGenerationFailure;

type MultipleIssuesRequestDraft = Extract<RequestDraft, { outcome: "multiple_issues" }>;
type GeneratedRequestDraft = Extract<RequestDraft, { outcome: "generated" }>;

export type OpenAiCompatibleEvaluationObservation =
  | {
      draftOutcome: "generated";
      requestDraft: GeneratedRequestDraft;
      draft: PrimaryRequestDraft;
      selectedNormativeModule: string | null;
      specificLegalBasisSelectionStatus: SpecificLegalBasisSelectionStatus;
    }
  | {
      draftOutcome: "multiple_issues";
      multipleIssuesDraft: MultipleIssuesRequestDraft;
    };

export type OpenAiCompatibleEvaluationGeneration =
  | (OpenAiCompatibleGenerationSuccess & {
      observation: OpenAiCompatibleEvaluationObservation;
      systemPromptHash: string;
      diagnosticTrace: EvaluationDiagnosticTrace;
    })
  | (Omit<OpenAiCompatibleGenerationFailure, "metadata"> & {
      systemPromptHash: string;
      usageStatus: LlmUsageStatus;
      responsesFailure?: ResponsesFailureDiagnostic;
      diagnosticTrace: EvaluationDiagnosticTrace;
    });

type UnannotatedGenerationSuccess = Omit<OpenAiCompatibleGenerationSuccess, "metadata"> & {
  observation: OpenAiCompatibleEvaluationObservation;
  usageStatus: LlmUsageStatus;
  diagnosticStages: readonly EvaluationDiagnosticStageResult[];
};

type UnannotatedGenerationFailure = Omit<OpenAiCompatibleGenerationFailure, "metadata"> & {
  usageStatus: LlmUsageStatus;
  diagnosticStages: readonly EvaluationDiagnosticStageResult[];
};

type InternalGenerationFailure = UnannotatedGenerationFailure & {
  productionError: Error;
  responsesFailure?: ResponsesFailureDiagnostic;
};

type UnannotatedGeneration = UnannotatedGenerationSuccess | InternalGenerationFailure;
type TimedGeneration =
  | (UnannotatedGenerationSuccess & { providerDurationMs: number })
  | (InternalGenerationFailure & { providerDurationMs: number });
type InternalGeneration =
  | (OpenAiCompatibleGenerationSuccess & {
      observation: OpenAiCompatibleEvaluationObservation;
      usageStatus: LlmUsageStatus;
      providerDurationMs: number;
      diagnosticStages: readonly EvaluationDiagnosticStageResult[];
    })
  | (OpenAiCompatibleGenerationFailure & {
      productionError: Error;
      usageStatus: LlmUsageStatus;
      providerDurationMs: number;
      responsesFailure?: ResponsesFailureDiagnostic;
      diagnosticStages: readonly EvaluationDiagnosticStageResult[];
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
  choices: z.array(z.unknown()).min(1),
});

const openAiChatCompletionChoiceSchema = z.object({
  message: z.unknown(),
});

const openAiChatCompletionMessageSchema = z.object({
  content: z.string(),
});

const responsesStatusSchema = z.enum(RESPONSES_STATUSES);
const responsesErrorCodeSchema = z.enum(RESPONSES_ERROR_CODES);
const responsesIncompleteReasonSchema = z.enum(RESPONSES_INCOMPLETE_REASONS);

const openAiResponsesResponseSchema = z
  .object({
    output_text: z.string().nullable().optional(),
    output: z.array(z.unknown()).optional(),
  })
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
  const normalizedInput = normalizeGenerationInput(input);
  const userMessage = createUserMessage(normalizedInput);
  const jsonSchema = createRequestDraftJsonSchema(normalizedInput.confirmedProblemSubject);

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

function normalizeGenerationInput(input: GenerateRequestInput): GenerateRequestInput {
  const location = input.location?.trim();
  const consequences = input.consequences?.trim();
  const desiredActions = input.desiredActions?.trim();

  return {
    description: input.description,
    ...(location ? { location } : {}),
    ...(consequences ? { consequences } : {}),
    ...(desiredActions ? { desiredActions } : {}),
    ...(input.confirmedProblemSubject === undefined
      ? {}
      : { confirmedProblemSubject: input.confirmedProblemSubject }),
  };
}

function createUserMessage(input: GenerateRequestInput): string {
  const normalizedInput = normalizeGenerationInput(input);

  return JSON.stringify({
    description: normalizedInput.description,
    location: normalizedInput.location ?? null,
    consequences: normalizedInput.consequences ?? null,
    desiredActions: normalizedInput.desiredActions ?? null,
  });
}

function readOwnDataProperty<T extends object, K extends keyof T>(
  record: T,
  property: K,
): T[K] | undefined;
function readOwnDataProperty(record: object, property: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, property);
  return descriptor !== undefined && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function createResponsesFailureDiagnostic(
  response: Record<string, unknown>,
  status: Exclude<ResponsesStatus, "completed">,
): ResponsesFailureDiagnostic | undefined {
  const rawError = readOwnDataProperty(response, "error");
  const rawErrorCode = isRecord(rawError) ? readOwnDataProperty(rawError, "code") : undefined;
  const providerErrorCodeResult =
    rawErrorCode === undefined ? undefined : responsesErrorCodeSchema.safeParse(rawErrorCode);
  const rawIncompleteDetails = readOwnDataProperty(response, "incomplete_details");
  const rawIncompleteReason = isRecord(rawIncompleteDetails)
    ? readOwnDataProperty(rawIncompleteDetails, "reason")
    : undefined;
  const incompleteReasonResult = responsesIncompleteReasonSchema.safeParse(rawIncompleteReason);
  const incompleteReason = incompleteReasonResult.success ? incompleteReasonResult.data : undefined;

  if (providerErrorCodeResult === undefined) {
    return {
      status,
      providerErrorCodeStatus: "missing",
      ...(incompleteReason === undefined ? {} : { incompleteReason }),
    };
  }

  if (providerErrorCodeResult.success) {
    return {
      status,
      providerErrorCodeStatus: "known",
      providerErrorCode: providerErrorCodeResult.data,
      ...(incompleteReason === undefined ? {} : { incompleteReason }),
    };
  }

  return {
    status,
    providerErrorCodeStatus: "unknown",
    ...(incompleteReason === undefined ? {} : { incompleteReason }),
  };
}

type ResponsesStatusProbe =
  | {
      readonly status: "pass";
      readonly nestedOutputAuthorized: false;
      readonly responsesStatus: undefined;
      readonly diagnostic: undefined;
    }
  | {
      readonly status: "pass";
      readonly nestedOutputAuthorized: true;
      readonly responsesStatus: "completed";
      readonly diagnostic: undefined;
    }
  | {
      readonly status: "fail";
      readonly nestedOutputAuthorized: false;
      readonly responsesStatus: undefined;
      readonly diagnostic: ResponsesFailureDiagnostic | undefined;
    };

const STATUS_FREE_RESPONSES_PROBE = {
  status: "pass",
  nestedOutputAuthorized: false,
  responsesStatus: undefined,
  diagnostic: undefined,
} satisfies ResponsesStatusProbe;

const COMPLETED_RESPONSES_PROBE = {
  status: "pass",
  nestedOutputAuthorized: true,
  responsesStatus: "completed",
  diagnostic: undefined,
} satisfies ResponsesStatusProbe;

const FAILED_RESPONSES_PROBE = {
  status: "fail",
  nestedOutputAuthorized: false,
  responsesStatus: undefined,
  diagnostic: undefined,
} satisfies ResponsesStatusProbe;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function probeResponsesStatus(responseBody: unknown): ResponsesStatusProbe {
  if (!isRecord(responseBody)) {
    return FAILED_RESPONSES_PROBE;
  }

  const statusDescriptor = Object.getOwnPropertyDescriptor(responseBody, "status");
  if (statusDescriptor === undefined) {
    return STATUS_FREE_RESPONSES_PROBE;
  }
  if (!Object.hasOwn(statusDescriptor, "value")) {
    return FAILED_RESPONSES_PROBE;
  }

  const statusResult = responsesStatusSchema.safeParse(statusDescriptor.value);
  if (!statusResult.success) {
    return FAILED_RESPONSES_PROBE;
  }
  if (statusResult.data === "completed") {
    return COMPLETED_RESPONSES_PROBE;
  }

  return {
    status: "fail",
    nestedOutputAuthorized: false,
    responsesStatus: undefined,
    diagnostic: createResponsesFailureDiagnostic(responseBody, statusResult.data),
  };
}

function extractResponsesText(responseBody: unknown, nestedOutputAuthorized: boolean): string {
  const responseProjection: Record<string, unknown> = Object.create(null);
  if (isRecord(responseBody)) {
    responseProjection.output_text = readOwnDataProperty(responseBody, "output_text");
    responseProjection.output = readOwnDataProperty(responseBody, "output");
  }
  const responseResult = openAiResponsesResponseSchema.safeParse(responseProjection);

  if (!responseResult.success) {
    throw new GenerationInvalidResponseError();
  }

  const aggregatedText = responseResult.data.output_text;

  if (typeof aggregatedText === "string" && aggregatedText.trim().length > 0) {
    return aggregatedText;
  }

  if (!nestedOutputAuthorized && responseResult.data.output !== undefined) {
    throw new GenerationInvalidResponseError();
  }

  const textParts: string[] = [];

  for (const outputItem of responseResult.data.output ?? []) {
    const outputItemProjection: Record<string, unknown> = Object.create(null);
    if (isRecord(outputItem)) {
      outputItemProjection.type = readOwnDataProperty(outputItem, "type");
    }
    const outputItemResult = openAiResponsesOutputItemSchema.safeParse(outputItemProjection);

    if (!outputItemResult.success) {
      throw new GenerationInvalidResponseError();
    }

    if (outputItemResult.data.type !== "message") {
      continue;
    }

    const messageProjection: Record<string, unknown> = Object.create(null);
    if (isRecord(outputItem)) {
      messageProjection.type = readOwnDataProperty(outputItem, "type");
      messageProjection.content = readOwnDataProperty(outputItem, "content");
    }
    const messageResult = openAiResponsesMessageSchema.safeParse(messageProjection);

    if (!messageResult.success) {
      throw new GenerationInvalidResponseError();
    }

    for (const contentItem of messageResult.data.content) {
      const contentItemProjection: Record<string, unknown> = Object.create(null);
      if (isRecord(contentItem)) {
        contentItemProjection.type = readOwnDataProperty(contentItem, "type");
      }
      const contentItemResult = openAiResponsesContentItemSchema.safeParse(contentItemProjection);

      if (!contentItemResult.success) {
        throw new GenerationInvalidResponseError();
      }

      if (contentItemResult.data.type !== "output_text") {
        continue;
      }

      const outputTextProjection: Record<string, unknown> = Object.create(null);
      if (isRecord(contentItem)) {
        outputTextProjection.type = readOwnDataProperty(contentItem, "type");
        outputTextProjection.text = readOwnDataProperty(contentItem, "text");
      }
      const outputTextResult = openAiResponsesOutputTextSchema.safeParse(outputTextProjection);

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
  const rawUsage = isRecord(responseBody) ? readOwnDataProperty(responseBody, "usage") : undefined;
  if (rawUsage === undefined) {
    return { usageStatus: "missing" };
  }
  if (!isRecord(rawUsage)) return { usageStatus: "invalid" };

  if (apiProtocol === "responses") {
    const usageResult = responsesUsageSchema.safeParse({
      input_tokens: readOwnDataProperty(rawUsage, "input_tokens"),
      output_tokens: readOwnDataProperty(rawUsage, "output_tokens"),
      total_tokens: readOwnDataProperty(rawUsage, "total_tokens"),
    });
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

  const usageResult = chatCompletionsUsageSchema.safeParse({
    prompt_tokens: readOwnDataProperty(rawUsage, "prompt_tokens"),
    completion_tokens: readOwnDataProperty(rawUsage, "completion_tokens"),
    total_tokens: readOwnDataProperty(rawUsage, "total_tokens"),
  });
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

function classifyHttpFailure(providerHttpStatus: number): "request" | "provider" {
  return providerHttpStatus === 400 || providerHttpStatus === 404 || providerHttpStatus === 422
    ? "request"
    : "provider";
}

function createGenerationFailure(
  failureKind: "request" | "provider",
  productionError: Error,
  metadata: {
    providerHttpStatus?: number;
    responsesFailure?: ResponsesFailureDiagnostic;
    diagnosticStages?: readonly EvaluationDiagnosticStageResult[];
  } & Partial<UsageExtraction> = {},
): InternalGenerationFailure {
  const providerHttpStatus = readOwnDataProperty(metadata, "providerHttpStatus");
  const responsesFailure = readOwnDataProperty(metadata, "responsesFailure");
  const usage = readOwnDataProperty(metadata, "usage");
  const usageStatus = readOwnDataProperty(metadata, "usageStatus");
  const diagnosticStages = readOwnDataProperty(metadata, "diagnosticStages");

  return {
    status: "failure",
    failureKind,
    error: failureKind === "request" ? "request failed" : "provider unavailable",
    failureStatus: createFailureStatus(productionError),
    productionError,
    ...(providerHttpStatus === undefined ? {} : { providerHttpStatus }),
    ...(responsesFailure === undefined ? {} : { responsesFailure }),
    ...(usage === undefined ? {} : { usage }),
    usageStatus: usageStatus ?? "missing",
    diagnosticStages: diagnosticStages ?? [],
  };
}

function toDiagnosticUsage(generation: {
  usage?: LlmProviderUsage;
  usageStatus: LlmUsageStatus;
}): EvaluationDiagnosticUsage {
  if (generation.usageStatus === "missing" || generation.usageStatus === "invalid") {
    return { status: generation.usageStatus };
  }
  if (generation.usage === undefined) return { status: "invalid" };
  return { status: "available", ...generation.usage };
}

function toDiagnosticTrace(generation: {
  diagnosticStages: readonly EvaluationDiagnosticStageResult[];
  usage?: LlmProviderUsage;
  usageStatus: LlmUsageStatus;
}): EvaluationDiagnosticTrace {
  const failedStage = generation.diagnosticStages.find(({ status }) => status === "fail");
  const usage = toDiagnosticUsage(generation);
  return failedStage === undefined
    ? { status: "completed", stages: generation.diagnosticStages, usage }
    : {
        status: "failed",
        firstFailureStage: failedStage.stage,
        stages: generation.diagnosticStages,
        usage,
      };
}

function withProviderDuration(
  generation: UnannotatedGeneration,
  providerDurationMs: number,
): TimedGeneration {
  return { ...generation, providerDurationMs };
}

function extractResponseText(
  apiProtocol: LlmApiProtocol,
  responseBody: unknown,
  nestedResponsesOutputAuthorized: boolean,
): string {
  if (apiProtocol === "responses") {
    return extractResponsesText(responseBody, nestedResponsesOutputAuthorized);
  }

  const responseProjection: Record<string, unknown> = Object.create(null);
  if (isRecord(responseBody)) {
    responseProjection.choices = readOwnDataProperty(responseBody, "choices");
  }
  const apiResult = openAiChatCompletionResponseSchema.safeParse(responseProjection);

  if (!apiResult.success) {
    throw new GenerationInvalidResponseError();
  }

  const rawFirstChoice = apiResult.data.choices[0];

  if (rawFirstChoice === undefined) {
    throw new GenerationInvalidResponseError();
  }

  const choiceProjection: Record<string, unknown> = Object.create(null);
  if (isRecord(rawFirstChoice)) {
    choiceProjection.message = readOwnDataProperty(rawFirstChoice, "message");
  }
  const choiceResult = openAiChatCompletionChoiceSchema.safeParse(choiceProjection);
  if (!choiceResult.success) {
    throw new GenerationInvalidResponseError();
  }

  const messageProjection: Record<string, unknown> = Object.create(null);
  if (isRecord(choiceResult.data.message)) {
    messageProjection.content = readOwnDataProperty(choiceResult.data.message, "content");
  }
  const messageResult = openAiChatCompletionMessageSchema.safeParse(messageProjection);
  if (!messageResult.success) {
    throw new GenerationInvalidResponseError();
  }

  return messageResult.data.content;
}

function isProviderEnvelopeValid(apiProtocol: LlmApiProtocol, responseBody: unknown): boolean {
  if (!isRecord(responseBody)) return false;
  if (apiProtocol === "responses") return true;
  return Array.isArray(readOwnDataProperty(responseBody, "choices"));
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
        observation: _observation,
        diagnosticStages: _diagnosticStages,
        ...success
      } = generation;
      return success;
    }

    const {
      productionError: _productionError,
      usageStatus: _usageStatus,
      providerDurationMs: _providerDurationMs,
      responsesFailure: _responsesFailure,
      diagnosticStages: _diagnosticStages,
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
        providerDurationMs: _providerDurationMs,
        diagnosticStages: _diagnosticStages,
        metadata,
        ...failure
      } = generation;
      return {
        ...failure,
        systemPromptHash: metadata.systemPromptHash,
        diagnosticTrace: toDiagnosticTrace(generation),
      };
    }

    const {
      usageStatus: _usageStatus,
      providerDurationMs: _providerDurationMs,
      diagnosticStages: _diagnosticStages,
      observation,
      ...success
    } = generation;
    return {
      ...success,
      systemPromptHash: success.metadata.systemPromptHash,
      observation,
      diagnosticTrace: toDiagnosticTrace(generation),
    };
  }

  private async executeGeneration(input: GenerateRequestInput): Promise<InternalGeneration> {
    const normalizedInput = normalizeGenerationInput(input);
    const systemPrompt = createRequestDraftSystemPrompt(normalizedInput.confirmedProblemSubject);
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
      normalizedInput,
      systemPrompt,
    );

    const generation = await this.executeProviderGeneration(normalizedInput, requestBody);
    const metadata: LlmGenerationMetadata = {
      provider: this.provider,
      model: this.model,
      usage: readOwnDataProperty(generation, "usage") ?? null,
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
          createGenerationFailure("provider", new GenerationTimeoutError(), {
            diagnosticStages: [{ stage: "network", status: "fail", reason: "timeout" }],
          }),
          providerDurationMs(),
        );
      }
      return withProviderDuration(
        createGenerationFailure("provider", new GenerationNetworkError(), {
          diagnosticStages: [{ stage: "network", status: "fail", reason: "network_error" }],
        }),
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
            diagnosticStages: [{ stage: "network", status: "fail", reason: "timeout" }],
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
          ...(response.ok ? {} : { providerHttpStatus: response.status }),
          diagnosticStages: response.ok
            ? [
                { stage: "network", status: "pass" },
                { stage: "http", status: "pass" },
                {
                  stage: "provider_envelope",
                  status: "fail",
                  protocol: this.apiProtocol,
                },
              ]
            : [
                { stage: "network", status: "pass" },
                { stage: "http", status: "fail", httpStatus: response.status },
              ],
        }),
        providerDurationMs(),
      );
    }

    const completedProviderDurationMs = providerDurationMs();
    const responsesStatusProbe: ResponsesStatusProbe =
      this.apiProtocol === "responses" ? probeResponsesStatus(data) : STATUS_FREE_RESPONSES_PROBE;
    const usage = extractUsage(this.apiProtocol, data);

    if (!response.ok) {
      return withProviderDuration(
        createGenerationFailure(
          classifyHttpFailure(response.status),
          new GenerationProviderUnavailableError(),
          {
            providerHttpStatus: response.status,
            ...usage,
            diagnosticStages: [
              { stage: "network", status: "pass" },
              { stage: "http", status: "fail", httpStatus: response.status },
            ],
          },
        ),
        completedProviderDurationMs,
      );
    }

    const providerStages: EvaluationDiagnosticStageResult[] = [
      { stage: "network", status: "pass" },
      { stage: "http", status: "pass" },
    ];
    if (!isProviderEnvelopeValid(this.apiProtocol, data)) {
      return withProviderDuration(
        createGenerationFailure("request", new GenerationInvalidResponseError(), {
          ...usage,
          diagnosticStages: [
            ...providerStages,
            {
              stage: "provider_envelope",
              status: "fail",
              protocol: this.apiProtocol,
            },
          ],
        }),
        completedProviderDurationMs,
      );
    }
    providerStages.push({
      stage: "provider_envelope",
      status: "pass",
      protocol: this.apiProtocol,
    });
    if (responsesStatusProbe.status === "fail") {
      const diagnostic = responsesStatusProbe.diagnostic;
      const incompleteReason =
        diagnostic === undefined ? undefined : readOwnDataProperty(diagnostic, "incompleteReason");
      return withProviderDuration(
        createGenerationFailure("request", new GenerationInvalidResponseError(), {
          ...usage,
          ...(diagnostic === undefined ? {} : { responsesFailure: diagnostic }),
          diagnosticStages: [
            ...providerStages,
            {
              stage: "provider_status",
              status: "fail",
              ...(diagnostic === undefined
                ? {}
                : diagnostic.providerErrorCodeStatus === "known"
                  ? {
                      responsesStatus: diagnostic.status,
                      providerErrorCodeStatus: diagnostic.providerErrorCodeStatus,
                      providerErrorCode: diagnostic.providerErrorCode,
                      ...(incompleteReason === undefined ? {} : { incompleteReason }),
                    }
                  : {
                      responsesStatus: diagnostic.status,
                      providerErrorCodeStatus: diagnostic.providerErrorCodeStatus,
                      ...(incompleteReason === undefined ? {} : { incompleteReason }),
                    }),
            },
          ],
        }),
        completedProviderDurationMs,
      );
    }

    let content: string;

    try {
      content = extractResponseText(
        this.apiProtocol,
        data,
        responsesStatusProbe.nestedOutputAuthorized,
      );
    } catch (error) {
      return withProviderDuration(
        createGenerationFailure(
          "request",
          error instanceof GenerationInvalidResponseError
            ? error
            : new GenerationInvalidResponseError(),
          {
            ...usage,
            diagnosticStages: [
              ...providerStages,
              {
                stage: "provider_status",
                status: "pass",
                ...(responsesStatusProbe.responsesStatus === undefined
                  ? {}
                  : { responsesStatus: responsesStatusProbe.responsesStatus }),
              },
              { stage: "output_extraction", status: "fail", output: "missing" },
            ],
          },
        ),
        completedProviderDurationMs,
      );
    }

    providerStages.push(
      {
        stage: "provider_status",
        status: "pass",
        ...(responsesStatusProbe.responsesStatus === undefined
          ? {}
          : { responsesStatus: responsesStatusProbe.responsesStatus }),
      },
      { stage: "output_extraction", status: "pass", output: "present" },
    );

    if (!content || content.trim().length === 0) {
      return withProviderDuration(
        createGenerationFailure(
          "request",
          new GenerationInvalidResponseError("LLM API вернул пустой ответ"),
          {
            ...usage,
            diagnosticStages: [
              ...providerStages.slice(0, -1),
              { stage: "output_extraction", status: "fail", output: "missing" },
            ],
          },
        ),
        completedProviderDurationMs,
      );
    }

    const parsing = parseRequestDraftForEvaluation(content);
    const parsingStages = [...providerStages, ...parsing.stages];
    if (parsing.status === "failure") {
      return withProviderDuration(
        createGenerationFailure("request", new GenerationInvalidResponseError(), {
          ...usage,
          diagnosticStages: parsingStages,
        }),
        completedProviderDurationMs,
      );
    }

    const draft = parsing.draft;
    if (draft.outcome === "multiple_issues") {
      return withProviderDuration(
        {
          status: "success",
          outcome: { status: "multiple_issues" },
          observation: {
            draftOutcome: "multiple_issues",
            multipleIssuesDraft: draft,
          },
          diagnosticStages: parsingStages,
          ...usage,
        },
        completedProviderDurationMs,
      );
    }

    let primaryRequestDraft: PrimaryRequestDraft;
    try {
      primaryRequestDraft = materializePrimaryRequestDraft(input, draft);
    } catch {
      return withProviderDuration(
        createGenerationFailure("request", new GenerationInvalidResponseError(), {
          ...usage,
          diagnosticStages: [...parsingStages, { stage: "materialization", status: "fail" }],
        }),
        completedProviderDurationMs,
      );
    }

    const materializedStages: EvaluationDiagnosticStageResult[] = [
      ...parsingStages,
      { stage: "materialization", status: "pass" },
    ];
    let specificLegalBasisSelection: ReturnType<typeof evaluateSpecificLegalBasisSelection>;
    try {
      specificLegalBasisSelection = evaluateSpecificLegalBasisSelection(
        primaryRequestDraft.subject,
        input,
      );
    } catch {
      return withProviderDuration(
        createGenerationFailure("request", new GenerationInvalidResponseError(), {
          ...usage,
          diagnosticStages: [
            ...materializedStages,
            { stage: "subject_legal_selection", status: "fail" },
          ],
        }),
        completedProviderDurationMs,
      );
    }
    const selectedNormativeModule =
      specificLegalBasisSelection.status === "applied"
        ? specificLegalBasisSelection.module
        : undefined;
    const selectionStages: EvaluationDiagnosticStageResult[] = [
      ...materializedStages,
      { stage: "subject_legal_selection", status: "pass" },
    ];
    let renderedRequest: ReturnType<typeof renderPrimaryRequestDraft>;
    try {
      renderedRequest = renderPrimaryRequestDraft(primaryRequestDraft, input);
    } catch {
      return withProviderDuration(
        createGenerationFailure("request", new GenerationInvalidResponseError(), {
          ...usage,
          diagnosticStages: [...selectionStages, { stage: "renderer", status: "fail" }],
        }),
        completedProviderDurationMs,
      );
    }

    return withProviderDuration(
      {
        status: "success",
        outcome: { status: "generated", result: renderedRequest },
        observation: {
          draftOutcome: "generated",
          requestDraft: draft,
          draft: primaryRequestDraft,
          selectedNormativeModule: selectedNormativeModule?.id ?? null,
          specificLegalBasisSelectionStatus: specificLegalBasisSelection.status,
        },
        diagnosticStages: [...selectionStages, { stage: "renderer", status: "pass" }],
        ...usage,
      },
      completedProviderDurationMs,
    );
  }
}
