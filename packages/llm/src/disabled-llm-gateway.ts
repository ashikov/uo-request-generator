import type {
  GenerateRequestInput,
  GenerateRequestOutcome,
  LlmGateway,
} from "@uo-request-generator/core";

export class GenerationProviderUnavailableError extends Error {
  readonly code = "generation_provider_unavailable";

  constructor() {
    super("Generation provider is not configured");
    this.name = "GenerationProviderUnavailableError";
  }
}

export class DisabledLlmGateway implements LlmGateway {
  generateRequest(_input: GenerateRequestInput): Promise<GenerateRequestOutcome> {
    return Promise.reject(new GenerationProviderUnavailableError());
  }
}
