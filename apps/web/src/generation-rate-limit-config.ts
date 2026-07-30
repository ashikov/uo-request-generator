import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

const minimumCookieSecretLength = 32;

export const generationRateLimitDefaults = {
  ipRequestLimit: 3,
  ipWindowMs: 60_000,
  clientDailyLimit: 20,
  trustedProxies: [],
  stateCapacity: 10_000,
} as const;

export type GenerationRateLimitConfig = {
  ipRequestLimit: number;
  ipWindowMs: number;
  clientDailyLimit: number;
  cookieSecret: string;
  trustedProxies: readonly string[];
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

function isIpOrCidr(value: string): boolean {
  const parts = value.split("/");
  if (parts.length === 1) {
    return isIP(value) !== 0;
  }

  if (parts.length !== 2) {
    return false;
  }

  const [address, prefix] = parts;
  if (address === undefined || prefix === undefined || !/^(0|[1-9]\d*)$/.test(prefix)) {
    return false;
  }

  const addressFamily = isIP(address);
  if (addressFamily === 0) {
    return false;
  }

  const prefixLength = Number(prefix);
  return prefixLength >= 1 && prefixLength <= (addressFamily === 4 ? 32 : 128);
}

const trustedProxiesEnvironmentValue = z
  .string()
  .transform((value) => value.split(",").map((trustedProxy) => trustedProxy.trim()))
  .pipe(z.array(z.string().min(1).refine(isIpOrCidr)));

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
  GENERATION_TRUSTED_PROXIES: trustedProxiesEnvironmentValue.optional(),
  GENERATION_TRUST_PROXY: z.never().optional(),
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
    trustedProxies: environmentValidation.data.GENERATION_TRUSTED_PROXIES ?? [],
    stateCapacity: environmentValidation.data.GENERATION_RATE_LIMIT_STATE_CAPACITY,
  };
}
