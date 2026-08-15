import type {
  GenerateRequestInput,
  GenerateRequestOutcome,
  LlmGateway,
} from "@uo-request-generator/core";
import { GenerationProviderUnavailableError } from "./generation-error.js";

export class DisabledLlmGateway implements LlmGateway {
  generateRequest(_input: GenerateRequestInput): Promise<GenerateRequestOutcome> {
    return Promise.reject(new GenerationProviderUnavailableError());
  }
}
