import { generateRequestInputSchema } from "@uo-request-generator/core";
import { z } from "zod";

export const captchaTokenMaxLength = 4_096;

export const generateHttpRequestSchema = generateRequestInputSchema
  .extend({
    captchaToken: z.string().trim().min(1).max(captchaTokenMaxLength).optional(),
  })
  .strict();
