import { describe, expect, it } from "vitest";
import {
  GenerationRateLimiter,
  type GenerationRateLimiterOptions,
} from "../src/generation-rate-limiter.js";

const minuteMs = 60_000;
const dayMs = 86_400_000;

function createClock(initialNow = Date.UTC(2026, 6, 27, 12)): {
  advance: (milliseconds: number) => void;
  now: () => number;
} {
  let currentNow = initialNow;

  return {
    advance(milliseconds) {
      currentNow += milliseconds;
    },
    now() {
      return currentNow;
    },
  };
}

function createLimiter(overrides: Partial<GenerationRateLimiterOptions> = {}, initialNow?: number) {
  const clock = createClock(initialNow);
  const limiter = new GenerationRateLimiter(
    {
      ipRequestLimit: 3,
      ipWindowMs: minuteMs,
      clientDailyLimit: 20,
      stateCapacity: 100,
      ...overrides,
    },
    clock.now,
  );

  return { clock, limiter };
}

type GenerationAttempt = Parameters<GenerationRateLimiter["acquire"]>[0];
type TestGenerationAttempt = Omit<GenerationAttempt, "hasValidClientCookie"> &
  Partial<Pick<GenerationAttempt, "hasValidClientCookie">>;

function acquireGeneration(
  limiter: GenerationRateLimiter,
  attempt: TestGenerationAttempt,
): ReturnType<GenerationRateLimiter["acquire"]> {
  const { hasValidClientCookie = true, ...clientIdentity } = attempt;
  return limiter.acquire({
    ...clientIdentity,
    hasValidClientCookie,
  });
}

function expectAllowed(
  decision: ReturnType<GenerationRateLimiter["acquire"]>,
): Extract<typeof decision, { allowed: true }> {
  expect(decision.allowed).toBe(true);
  if (!decision.allowed) {
    throw new Error("Expected the generation attempt to be allowed");
  }

  return decision;
}

function expectRejected(
  decision: ReturnType<GenerationRateLimiter["acquire"]>,
  retryAfterSeconds?: number,
): void {
  expect(decision).toEqual({
    allowed: false,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

describe("GenerationRateLimiter", () => {
  it("допускает три попытки IP и отклоняет четвёртую в скользящем окне", () => {
    const { limiter } = createLimiter();

    for (const clientId of ["client-a", "client-b", "client-c"]) {
      expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId })).release();
    }

    expectRejected(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-d" }), 60);
  });

  it("снова допускает IP после истечения окна", () => {
    const { clock, limiter } = createLimiter({ ipRequestLimit: 1 });

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    clock.advance(minuteMs);

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-b" })).release();
  });

  it("ведёт независимые IP-окна", () => {
    const { limiter } = createLimiter({ ipRequestLimit: 1 });

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    expectAllowed(acquireGeneration(limiter, { ip: "ip-b", clientId: "client-b" })).release();
  });

  it("ограничивает клиента календарными сутками UTC", () => {
    const { limiter } = createLimiter({ ipRequestLimit: 100, clientDailyLimit: 20 });

    for (let attempt = 0; attempt < 20; attempt++) {
      expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    }

    expectRejected(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }), 43_200);
  });

  it("сбрасывает суточный счётчик на следующей границе UTC", () => {
    const { clock, limiter } = createLimiter(
      { ipRequestLimit: 100, clientDailyLimit: 1 },
      Date.UTC(2026, 6, 27, 23, 59, 59),
    );

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    expectRejected(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }), 1);
    clock.advance(1_000);

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
  });

  it("не изменяет другие квоты при отклонении", () => {
    const { clock, limiter } = createLimiter({
      ipRequestLimit: 1,
      ipWindowMs: minuteMs,
      clientDailyLimit: 2,
    });

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    expectRejected(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }), 60);
    clock.advance(minuteMs);
    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    clock.advance(minuteMs);

    expectRejected(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }), 43_080);
  });

  it("удерживает один активный слот клиента и освобождает его явно", () => {
    const { limiter } = createLimiter();
    const first = expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }));

    expectRejected(acquireGeneration(limiter, { ip: "ip-b", clientId: "client-a" }));
    first.release();

    expectAllowed(acquireGeneration(limiter, { ip: "ip-b", clientId: "client-a" })).release();
  });

  it("блокирует неизвестного клиента при активном запросе того же IP", () => {
    const { limiter } = createLimiter({
      ipRequestLimit: 2,
      clientDailyLimit: 1,
    });
    const establishedClient = expectAllowed(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-a",
        hasValidClientCookie: true,
      }),
    );

    expectRejected(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-b",
        hasValidClientCookie: false,
      }),
    );
    establishedClient.release();

    expectAllowed(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-b",
        hasValidClientCookie: false,
      }),
    ).release();
  });

  it("допускает другого установленного клиента того же IP", () => {
    const { limiter } = createLimiter();
    const first = expectAllowed(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-a",
        hasValidClientCookie: true,
      }),
    );
    const second = expectAllowed(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-b",
        hasValidClientCookie: true,
      }),
    );

    first.release();
    second.release();
  });

  it("удерживает active-IP до завершения последнего установленного клиента", () => {
    const { limiter } = createLimiter({ ipRequestLimit: 10 });
    const first = expectAllowed(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-a",
        hasValidClientCookie: true,
      }),
    );
    const second = expectAllowed(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-b",
        hasValidClientCookie: true,
      }),
    );

    first.release();
    expectRejected(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-c",
        hasValidClientCookie: false,
      }),
    );
    second.release();

    expectAllowed(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-c",
        hasValidClientCookie: false,
      }),
    ).release();
  });

  it("учитывает active-IP в ограничении ёмкости", () => {
    const { limiter } = createLimiter({ stateCapacity: 3 });

    expectRejected(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-a",
        hasValidClientCookie: true,
      }),
    );
  });

  it("не позволяет старому release освободить новый слот", () => {
    const { limiter } = createLimiter();
    const first = expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }));
    first.release();
    const second = expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }));

    first.release();

    expectRejected(
      acquireGeneration(limiter, {
        ip: "ip-a",
        clientId: "client-b",
        hasValidClientCookie: false,
      }),
    );
    expectRejected(acquireGeneration(limiter, { ip: "ip-b", clientId: "client-a" }));
    second.release();
  });

  it("вычисляет Retry-After по наиболее позднему известному сроку", () => {
    const { clock, limiter } = createLimiter(
      { ipRequestLimit: 1, clientDailyLimit: 1 },
      Date.UTC(2026, 6, 27, 23, 59, 30),
    );

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    clock.advance(10_000);

    expectRejected(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }), 50);
  });

  it("не возвращает Retry-After при занятом слоте или исчерпанной ёмкости", () => {
    const { limiter } = createLimiter({
      ipRequestLimit: 1,
      clientDailyLimit: 1,
      stateCapacity: 4,
    });
    const first = expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }));

    expectRejected(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }));
    expectRejected(acquireGeneration(limiter, { ip: "ip-b", clientId: "client-b" }));
    first.release();
  });

  it("ограничивает состояние и действует fail closed без удаления актуальных записей", () => {
    const { limiter } = createLimiter({
      ipRequestLimit: 2,
      clientDailyLimit: 2,
      stateCapacity: 5,
    });

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    expectRejected(acquireGeneration(limiter, { ip: "ip-b", clientId: "client-b" }));
    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    expectRejected(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }));
  });

  it("очищает истёкшие IP- и суточные записи при следующем обращении", () => {
    const { clock, limiter } = createLimiter({
      ipRequestLimit: 1,
      clientDailyLimit: 1,
      stateCapacity: 4,
    });

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
    clock.advance(dayMs);

    expectAllowed(acquireGeneration(limiter, { ip: "ip-b", clientId: "client-b" })).release();
  });

  it("не оставляет завершённый active-слот в ограниченном состоянии", () => {
    const { limiter } = createLimiter({
      ipRequestLimit: 2,
      clientDailyLimit: 2,
      stateCapacity: 5,
    });

    const first = expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" }));
    first.release();

    expectAllowed(acquireGeneration(limiter, { ip: "ip-a", clientId: "client-a" })).release();
  });
});
