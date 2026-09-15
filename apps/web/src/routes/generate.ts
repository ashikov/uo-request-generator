import { randomUUID } from "node:crypto";
import type {
  LlmGateway,
  LlmGatewayGeneration,
  LlmGenerationFailureStatus,
  LlmGenerationMetadata,
} from "@uo-request-generator/core";
import {
  DisabledLlmGateway,
  GenerationInvalidResponseError,
  GenerationNetworkError,
  GenerationProviderUnavailableError,
  GenerationTimeoutError,
  type LlmConfigurationClass,
} from "@uo-request-generator/llm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ConsentLedger } from "../consent-ledger.js";
import { prepareGenerationClientId } from "../generation-client-id.js";
import {
  generateConsentSchema,
  generateHttpRequestSchema,
  generateRequestBodyLimitBytes,
} from "../generation-http-contract.js";
import type {
  GenerationEventWriter,
  GenerationFailedEvent,
  GenerationRejectedEvent,
  LoggedLlmGenerationMetadata,
} from "../generation-log.js";
import type { GenerationRateLimiter } from "../generation-rate-limiter.js";
import type { GenerationSafeguard } from "../generation-safeguard.js";
import type { SmartCaptchaConfig } from "../smartcaptcha-config.js";
import type { SmartCaptchaVerifier } from "../smartcaptcha-verifier.js";

type ApiErrorCode =
  | "captcha_failed"
  | "captcha_unavailable"
  | "generation_unavailable"
  | "generation_provider_unavailable"
  | "internal_error"
  | "multiple_issues"
  | "rate_limit_exceeded"
  | "request_too_large"
  | "validation_error";

type ApiError = {
  code: ApiErrorCode;
  message: string;
  statusCode: 400 | 413 | 429 | 500 | 503;
};

type GenerationRequestContext = {
  consentReceiptId?: string;
  requestId: string;
  startedAt: number;
  terminalEventAttempted: boolean;
};

type GenerationTerminalStatus =
  | {
      event: "generation_rejected";
      status: GenerationRejectedEvent["status"];
    }
  | {
      event: "generation_failed";
      status: GenerationFailedEvent["status"];
      providerHttpStatus?: number;
    };

declare module "fastify" {
  interface FastifyRequest {
    generationContext: GenerationRequestContext | null;
  }
}

const validationApiError: ApiError = {
  code: "validation_error",
  message: "Проверьте формат и содержание запроса",
  statusCode: 400,
};

const requestTooLargeApiError: ApiError = {
  code: "request_too_large",
  message: "Размер запроса превышает допустимый предел",
  statusCode: 413,
};

const providerUnavailableApiError: ApiError = {
  code: "generation_provider_unavailable",
  message: "Генерация пока не подключена",
  statusCode: 503,
};

const configuredProviderUnavailableApiError: ApiError = {
  code: "generation_provider_unavailable",
  message: "Генерация временно недоступна. Попробуйте позже",
  statusCode: 503,
};

const generationUnavailableApiError: ApiError = {
  code: "generation_unavailable",
  message: "Генерация временно недоступна. Попробуйте позже",
  statusCode: 503,
};

const rateLimitApiError: ApiError = {
  code: "rate_limit_exceeded",
  message: "Слишком много запросов. Попробуйте позже",
  statusCode: 429,
};

const captchaFailedApiError: ApiError = {
  code: "captcha_failed",
  message: "Не удалось выполнить проверку. Попробуйте ещё раз",
  statusCode: 400,
};

const captchaUnavailableApiError: ApiError = {
  code: "captcha_unavailable",
  message: "Проверка временно недоступна. Попробуйте позже",
  statusCode: 503,
};

const internalApiError: ApiError = {
  code: "internal_error",
  message: "Не удалось составить заявку",
  statusCode: 500,
};

const multipleIssuesApiError: ApiError = {
  code: "multiple_issues",
  message: "Опишите одну проблему. Для каждой отдельной проблемы составьте отдельную заявку.",
  statusCode: 400,
};

function ensureGenerationContext(
  request: FastifyRequest,
  reply: FastifyReply,
  writeGenerationEvent: GenerationEventWriter,
): GenerationRequestContext {
  if (request.generationContext !== null) {
    return request.generationContext;
  }

  const context: GenerationRequestContext = {
    requestId: randomUUID(),
    startedAt: performance.now(),
    terminalEventAttempted: false,
  };
  request.generationContext = context;
  reply.header("x-request-id", context.requestId);
  writeGenerationEvent({
    event: "generation_started",
    requestId: context.requestId,
    timestamp: new Date().toISOString(),
  });
  return context;
}

const providerLogAliases = {
  "builtin-yandex": "yandex-builtin",
  "custom-openai-compatible": "openai-compatible-custom",
} as const satisfies Record<LlmConfigurationClass, LoggedLlmGenerationMetadata["provider"]>;

function selectLlmGenerationMetadata(metadata: LlmGenerationMetadata): LoggedLlmGenerationMetadata {
  return {
    provider:
      typeof metadata.configurationClass === "string" &&
      Object.hasOwn(providerLogAliases, metadata.configurationClass)
        ? providerLogAliases[metadata.configurationClass as LlmConfigurationClass]
        : "unclassified",
    model: "configured-model",
    usage:
      metadata.usage === null
        ? null
        : {
            inputTokens: metadata.usage.inputTokens,
            outputTokens: metadata.usage.outputTokens,
            totalTokens: metadata.usage.totalTokens,
          },
    usageStatus: metadata.usageStatus,
    systemPromptHash: metadata.systemPromptHash,
    durationMs: metadata.durationMs,
  };
}

function writeTerminalEvent(
  context: GenerationRequestContext,
  terminalStatus: GenerationTerminalStatus,
  httpStatus: 400 | 413 | 429 | 500 | 503,
  writeGenerationEvent: GenerationEventWriter,
  llmMetadata?: LlmGenerationMetadata,
): void {
  if (context.terminalEventAttempted) {
    return;
  }

  context.terminalEventAttempted = true;
  const eventDetails = {
    requestId: context.requestId,
    timestamp: new Date().toISOString(),
    durationMs: Math.round(performance.now() - context.startedAt),
    ...(llmMetadata === undefined ? {} : { llm: selectLlmGenerationMetadata(llmMetadata) }),
  };

  if (terminalStatus.event === "generation_rejected") {
    writeGenerationEvent({ ...terminalStatus, ...eventDetails, httpStatus });
    return;
  }

  if (httpStatus === 413) {
    throw new Error("generation_failed cannot use HTTP 413");
  }

  writeGenerationEvent({
    event: "generation_failed",
    status: terminalStatus.status,
    ...eventDetails,
    httpStatus,
    ...(terminalStatus.providerHttpStatus === undefined
      ? {}
      : { providerHttpStatus: terminalStatus.providerHttpStatus }),
  });
}

function writeSuccessEvent(
  context: GenerationRequestContext,
  writeGenerationEvent: GenerationEventWriter,
  llmMetadata?: LlmGenerationMetadata,
): void {
  if (context.terminalEventAttempted) {
    return;
  }

  context.terminalEventAttempted = true;
  writeGenerationEvent({
    event: "generation_succeeded",
    requestId: context.requestId,
    timestamp: new Date().toISOString(),
    status: "generated",
    durationMs: Math.round(performance.now() - context.startedAt),
    httpStatus: 200,
    ...(llmMetadata === undefined ? {} : { llm: selectLlmGenerationMetadata(llmMetadata) }),
  });
}

function sendApiError(
  reply: FastifyReply,
  apiError: ApiError,
  context: GenerationRequestContext,
): FastifyReply {
  return reply.code(apiError.statusCode).send({
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId: context.requestId,
    },
  });
}

function sendApiErrorWithEvent(
  reply: FastifyReply,
  apiError: ApiError,
  context: GenerationRequestContext,
  terminalStatus: GenerationTerminalStatus,
  writeGenerationEvent: GenerationEventWriter,
  llmMetadata?: LlmGenerationMetadata,
): FastifyReply {
  writeTerminalEvent(
    context,
    terminalStatus,
    apiError.statusCode,
    writeGenerationEvent,
    llmMetadata,
  );
  return sendApiError(reply, apiError, context);
}

function sendMetadataGatewayFailure(
  failureStatus: LlmGenerationFailureStatus,
  reply: FastifyReply,
  context: GenerationRequestContext,
  writeGenerationEvent: GenerationEventWriter,
  llmMetadata: LlmGenerationMetadata,
  providerHttpStatus: unknown,
): FastifyReply {
  const validProviderHttpStatus =
    failureStatus === "provider_unavailable" &&
    typeof providerHttpStatus === "number" &&
    Number.isInteger(providerHttpStatus) &&
    providerHttpStatus >= 100 &&
    providerHttpStatus <= 599 &&
    (providerHttpStatus < 200 || providerHttpStatus > 299)
      ? providerHttpStatus
      : undefined;
  return sendApiErrorWithEvent(
    reply,
    configuredProviderUnavailableApiError,
    context,
    validProviderHttpStatus === undefined
      ? { event: "generation_failed", status: failureStatus }
      : {
          event: "generation_failed",
          status: failureStatus,
          providerHttpStatus: validProviderHttpStatus,
        },
    writeGenerationEvent,
    llmMetadata,
  );
}

async function generateRequest(
  llmGateway: LlmGateway,
  input: Parameters<LlmGateway["generateRequest"]>[0],
  requestId: string,
): Promise<
  | { status: "success"; generation: Exclude<LlmGatewayGeneration, { status: "failure" }> }
  | { status: "legacy"; outcome: Awaited<ReturnType<LlmGateway["generateRequest"]>> }
  | { status: "failure"; generation: Extract<LlmGatewayGeneration, { status: "failure" }> }
> {
  if (llmGateway.generateRequestWithMetadata === undefined) {
    return { status: "legacy", outcome: await llmGateway.generateRequest(input, requestId) };
  }

  const generation = await llmGateway.generateRequestWithMetadata(input, requestId);
  if (generation.status === "failure") {
    return { status: "failure", generation };
  }
  return { status: "success", generation };
}

function sendGenerationFailure(
  error: unknown,
  llmGateway: LlmGateway,
  reply: FastifyReply,
  context: GenerationRequestContext,
  writeGenerationEvent: GenerationEventWriter,
): FastifyReply {
  if (error instanceof GenerationTimeoutError) {
    return sendApiErrorWithEvent(
      reply,
      configuredProviderUnavailableApiError,
      context,
      { event: "generation_failed", status: "timeout" },
      writeGenerationEvent,
    );
  }

  if (error instanceof GenerationNetworkError) {
    return sendApiErrorWithEvent(
      reply,
      configuredProviderUnavailableApiError,
      context,
      { event: "generation_failed", status: "network_error" },
      writeGenerationEvent,
    );
  }

  if (error instanceof GenerationInvalidResponseError) {
    return sendApiErrorWithEvent(
      reply,
      configuredProviderUnavailableApiError,
      context,
      { event: "generation_failed", status: "invalid_response" },
      writeGenerationEvent,
    );
  }

  if (error instanceof GenerationProviderUnavailableError) {
    return sendApiErrorWithEvent(
      reply,
      llmGateway instanceof DisabledLlmGateway
        ? providerUnavailableApiError
        : configuredProviderUnavailableApiError,
      context,
      { event: "generation_failed", status: "provider_unavailable" },
      writeGenerationEvent,
    );
  }

  return sendApiErrorWithEvent(
    reply,
    internalApiError,
    context,
    { event: "generation_failed", status: "internal_error" },
    writeGenerationEvent,
  );
}

type RegisterGenerateRouteOptions = {
  consentLedger: Pick<ConsentLedger, "accept"> | undefined;
  llmGateway: LlmGateway;
  generationRateLimiter: GenerationRateLimiter;
  generationNow: () => number;
  generationSafeguard: GenerationSafeguard;
  generateClientId: () => string;
  smartCaptchaConfig: SmartCaptchaConfig;
  smartCaptchaVerifier?: Pick<SmartCaptchaVerifier, "verify">;
  writeGenerationEvent: GenerationEventWriter;
};

export function registerGenerateRoute(
  app: FastifyInstance,
  options: RegisterGenerateRouteOptions,
): void {
  const pendingClientCookieSetters = new WeakMap<FastifyReply, () => void>();

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.generationContext?.consentReceiptId !== undefined) {
      reply.header("x-consent-receipt-id", request.generationContext.consentReceiptId);
    }
    const setClientCookie = pendingClientCookieSetters.get(reply);
    if (setClientCookie !== undefined) {
      pendingClientCookieSetters.delete(reply);
      setClientCookie();
    }

    return payload;
  });

  app.decorateRequest("generationContext", null);
  app.post(
    "/api/generate",
    {
      bodyLimit: generateRequestBodyLimitBytes,
      async onRequest(request, reply) {
        const context = ensureGenerationContext(request, reply, options.writeGenerationEvent);
        // Сохраняем существующую диагностику прямого запроса без обработки его body.
        if (!options.generationSafeguard.isGenerationEnabled()) {
          return sendApiErrorWithEvent(
            reply,
            generationUnavailableApiError,
            context,
            { event: "generation_rejected", status: "generation_unavailable" },
            options.writeGenerationEvent,
          );
        }
      },
      errorHandler(error, request, reply) {
        const context = ensureGenerationContext(request, reply, options.writeGenerationEvent);

        if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
          return sendApiErrorWithEvent(
            reply,
            requestTooLargeApiError,
            context,
            { event: "generation_rejected", status: "request_too_large" },
            options.writeGenerationEvent,
          );
        }

        // Fastify отклоняет некорректный JSON до вызова основного обработчика.
        if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
          return sendApiErrorWithEvent(
            reply,
            validationApiError,
            context,
            { event: "generation_rejected", status: "validation_error" },
            options.writeGenerationEvent,
          );
        }

        return sendGenerationFailure(
          error,
          options.llmGateway,
          reply,
          context,
          options.writeGenerationEvent,
        );
      },
    },
    async (request, reply) => {
      const context = ensureGenerationContext(request, reply, options.writeGenerationEvent);
      const inputValidation = generateHttpRequestSchema.safeParse(request.body);

      if (!inputValidation.success) {
        return sendApiErrorWithEvent(
          reply,
          validationApiError,
          context,
          { event: "generation_rejected", status: "validation_error" },
          options.writeGenerationEvent,
        );
      }

      const { captchaToken, consentAccepted, consentVersion, ...generationInput } =
        inputValidation.data;
      let releaseRateLimit: (() => void) | undefined;

      try {
        const preparedClientId = prepareGenerationClientId(
          request,
          reply,
          options.generateClientId,
          options.generationNow,
        );
        const rateLimitDecision = options.generationRateLimiter.acquire({
          ip: request.ip,
          clientId: preparedClientId.clientId,
          hasValidClientCookie: preparedClientId.hasValidClientCookie,
        });
        if (!rateLimitDecision.allowed) {
          pendingClientCookieSetters.set(reply, preparedClientId.setCookieAfterRejection);
          if (rateLimitDecision.retryAfterSeconds !== undefined) {
            reply.header("Retry-After", String(rateLimitDecision.retryAfterSeconds));
          }

          return sendApiErrorWithEvent(
            reply,
            rateLimitApiError,
            context,
            { event: "generation_rejected", status: "rate_limited" },
            options.writeGenerationEvent,
          );
        }

        releaseRateLimit = rateLimitDecision.release;
        pendingClientCookieSetters.set(reply, preparedClientId.setCookieAfterAdmission);
        if (options.smartCaptchaConfig.mode === "required") {
          if (captchaToken === undefined) {
            return sendApiErrorWithEvent(
              reply,
              captchaFailedApiError,
              context,
              { event: "generation_rejected", status: "captcha_failed" },
              options.writeGenerationEvent,
            );
          }

          const verification =
            options.smartCaptchaVerifier === undefined
              ? { status: "unavailable" as const }
              : await options.smartCaptchaVerifier.verify({
                  token: captchaToken,
                  ip: request.ip,
                });

          if (verification.status === "failed") {
            return sendApiErrorWithEvent(
              reply,
              captchaFailedApiError,
              context,
              { event: "generation_rejected", status: "captcha_failed" },
              options.writeGenerationEvent,
            );
          }

          if (verification.status === "unavailable") {
            return sendApiErrorWithEvent(
              reply,
              captchaUnavailableApiError,
              context,
              { event: "generation_rejected", status: "captcha_unavailable" },
              options.writeGenerationEvent,
            );
          }
        }

        const consent = generateConsentSchema.safeParse({ consentAccepted, consentVersion });
        if (!consent.success) {
          return sendApiErrorWithEvent(
            reply,
            validationApiError,
            context,
            { event: "generation_rejected", status: "validation_error" },
            options.writeGenerationEvent,
          );
        }
        if (options.consentLedger === undefined) {
          if (options.llmGateway instanceof DisabledLlmGateway) {
            return sendGenerationFailure(
              new GenerationProviderUnavailableError(),
              options.llmGateway,
              reply,
              context,
              options.writeGenerationEvent,
            );
          }
          throw new Error("Consent ledger is unavailable");
        }
        const receipt = options.consentLedger.accept(
          context.requestId,
          consent.data.consentVersion,
        );
        context.consentReceiptId = receipt.consentReceiptId;
        reply.header("x-consent-receipt-id", receipt.consentReceiptId);

        const safeguardDecision = options.generationSafeguard.acquire();
        if (!safeguardDecision.allowed) {
          return sendApiErrorWithEvent(
            reply,
            generationUnavailableApiError,
            context,
            { event: "generation_rejected", status: "generation_unavailable" },
            options.writeGenerationEvent,
          );
        }

        try {
          const generation = await generateRequest(
            options.llmGateway,
            generationInput,
            context.requestId,
          );

          if (generation.status === "failure") {
            return sendMetadataGatewayFailure(
              generation.generation.failureStatus,
              reply,
              context,
              options.writeGenerationEvent,
              generation.generation.metadata,
              generation.generation.providerHttpStatus,
            );
          }

          const outcome =
            generation.status === "legacy" ? generation.outcome : generation.generation.outcome;
          const llmMetadata =
            generation.status === "success" ? generation.generation.metadata : undefined;

          if (outcome.status === "multiple_issues") {
            return sendApiErrorWithEvent(
              reply,
              multipleIssuesApiError,
              context,
              { event: "generation_rejected", status: "multiple_issues" },
              options.writeGenerationEvent,
              llmMetadata,
            );
          }

          writeSuccessEvent(context, options.writeGenerationEvent, llmMetadata);
          return outcome.result;
        } finally {
          safeguardDecision.release();
        }
      } catch (error) {
        return sendGenerationFailure(
          error,
          options.llmGateway,
          reply,
          context,
          options.writeGenerationEvent,
        );
      } finally {
        releaseRateLimit?.();
      }
    },
  );
}
