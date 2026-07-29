import { z } from "zod";

export type GenerationSafeguardConfig = {
  enabled: boolean;
  dailyLimit: number;
  concurrencyLimit: number;
};

type CreateGenerationSafeguardConfigOptions = {
  allowImplicitDisabledGateway?: boolean;
};

const positiveSafeInteger = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .refine(Number.isSafeInteger);

const generationSafeguardEnvironmentSchema = z.object({
  GENERATION_ENABLED: z.enum(["true", "false"]),
  GENERATION_GLOBAL_DAILY_LIMIT: positiveSafeInteger.optional(),
  GENERATION_GLOBAL_CONCURRENCY_LIMIT: positiveSafeInteger.optional(),
});

export function createGenerationSafeguardConfig(
  environment: NodeJS.ProcessEnv,
  options: CreateGenerationSafeguardConfigOptions = {},
): GenerationSafeguardConfig | undefined {
  const hasSafeguardConfiguration =
    environment.GENERATION_ENABLED !== undefined ||
    environment.GENERATION_GLOBAL_DAILY_LIMIT !== undefined ||
    environment.GENERATION_GLOBAL_CONCURRENCY_LIMIT !== undefined;

  if (!hasSafeguardConfiguration && options.allowImplicitDisabledGateway) {
    return undefined;
  }

  const environmentValidation = generationSafeguardEnvironmentSchema.safeParse(environment);
  if (!environmentValidation.success) {
    throw new Error("Invalid generation safeguard configuration");
  }

  const { GENERATION_ENABLED, GENERATION_GLOBAL_DAILY_LIMIT, GENERATION_GLOBAL_CONCURRENCY_LIMIT } =
    environmentValidation.data;
  if (
    GENERATION_ENABLED === "true" &&
    (GENERATION_GLOBAL_DAILY_LIMIT === undefined ||
      GENERATION_GLOBAL_CONCURRENCY_LIMIT === undefined)
  ) {
    throw new Error("Invalid generation safeguard configuration");
  }

  return {
    enabled: GENERATION_ENABLED === "true",
    dailyLimit: GENERATION_GLOBAL_DAILY_LIMIT ?? 1,
    concurrencyLimit: GENERATION_GLOBAL_CONCURRENCY_LIMIT ?? 1,
  };
}
