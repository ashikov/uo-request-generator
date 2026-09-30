import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  expiredStateCleanupIntervalMs,
  GenerationRateLimiter,
} from "../src/generation-rate-limiter.js";

const minuteMs = 60_000;
const dayMs = 86_400_000;

const apps: ReturnType<typeof createApp>[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createLimiterWithClock(initialNow = Date.UTC(2026, 8, 30, 12)) {
  let currentNow = initialNow;
  const limiter = new GenerationRateLimiter(
    {
      ipRequestLimit: 3,
      ipWindowMs: minuteMs,
      clientDailyLimit: 20,
      stateCapacity: 100,
    },
    () => currentNow,
  );

  return {
    limiter,
    advance(milliseconds: number) {
      currentNow += milliseconds;
    },
  };
}

function acquireOnce(limiter: GenerationRateLimiter): void {
  const decision = limiter.acquire({
    ip: "198.51.100.1",
    clientId: "11111111-1111-4111-8111-111111111111",
    hasValidClientCookie: true,
  });
  expect(decision.allowed).toBe(true);
  if (decision.allowed) {
    decision.release();
  }
}

describe("periodic expired state cleanup", () => {
  it("удаляет истёкшее состояние limiter по таймеру без новых обращений", async () => {
    vi.useFakeTimers();
    const { advance, limiter } = createLimiterWithClock();
    apps.push(createApp({ generationRateLimiter: limiter }));

    acquireOnce(limiter);
    expect(limiter.stateSize).toBe(2);

    advance(minuteMs);
    await vi.advanceTimersByTimeAsync(expiredStateCleanupIntervalMs);
    expect(limiter.stateSize).toBe(1);

    advance(dayMs);
    await vi.advanceTimersByTimeAsync(expiredStateCleanupIntervalMs);
    expect(limiter.stateSize).toBe(0);
  });

  it("останавливает таймер очистки при закрытии приложения", async () => {
    vi.useFakeTimers();
    const baselineTimerCount = vi.getTimerCount();
    const { limiter } = createLimiterWithClock();
    const app = createApp({ generationRateLimiter: limiter });

    expect(vi.getTimerCount()).toBe(baselineTimerCount + 1);

    await app.close();
    expect(vi.getTimerCount()).toBe(baselineTimerCount);
  });
});
