import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { nextUtcDayBoundary } from "./generation-rate-limiter.js";

export const generationClientCookieName = "uo_generation_client";

const generationClientIdSchema = z.uuid();
const generationClientCookiePath = "/api/generate";

type PreparedGenerationClientId = {
  clientId: string;
  hasValidClientCookie: boolean;
  migrateValidClientCookie: () => void;
  setCookieAfterAdmission: () => void;
};

export function prepareGenerationClientId(
  request: FastifyRequest,
  reply: FastifyReply,
  generateClientId: () => string = randomUUID,
  now: () => number = Date.now,
): PreparedGenerationClientId {
  const signedCookie = request.cookies[generationClientCookieName];
  if (signedCookie !== undefined) {
    const unsignedCookie = request.unsignCookie(signedCookie);
    const clientIdValidation = generationClientIdSchema.safeParse(unsignedCookie.value);
    if (unsignedCookie.valid && clientIdValidation.success) {
      const migrateValidClientCookie = () => {
        // В Cookie header нет Path, поэтому для каждого valid ID идемпотентно заменяем legacy-вариант.
        setGenerationClientCookie(request, reply, clientIdValidation.data, now());
        clearLegacyGenerationClientCookie(request, reply);
      };

      return {
        clientId: clientIdValidation.data,
        hasValidClientCookie: true,
        migrateValidClientCookie,
        setCookieAfterAdmission: migrateValidClientCookie,
      };
    }
  }

  const generatedClientId = generationClientIdSchema.parse(generateClientId());
  return {
    clientId: generatedClientId,
    hasValidClientCookie: false,
    migrateValidClientCookie: () => {},
    setCookieAfterAdmission: () => {
      setGenerationClientCookie(request, reply, generatedClientId, now());
    },
  };
}

function setGenerationClientCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  clientId: string,
  now: number,
): void {
  reply.setCookie(generationClientCookieName, clientId, {
    httpOnly: true,
    // Округляем вверх, чтобы cookie не истекла до границы суток limiter.
    maxAge: Math.ceil((nextUtcDayBoundary(now) - now) / 1_000),
    path: generationClientCookiePath,
    sameSite: "strict",
    secure: request.protocol === "https",
    signed: true,
  });
}

function clearLegacyGenerationClientCookie(request: FastifyRequest, reply: FastifyReply): void {
  reply.clearCookie(generationClientCookieName, {
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure: request.protocol === "https",
  });
}
