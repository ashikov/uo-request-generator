import type { GenerateRequestInput, GenerateRequestResult } from "./contracts.js";

export type GenerateRequestOutcome =
  | {
      status: "generated";
      result: GenerateRequestResult;
    }
  | {
      status: "multiple_issues";
    };

export interface LlmGateway {
  generateRequest(input: GenerateRequestInput, requestId?: string): Promise<GenerateRequestOutcome>;
}
