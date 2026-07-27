import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const generationClientCookieName = "uo_generation_client";

const generationClientIdSchema = z.uuid();
const generationClientCookieMaxAgeSeconds = 365 * 24 * 60 * 60;

type PreparedGenerationClientId = {
  clientId: string;
  hasValidClientCookie: boolean;
  setCookieAfterAdmission: () => void;
};

export function prepareGenerationClientId(
  request: FastifyRequest,
  reply: FastifyReply,
  generateClientId: () => string = randomUUID,
): PreparedGenerationClientId {
  const signedCookie = request.cookies[generationClientCookieName];
  if (signedCookie !== undefined) {
    const unsignedCookie = request.unsignCookie(signedCookie);
    const clientIdValidation = generationClientIdSchema.safeParse(unsignedCookie.value);
    if (unsignedCookie.valid && clientIdValidation.success) {
      return {
        clientId: clientIdValidation.data,
        hasValidClientCookie: true,
        setCookieAfterAdmission: () => {
          if (unsignedCookie.renew) {
            setGenerationClientCookie(request, reply, clientIdValidation.data);
          }
        },
      };
    }
  }

  const generatedClientId = generationClientIdSchema.parse(generateClientId());
  return {
    clientId: generatedClientId,
    hasValidClientCookie: false,
    setCookieAfterAdmission: () => {
      setGenerationClientCookie(request, reply, generatedClientId);
    },
  };
}

function setGenerationClientCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  clientId: string,
): void {
  reply.setCookie(generationClientCookieName, clientId, {
    httpOnly: true,
    maxAge: generationClientCookieMaxAgeSeconds,
    path: "/",
    sameSite: "strict",
    secure: request.protocol === "https",
    signed: true,
  });
}
