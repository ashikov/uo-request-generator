import { randomUUID } from "node:crypto";
import type { LlmGateway } from "@uo-request-generator/core";
import { GenerationProviderUnavailableError } from "@uo-request-generator/llm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prepareGenerationClientId } from "../generation-client-id.js";
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

function sendApiError(reply: FastifyReply, apiError: ApiError): FastifyReply {
  return reply.code(apiError.statusCode).send({
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId: randomUUID(),
    },
  });
}

type RegisterGenerateRouteOptions = {
  llmGateway: LlmGateway;
  generationRateLimiter: GenerationRateLimiter;
  generationSafeguard: GenerationSafeguard;
  generateClientId: () => string;
  smartCaptchaConfig: SmartCaptchaConfig;
  smartCaptchaVerifier?: Pick<SmartCaptchaVerifier, "verify">;
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
        if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
          return sendApiError(reply, validationApiError);
        }

        return sendApiError(reply, internalApiError);
      },
    },
    async (request, reply) => {
      const inputValidation = generateHttpRequestSchema.safeParse(request.body);

      if (!inputValidation.success) {
        return sendApiError(reply, validationApiError);
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

        return sendApiError(reply, rateLimitApiError);
      }

      try {
        preparedClientId.setCookieAfterAdmission();
        if (options.smartCaptchaConfig.mode === "required") {
          if (captchaToken === undefined) {
            return sendApiError(reply, captchaFailedApiError);
          }

          const verification =
            options.smartCaptchaVerifier === undefined
              ? { status: "unavailable" as const }
              : await options.smartCaptchaVerifier.verify({
                  token: captchaToken,
                  ip: request.ip,
                });

          if (verification.status === "failed") {
            return sendApiError(reply, captchaFailedApiError);
          }

          if (verification.status === "unavailable") {
            return sendApiError(reply, captchaUnavailableApiError);
          }
        }

        const safeguardDecision = options.generationSafeguard.acquire();
        if (!safeguardDecision.allowed) {
          return sendApiError(reply, generationUnavailableApiError);
        }

        try {
          const outcome = await options.llmGateway.generateRequest(generationInput);

          if (outcome.status === "multiple_issues") {
            return sendApiError(reply, multipleIssuesApiError);
          }

          return outcome.result;
        } finally {
          safeguardDecision.release();
        }
      } catch (error) {
        if (error instanceof GenerationProviderUnavailableError) {
          return sendApiError(reply, providerUnavailableApiError);
        }

        throw error;
      } finally {
        rateLimitDecision.release();
      }
    },
  );
}
