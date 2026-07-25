import { z } from "zod";

export const generateRequestLimits = {
  description: {
    min: 10,
    max: 2_000,
  },
  location: {
    max: 120,
  },
  consequences: {
    max: 500,
  },
  desiredActions: {
    max: 500,
  },
  result: {
    titleMax: 120,
    bodyMax: 2_500,
    warningsMax: 5,
    warningMax: 200,
  },
} as const;

export const generateRequestInputSchema = z
  .object({
    description: z
      .string()
      .min(
        generateRequestLimits.description.min,
        `Описание должно содержать не менее ${generateRequestLimits.description.min} символов`,
      )
      .max(
        generateRequestLimits.description.max,
        `Описание должно содержать не более ${generateRequestLimits.description.max} символов`,
      ),
    location: z
      .string()
      .max(
        generateRequestLimits.location.max,
        `Место должно содержать не более ${generateRequestLimits.location.max} символов`,
      )
      .optional(),
    consequences: z
      .string()
      .trim()
      .min(1, "Последствия не должны быть пустыми")
      .max(
        generateRequestLimits.consequences.max,
        `Последствия должны содержать не более ${generateRequestLimits.consequences.max} символов`,
      )
      .optional(),
    desiredActions: z
      .string()
      .trim()
      .min(1, "Желаемые действия не должны быть пустыми")
      .max(
        generateRequestLimits.desiredActions.max,
        `Желаемые действия должны содержать не более ${generateRequestLimits.desiredActions.max} символов`,
      )
      .optional(),
  })
  .strict();

export type GenerateRequestInput = z.infer<typeof generateRequestInputSchema>;

export const generateRequestResultSchema = z
  .object({
    title: z.string().min(1).max(generateRequestLimits.result.titleMax),
    body: z.string().min(1).max(generateRequestLimits.result.bodyMax),
    warnings: z
      .array(z.string().min(1).max(generateRequestLimits.result.warningMax))
      .max(generateRequestLimits.result.warningsMax),
  })
  .strict();

export type GenerateRequestResult = z.infer<typeof generateRequestResultSchema>;
