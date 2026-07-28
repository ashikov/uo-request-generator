import { afterEach, describe, expect, it, vi } from "vitest";
import { createShutdown, SHUTDOWN_TIMEOUT_MS } from "../src/shutdown.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createShutdown", () => {
  it("завершает закрытие до таймаута и очищает таймер", async () => {
    vi.useFakeTimers();
    const close = vi.fn().mockResolvedValue(undefined);
    const setExitCode = vi.fn();
    const forceExit = vi.fn();
    const shutdown = createShutdown({ close, setExitCode, forceExit });

    await shutdown();

    expect(close).toHaveBeenCalledOnce();
    expect(setExitCode).not.toHaveBeenCalled();
    expect(forceExit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("устанавливает ненулевой код при ошибке закрытия и очищает таймер", async () => {
    vi.useFakeTimers();
    const close = vi.fn().mockRejectedValue(new Error("close failed"));
    const setExitCode = vi.fn();
    const forceExit = vi.fn();
    const shutdown = createShutdown({ close, setExitCode, forceExit });

    await shutdown();

    expect(setExitCode).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(forceExit).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("принудительно завершает процесс при синхронном исключении close", async () => {
    vi.useFakeTimers();
    const close: () => Promise<void> = vi.fn(() => {
      throw new Error("close failed synchronously");
    });
    const setExitCode = vi.fn();
    const forceExit = vi.fn();
    const shutdown = createShutdown({ close, setExitCode, forceExit });

    await shutdown();

    expect(close).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(forceExit).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("принудительно завершает зависшее закрытие после таймаута", async () => {
    vi.useFakeTimers();
    const close = vi.fn().mockReturnValue(new Promise<void>(() => undefined));
    const setExitCode = vi.fn();
    const forceExit = vi.fn();
    const shutdown = createShutdown({ close, setExitCode, forceExit });

    const shutdownPromise = shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);
    await shutdownPromise;

    expect(close).toHaveBeenCalledOnce();
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(forceExit).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("повторный вызов использует уже начатое закрытие", async () => {
    vi.useFakeTimers();
    let resolveClose: (() => void) | undefined;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    const shutdown = createShutdown({
      close,
      setExitCode: vi.fn(),
      forceExit: vi.fn(),
    });

    const first = shutdown();
    const second = shutdown();
    await vi.advanceTimersByTimeAsync(0);
    resolveClose?.();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("безопасно обрабатывает позднюю ошибку после принудительного завершения", async () => {
    vi.useFakeTimers();
    let rejectClose: ((reason: Error) => void) | undefined;
    const close = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectClose = reject;
        }),
    );
    const setExitCode = vi.fn();
    const forceExit = vi.fn();
    const shutdown = createShutdown({ close, setExitCode, forceExit });

    const shutdownPromise = shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);
    rejectClose?.(new Error("late close failure"));
    await shutdownPromise;

    expect(setExitCode).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("игнорирует позднее успешное закрытие после принудительного завершения", async () => {
    vi.useFakeTimers();
    let resolveClose: (() => void) | undefined;
    const close = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveClose = resolve;
        }),
    );
    const setExitCode = vi.fn();
    const forceExit = vi.fn();
    const shutdown = createShutdown({ close, setExitCode, forceExit });

    const shutdownPromise = shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);
    resolveClose?.();
    await shutdownPromise;

    expect(setExitCode).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
