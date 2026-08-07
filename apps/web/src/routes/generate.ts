import { randomUUID } from "node:crypto";
import type { LlmGateway } from "@uo-request-generator/core";
import {
  GenerationInvalidResponseError,
  GenerationNetworkError,
  GenerationProviderUnavailableError,
  GenerationTimeoutError,
} from "@uo-request-generator/llm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prepareGenerationClientId } from "../generation-client-id.js";
import type {
  GenerationEventWriter,
  GenerationFailedEvent,
  GenerationRejectedEvent,
} from "../generation-log.js";
import { generateHttpRequestSchema } from "../generation-http-contract.js";
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
  | "validation_error";

type ApiError = {
  code: ApiErrorCode;
  message: string;
  statusCode: 400 | 429 | 500 | 503;
};

type GenerationTerminalStatus =
  | {
      event: "generation_rejected";
      status: GenerationRejectedEvent["status"];
    }
  | {
      event: "generation_failed";
      status: GenerationFailedEvent["status"];
    };

const validationApiError: ApiError = {
  code: "validation_error",
  message: "Проверьте формат и содержание запроса",
  statusCode: 400,
};

const providerUnavailableApiError: ApiError = {
  code: "generation_provider_unavailable",
  message: "Генерация пока не подключена",
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

function sendApiError(reply: FastifyReply, apiError: ApiError, requestId: string): FastifyReply {
  return reply.code(apiError.statusCode).send({
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId,
    },
  });
}

function sendApiErrorWithEvent(
  reply: FastifyReply,
  apiError: ApiError,
  requestId: string,
  terminalStatus: GenerationTerminalStatus,
  startedAt: number,
  writeGenerationEvent: GenerationEventWriter,
): FastifyReply {
  writeGenerationEvent({
    ...terminalStatus,
    requestId,
    timestamp: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    httpStatus: apiError.statusCode,
  });

  return sendApiError(reply, apiError, requestId);
}

type RegisterGenerateRouteOptions = {
  llmGateway: LlmGateway;
  generationRateLimiter: GenerationRateLimiter;
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
  app.post(
    "/api/generate",
    {
      errorHandler(error, _request, reply) {
        // Fastify отклоняет некорректный JSON до вызова основного обработчика.
        const requestId = randomUUID();
        const startedAt = performance.now();
        reply.header("x-request-id", requestId);
        options.writeGenerationEvent({
          event: "generation_started",
          requestId,
          timestamp: new Date().toISOString(),
        });

        if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
          return sendApiErrorWithEvent(
            reply,
            validationApiError,
            requestId,
            { event: "generation_rejected", status: "validation_error" },
            startedAt,
            options.writeGenerationEvent,
          );
        }

        return sendApiErrorWithEvent(
          reply,
          internalApiError,
          requestId,
          { event: "generation_failed", status: "internal_error" },
          startedAt,
          options.writeGenerationEvent,
        );
      },
    },
    async (request, reply) => {
      const requestId = randomUUID();
      const startedAt = performance.now();
      reply.header("x-request-id", requestId);
      options.writeGenerationEvent({
        event: "generation_started",
        requestId,
        timestamp: new Date().toISOString(),
      });

      const inputValidation = generateHttpRequestSchema.safeParse(request.body);

      if (!inputValidation.success) {
        return sendApiErrorWithEvent(
          reply,
          validationApiError,
          requestId,
          { event: "generation_rejected", status: "validation_error" },
          startedAt,
          options.writeGenerationEvent,
        );
      }

      const { captchaToken, ...generationInput } = inputValidation.data;
      const preparedClientId = prepareGenerationClientId(request, reply, options.generateClientId);
      const rateLimitDecision = options.generationRateLimiter.acquire({
        ip: request.ip,
        clientId: preparedClientId.clientId,
        hasValidClientCookie: preparedClientId.hasValidClientCookie,
      });
      if (!rateLimitDecision.allowed) {
        if (rateLimitDecision.retryAfterSeconds !== undefined) {
          reply.header("Retry-After", String(rateLimitDecision.retryAfterSeconds));
        }

        return sendApiErrorWithEvent(
          reply,
          rateLimitApiError,
          requestId,
          { event: "generation_rejected", status: "rate_limited" },
          startedAt,
          options.writeGenerationEvent,
        );
      }

      try {
        preparedClientId.setCookieAfterAdmission();
        if (options.smartCaptchaConfig.mode === "required") {
          if (captchaToken === undefined) {
            return sendApiErrorWithEvent(
              reply,
              captchaFailedApiError,
              requestId,
              { event: "generation_rejected", status: "captcha_failed" },
              startedAt,
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
              requestId,
              { event: "generation_rejected", status: "captcha_failed" },
              startedAt,
              options.writeGenerationEvent,
            );
          }

          if (verification.status === "unavailable") {
            return sendApiErrorWithEvent(
              reply,
              captchaUnavailableApiError,
              requestId,
              { event: "generation_rejected", status: "captcha_unavailable" },
              startedAt,
              options.writeGenerationEvent,
            );
          }
        }

        const safeguardDecision = options.generationSafeguard.acquire();
        if (!safeguardDecision.allowed) {
          return sendApiErrorWithEvent(
            reply,
            generationUnavailableApiError,
            requestId,
            { event: "generation_rejected", status: "generation_unavailable" },
            startedAt,
            options.writeGenerationEvent,
          );
        }

        try {
          const outcome = await options.llmGateway.generateRequest(generationInput, requestId);

          if (outcome.status === "multiple_issues") {
            return sendApiErrorWithEvent(
              reply,
              multipleIssuesApiError,
              requestId,
              { event: "generation_rejected", status: "multiple_issues" },
              startedAt,
              options.writeGenerationEvent,
            );
          }

          options.writeGenerationEvent({
            event: "generation_succeeded",
            requestId,
            timestamp: new Date().toISOString(),
            status: "generated",
            durationMs: Math.round(performance.now() - startedAt),
            httpStatus: 200,
          });

          return outcome.result;
        } finally {
          safeguardDecision.release();
        }
      } catch (error) {
        if (error instanceof GenerationTimeoutError) {
          return sendApiErrorWithEvent(
            reply,
            providerUnavailableApiError,
            requestId,
            { event: "generation_failed", status: "timeout" },
            startedAt,
            options.writeGenerationEvent,
          );
        }

        if (error instanceof GenerationNetworkError) {
          return sendApiErrorWithEvent(
            reply,
            providerUnavailableApiError,
            requestId,
            { event: "generation_failed", status: "network_error" },
            startedAt,
            options.writeGenerationEvent,
          );
        }

        if (error instanceof GenerationInvalidResponseError) {
          return sendApiErrorWithEvent(
            reply,
            providerUnavailableApiError,
            requestId,
            { event: "generation_failed", status: "invalid_response" },
            startedAt,
            options.writeGenerationEvent,
          );
        }

        if (error instanceof GenerationProviderUnavailableError) {
          return sendApiErrorWithEvent(
            reply,
            providerUnavailableApiError,
            requestId,
            { event: "generation_failed", status: "provider_unavailable" },
            startedAt,
            options.writeGenerationEvent,
          );
        }

        return sendApiErrorWithEvent(
          reply,
          internalApiError,
          requestId,
          { event: "generation_failed", status: "internal_error" },
          startedAt,
          options.writeGenerationEvent,
        );
      } finally {
        rateLimitDecision.release();
      }
    },
  );
}
