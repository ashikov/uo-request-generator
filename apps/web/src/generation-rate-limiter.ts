export type GenerationRateLimiterOptions = {
  ipRequestLimit: number;
  ipWindowMs: number;
  clientDailyLimit: number;
  stateCapacity: number;
};

type GenerationAttempt = {
  ip: string;
  clientId: string;
  hasValidClientCookie: boolean;
};

type AllowedGenerationAttempt = {
  allowed: true;
  release: () => void;
};

type RejectedGenerationAttempt = {
  allowed: false;
  retryAfterSeconds?: number;
};

type GenerationRateLimitDecision = AllowedGenerationAttempt | RejectedGenerationAttempt;

type ClientDailyUsage = {
  utcDayStart: number;
  attempts: number;
};

export class GenerationRateLimiter {
  readonly #options: GenerationRateLimiterOptions;
  readonly #now: () => number;
  readonly #ipAttemptTimestamps = new Map<string, number[]>();
  readonly #clientDailyUsage = new Map<string, ClientDailyUsage>();
  readonly #activeClients = new Map<string, symbol>();
  readonly #activeIpCounts = new Map<string, number>();

  constructor(options: GenerationRateLimiterOptions, now: () => number = Date.now) {
    this.#options = options;
    this.#now = now;
  }

  acquire(attempt: GenerationAttempt): GenerationRateLimitDecision {
    const now = this.#now();
    const utcDayStart = startOfUtcDay(now);
    this.#removeExpiredState(now, utcDayStart);

    const ipAttempts = this.#ipAttemptTimestamps.get(attempt.ip);
    const clientDailyUsage = this.#clientDailyUsage.get(attempt.clientId);
    const retryAfterCandidates: number[] = [];

    if (ipAttempts !== undefined && ipAttempts.length >= this.#options.ipRequestLimit) {
      const oldestAttempt = ipAttempts[0];
      if (oldestAttempt !== undefined) {
        retryAfterCandidates.push(oldestAttempt + this.#options.ipWindowMs - now);
      }
    }

    if (
      clientDailyUsage !== undefined &&
      clientDailyUsage.attempts >= this.#options.clientDailyLimit
    ) {
      retryAfterCandidates.push(utcDayStart + 86_400_000 - now);
    }

    const hasActiveClient = this.#activeClients.has(attempt.clientId);
    const activeIpCount = this.#activeIpCounts.get(attempt.ip) ?? 0;
    const hasActiveIpConflict = !attempt.hasValidClientCookie && activeIpCount > 0;
    const additionalStateSize =
      2 + (clientDailyUsage === undefined ? 1 : 0) + (activeIpCount === 0 ? 1 : 0);
    const hasCapacity = this.#stateSize() + additionalStateSize <= this.#options.stateCapacity;

    if (retryAfterCandidates.length > 0 || hasActiveClient || hasActiveIpConflict || !hasCapacity) {
      if (
        hasActiveClient ||
        hasActiveIpConflict ||
        !hasCapacity ||
        retryAfterCandidates.length === 0
      ) {
        return { allowed: false };
      }

      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(Math.max(...retryAfterCandidates) / 1_000),
      };
    }

    if (ipAttempts === undefined) {
      this.#ipAttemptTimestamps.set(attempt.ip, [now]);
    } else {
      ipAttempts.push(now);
    }

    if (clientDailyUsage === undefined) {
      this.#clientDailyUsage.set(attempt.clientId, {
        utcDayStart,
        attempts: 1,
      });
    } else {
      clientDailyUsage.attempts++;
    }

    const activeToken = Symbol();
    this.#activeClients.set(attempt.clientId, activeToken);
    this.#activeIpCounts.set(attempt.ip, (this.#activeIpCounts.get(attempt.ip) ?? 0) + 1);
    let isReleased = false;

    return {
      allowed: true,
      release: () => {
        if (isReleased) {
          return;
        }

        isReleased = true;
        if (this.#activeClients.get(attempt.clientId) === activeToken) {
          this.#activeClients.delete(attempt.clientId);
          const activeIpCount = this.#activeIpCounts.get(attempt.ip);
          if (activeIpCount === 1) {
            this.#activeIpCounts.delete(attempt.ip);
          } else if (activeIpCount !== undefined) {
            this.#activeIpCounts.set(attempt.ip, activeIpCount - 1);
          }
        }
      },
    };
  }

  #removeExpiredState(now: number, utcDayStart: number): void {
    const windowStart = now - this.#options.ipWindowMs;
    for (const [ip, timestamps] of this.#ipAttemptTimestamps) {
      const activeTimestamps = timestamps.filter((timestamp) => timestamp > windowStart);
      if (activeTimestamps.length === 0) {
        this.#ipAttemptTimestamps.delete(ip);
      } else if (activeTimestamps.length !== timestamps.length) {
        this.#ipAttemptTimestamps.set(ip, activeTimestamps);
      }
    }

    for (const [clientId, usage] of this.#clientDailyUsage) {
      if (usage.utcDayStart !== utcDayStart) {
        this.#clientDailyUsage.delete(clientId);
      }
    }
  }

  #stateSize(): number {
    let ipAttemptCount = 0;
    for (const timestamps of this.#ipAttemptTimestamps.values()) {
      ipAttemptCount += timestamps.length;
    }

    return (
      ipAttemptCount +
      this.#clientDailyUsage.size +
      this.#activeClients.size +
      this.#activeIpCounts.size
    );
  }
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
