import type { GenerateRequestInput, GenerateRequestResult } from "./contracts.js";

export interface LlmGateway {
  generateRequest(input: GenerateRequestInput): Promise<GenerateRequestResult>;
}
