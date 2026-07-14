import { randomUUID } from "node:crypto";
import { generateRequestInputSchema, type LlmGateway } from "@uo-request-generator/core";
import type { FastifyInstance, FastifyReply } from "fastify";

type ApiErrorCode = "generation_provider_unavailable" | "validation_error";

function sendError(
  reply: FastifyReply,
  statusCode: 400 | 503,
  code: ApiErrorCode,
  message: string,
  requestId: string,
): FastifyReply {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      requestId,
    },
  });
}

export function registerGenerateRoute(app: FastifyInstance, llmGateway: LlmGateway): void {
  app.post(
    "/api/generate",
    {
      errorHandler(error, _request, reply) {
        const requestId = randomUUID();

        if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
          return sendError(
            reply,
            400,
            "validation_error",
            "Проверьте формат и содержание запроса",
            requestId,
          );
        }

        return sendError(
          reply,
          503,
          "generation_provider_unavailable",
          "Генерация пока не подключена",
          requestId,
        );
      },
    },
    async (request, reply) => {
      const requestId = randomUUID();
      const parsedInput = generateRequestInputSchema.safeParse(request.body);

      if (!parsedInput.success) {
        return sendError(
          reply,
          400,
          "validation_error",
          "Проверьте формат и содержание запроса",
          requestId,
        );
      }

      try {
        return await llmGateway.generateRequest(parsedInput.data);
      } catch {
        return sendError(
          reply,
          503,
          "generation_provider_unavailable",
          "Генерация пока не подключена",
          requestId,
        );
      }
    },
  );
}
