import fs from "node:fs";
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
  httpStatus: 400 | 429 | 500 | 503;
  llm?: LlmGenerationMetadata;
};

export type GenerationLogEvent =
  | GenerationStartedEvent
  | GenerationSucceededEvent
  | GenerationRejectedEvent
  | GenerationFailedEvent;

export type GenerationEventWriter = (event: GenerationLogEvent) => undefined;

function writeLine(fileDescriptor: 1 | 2, line: string): void {
  const bytesWritten = fs.writeSync(fileDescriptor, line);
  if (bytesWritten !== Buffer.byteLength(line)) {
    throw new RangeError("Incomplete generation log write");
  }
}

export function writeGenerationEventToStdout(event: GenerationLogEvent): undefined {
  writeLine(1, `${JSON.stringify(event)}\n`);
  return undefined;
}

export function createFailSafeGenerationEventWriter(
  writer: GenerationEventWriter,
): GenerationEventWriter {
  return (event) => {
    try {
      writer(event);
    } catch {
      try {
        writeLine(
          2,
          `${JSON.stringify({
            event: "generation_event_write_failed",
            requestId: event.requestId,
            failedEvent: event.event,
          })}\n`,
        );
      } catch {
        // Сбой stderr не должен менять исход запроса.
        return;
      }
    }
  };
}
