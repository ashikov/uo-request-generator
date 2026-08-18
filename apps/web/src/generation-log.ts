import type { LlmGenerationMetadata } from "@uo-request-generator/core";

export type GenerationStartedEvent = {
  event: "generation_started";
  requestId: string;
  timestamp: string;
};

export type GenerationSucceededEvent = {
  event: "generation_succeeded";
  requestId: string;
  timestamp: string;
  status: "generated";
  durationMs: number;
  httpStatus: 200;
  llm?: LlmGenerationMetadata;
};

export type GenerationRejectedEvent = {
  event: "generation_rejected";
  requestId: string;
  timestamp: string;
  status:
    | "validation_error"
    | "request_too_large"
    | "multiple_issues"
    | "rate_limited"
    | "captcha_failed"
    | "captcha_unavailable"
    | "generation_unavailable";
  durationMs: number;
  httpStatus: 400 | 413 | 429 | 500 | 503;
  llm?: LlmGenerationMetadata;
};

export type GenerationFailedEvent = {
  event: "generation_failed";
  requestId: string;
  timestamp: string;
  status:
    | "provider_unavailable"
    | "timeout"
    | "network_error"
    | "invalid_response"
    | "internal_error";
  durationMs: number;
  httpStatus: 400 | 413 | 429 | 500 | 503;
  llm?: LlmGenerationMetadata;
};

export type GenerationLogEvent =
  | GenerationStartedEvent
  | GenerationSucceededEvent
  | GenerationRejectedEvent
  | GenerationFailedEvent;

export type GenerationEventWriter = (event: GenerationLogEvent) => void;

export function writeGenerationEventToStdout(event: GenerationLogEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
