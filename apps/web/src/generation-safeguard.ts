export type GenerationSafeguardOptions = {
  enabled: boolean;
  dailyLimit: number;
  concurrencyLimit: number;
};

type AllowedGenerationAttempt = {
  allowed: true;
  release: () => void;
};

type RejectedGenerationAttempt = {
  allowed: false;
  reason: "disabled" | "daily_limit" | "capacity";
};

export type GenerationSafeguardDecision = AllowedGenerationAttempt | RejectedGenerationAttempt;

export class GenerationSafeguard {
  readonly #options: GenerationSafeguardOptions | undefined;
  readonly #now: () => number;
  #utcDayStart?: number;
  #dailyAttempts = 0;
  #activeCalls = 0;

  constructor(options: GenerationSafeguardOptions | undefined, now: () => number = Date.now) {
    this.#options = options;
    this.#now = now;
  }

  isGenerationEnabled(): boolean {
    return this.#options?.enabled ?? true;
  }

  acquire(): GenerationSafeguardDecision {
    if (this.#options === undefined) {
      return { allowed: true, release: () => {} };
    }

    if (!this.#options.enabled) {
      return { allowed: false, reason: "disabled" };
    }

    const utcDayStart = startOfUtcDay(this.#now());
    if (this.#utcDayStart !== utcDayStart) {
      this.#utcDayStart = utcDayStart;
      this.#dailyAttempts = 0;
    }

    if (this.#dailyAttempts >= this.#options.dailyLimit) {
      return { allowed: false, reason: "daily_limit" };
    }

    if (this.#activeCalls >= this.#options.concurrencyLimit) {
      return { allowed: false, reason: "capacity" };
    }

    this.#dailyAttempts++;
    this.#activeCalls++;
    let isReleased = false;

    return {
      allowed: true,
      release: () => {
        if (isReleased) {
          return;
        }

        isReleased = true;
        this.#activeCalls--;
      },
    };
  }
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
