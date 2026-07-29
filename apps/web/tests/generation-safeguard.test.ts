import { describe, expect, it } from "vitest";
import { GenerationSafeguard } from "../src/generation-safeguard.js";

function createClock(initialNow = Date.UTC(2026, 6, 27, 12)): {
  advance: (milliseconds: number) => void;
  now: () => number;
} {
  let currentNow = initialNow;
  return { advance: (milliseconds) => (currentNow += milliseconds), now: () => currentNow };
}

function allowed(decision: ReturnType<GenerationSafeguard["acquire"]>) {
  expect(decision.allowed).toBe(true);
  if (!decision.allowed) throw new Error("Expected allowed decision");
  return decision;
}

describe("GenerationSafeguard", () => {
  it("запрещает вызовы при аварийном отключении", () => {
    expect(
      new GenerationSafeguard({ enabled: false, dailyLimit: 1, concurrencyLimit: 1 }).acquire(),
    ).toEqual({
      allowed: false,
      reason: "disabled",
    });
  });

  it("учитывает допущенные попытки и отказывает после дневного лимита", () => {
    const safeguard = new GenerationSafeguard({
      enabled: true,
      dailyLimit: 2,
      concurrencyLimit: 2,
    });
    allowed(safeguard.acquire()).release();
    allowed(safeguard.acquire()).release();
    expect(safeguard.acquire()).toEqual({ allowed: false, reason: "daily_limit" });
  });

  it("сбрасывает только дневной счётчик на границе UTC", () => {
    const clock = createClock(Date.UTC(2026, 6, 27, 23, 59, 59));
    const safeguard = new GenerationSafeguard(
      { enabled: true, dailyLimit: 3, concurrencyLimit: 2 },
      clock.now,
    );
    const first = allowed(safeguard.acquire());
    allowed(safeguard.acquire()).release();
    allowed(safeguard.acquire()).release();
    expect(safeguard.acquire()).toEqual({ allowed: false, reason: "daily_limit" });
    clock.advance(1_000);
    const second = allowed(safeguard.acquire());
    expect(safeguard.acquire()).toEqual({ allowed: false, reason: "capacity" });
    first.release();
    second.release();
  });

  it("не расходует дневную попытку при занятой ёмкости и освобождает слот идемпотентно", () => {
    const safeguard = new GenerationSafeguard({
      enabled: true,
      dailyLimit: 2,
      concurrencyLimit: 1,
    });
    const first = allowed(safeguard.acquire());
    expect(safeguard.acquire()).toEqual({ allowed: false, reason: "capacity" });
    first.release();
    first.release();
    allowed(safeguard.acquire()).release();
    expect(safeguard.acquire()).toEqual({ allowed: false, reason: "daily_limit" });
  });
});
