import type { GenerateRequestInput, GenerateRequestResult } from "./contracts.js";

export type GenerateRequestOutcome =
  | {
      status: "generated";
      result: GenerateRequestResult;
    }
  | {
      status: "multiple_issues";
    };

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type LlmUsageStatus = "available" | "missing" | "invalid";

export type LlmGenerationMetadata = {
  provider: string;
  model: string;
  usage: LlmUsage | null;
  usageStatus: LlmUsageStatus;
  systemPromptHash: string;
  durationMs: number;
};

export type LlmGenerationFailureStatus =
  | "provider_unavailable"
  | "timeout"
  | "network_error"
  | "invalid_response";

export type LlmGatewayGeneration =
  | {
      status: "success";
      outcome: GenerateRequestOutcome;
      metadata: LlmGenerationMetadata;
    }
  | {
      status: "failure";
      failureStatus: LlmGenerationFailureStatus;
      metadata: LlmGenerationMetadata;
    };

export interface LlmGateway {
  generateRequest(input: GenerateRequestInput, requestId?: string): Promise<GenerateRequestOutcome>;
  generateRequestWithMetadata?(
    input: GenerateRequestInput,
    requestId?: string,
  ): Promise<LlmGatewayGeneration>;
}
