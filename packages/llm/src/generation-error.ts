export class GenerationProviderUnavailableError extends Error {
  readonly code: string = "generation_provider_unavailable";

  constructor(message: string = "Generation provider is not configured") {
    super(message);
    this.name = "GenerationProviderUnavailableError";
  }
}

export class GenerationTimeoutError extends GenerationProviderUnavailableError {
  override readonly code = "generation_timeout";

  constructor() {
    super("Generation provider timed out");
    this.name = "GenerationTimeoutError";
  }
}

export class GenerationNetworkError extends GenerationProviderUnavailableError {
  override readonly code = "generation_network_error";

  constructor() {
    super("Generation provider is unreachable");
    this.name = "GenerationNetworkError";
  }
}

export class GenerationInvalidResponseError extends GenerationProviderUnavailableError {
  override readonly code = "generation_invalid_response";

  constructor() {
    super("Generation provider returned an invalid response");
    this.name = "GenerationInvalidResponseError";
  }
}
