import { randomBytes } from "node:crypto";
import { z } from "zod";

const minimumCookieSecretLength = 32;

export const generationRateLimitDefaults = {
  ipRequestLimit: 3,
  ipWindowMs: 60_000,
  clientDailyLimit: 20,
  trustProxy: false,
  stateCapacity: 10_000,
} as const;

export type GenerationRateLimitConfig = {
  ipRequestLimit: number;
  ipWindowMs: number;
  clientDailyLimit: number;
  cookieSecret: string;
  trustProxy: boolean;
  stateCapacity: number;
};

type CreateGenerationRateLimitConfigOptions = {
  allowEphemeralCookieSecret?: boolean;
  generateCookieSecret?: () => string;
};

const positiveIntegerEnvironmentValue = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(Number.isSafeInteger);

function positiveIntegerEnvironmentValueWithDefault(defaultValue: number) {
  return z.string().default(String(defaultValue)).pipe(positiveIntegerEnvironmentValue);
}

const cookieSecretSchema = z
  .string()
  .min(minimumCookieSecretLength)
  .refine((value) => /\S/.test(value));

const generationRateLimitEnvironmentSchema = z.object({
  GENERATION_IP_REQUEST_LIMIT: positiveIntegerEnvironmentValueWithDefault(
    generationRateLimitDefaults.ipRequestLimit,
  ),
  GENERATION_IP_WINDOW_MS: positiveIntegerEnvironmentValueWithDefault(
    generationRateLimitDefaults.ipWindowMs,
  ),
  GENERATION_CLIENT_DAILY_LIMIT: positiveIntegerEnvironmentValueWithDefault(
    generationRateLimitDefaults.clientDailyLimit,
  ),
  GENERATION_CLIENT_COOKIE_SECRET: cookieSecretSchema.optional(),
  GENERATION_TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  GENERATION_RATE_LIMIT_STATE_CAPACITY: positiveIntegerEnvironmentValueWithDefault(
    generationRateLimitDefaults.stateCapacity,
  ),
});

export function createGenerationRateLimitConfig(
  environment: NodeJS.ProcessEnv,
  options: CreateGenerationRateLimitConfigOptions = {},
): GenerationRateLimitConfig {
  const environmentValidation = generationRateLimitEnvironmentSchema.safeParse(environment);
  if (!environmentValidation.success) {
    throw new Error("Invalid generation rate limit configuration");
  }

  const cookieSecret =
    environmentValidation.data.GENERATION_CLIENT_COOKIE_SECRET ??
    (options.allowEphemeralCookieSecret
      ? (options.generateCookieSecret ?? (() => randomBytes(32).toString("base64url")))()
      : undefined);
  const cookieSecretValidation = cookieSecretSchema.safeParse(cookieSecret);
  if (!cookieSecretValidation.success) {
    throw new Error("Invalid generation rate limit configuration");
  }

  return {
    ipRequestLimit: environmentValidation.data.GENERATION_IP_REQUEST_LIMIT,
    ipWindowMs: environmentValidation.data.GENERATION_IP_WINDOW_MS,
    clientDailyLimit: environmentValidation.data.GENERATION_CLIENT_DAILY_LIMIT,
    cookieSecret: cookieSecretValidation.data,
    trustProxy: environmentValidation.data.GENERATION_TRUST_PROXY,
    stateCapacity: environmentValidation.data.GENERATION_RATE_LIMIT_STATE_CAPACITY,
  };
}
