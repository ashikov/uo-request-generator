import {
  CONFIRMED_PROBLEM_SUBJECT_KINDS,
  generateRequestInputSchema,
  generateRequestLimits,
} from "@uo-request-generator/core";
import { z } from "zod";

export const captchaTokenMaxLength = 4_096;

const maximumConfirmedProblemSubjectLength = Math.max(
  ...CONFIRMED_PROBLEM_SUBJECT_KINDS.map((subject) => subject.length),
);
const maximumRequestValueCodeUnits =
  generateRequestLimits.description.max +
  generateRequestLimits.location.max +
  generateRequestLimits.consequences.max +
  generateRequestLimits.desiredActions.max +
  maximumConfirmedProblemSubjectLength +
  captchaTokenMaxLength;
// Один UTF-16 code unit может занимать шесть байт в JSON-escape `\uXXXX`.
const maximumJsonBytesPerValueCharacter = 6;
const requestJsonStructureBytes = Buffer.byteLength(
  JSON.stringify({
    description: "",
    location: "",
    consequences: "",
    desiredActions: "",
    confirmedProblemSubject: "",
    captchaToken: "",
  }),
);
const requestJsonServiceReserveBytes = 2_048;

export const generateRequestBodyLimitBytes =
  maximumRequestValueCodeUnits * maximumJsonBytesPerValueCharacter +
  requestJsonStructureBytes +
  requestJsonServiceReserveBytes;

export const generateHttpRequestSchema = generateRequestInputSchema
  .extend({
    captchaToken: z.string().trim().min(1).max(captchaTokenMaxLength).optional(),
  })
  .strict();
