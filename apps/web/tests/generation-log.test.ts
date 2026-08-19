import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFailSafeGenerationEventWriter,
  type GenerationEventWriter,
  type GenerationLogEvent,
  writeGenerationEventToStdout,
} from "../src/generation-log";

type AsyncWriterIsAccepted = ((
  event: GenerationLogEvent,
) => Promise<void>) extends GenerationEventWriter
  ? true
  : false;

const event = {
  event: "generation_started",
  requestId: "test-request-id",
  timestamp: "2026-08-15T00:00:00.000Z",
} satisfies GenerationLogEvent;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("запись событий генерации", () => {
  it("не допускает асинхронный writer синхронным контрактом", () => {
    // Дано
    const asyncWriterIsAccepted: AsyncWriterIsAccepted = false;

    // Когда и тогда
    expect(asyncWriterIsAccepted).toBe(false);
  });

  it("пишет событие в stdout через файловый дескриптор 1", () => {
    // Дано
    const writeSync = vi
      .spyOn(fs, "writeSync")
      .mockImplementation((_fileDescriptor, line) => Buffer.byteLength(String(line)));

    // Когда
    writeGenerationEventToStdout(event);

    // Тогда
    expect(writeSync).toHaveBeenCalledExactlyOnceWith(1, `${JSON.stringify(event)}\n`);
  });

  it("пишет безопасную диагностику в файловый дескриптор 2 при сбое stdout", () => {
    // Дано
    const writeSync = vi
      .spyOn(fs, "writeSync")
      .mockImplementationOnce(() => {
        throw new Error("stdout failed");
      })
      .mockImplementationOnce((_fileDescriptor, line) => Buffer.byteLength(String(line)));
    const writer = createFailSafeGenerationEventWriter(writeGenerationEventToStdout);
    const fallback = `${JSON.stringify({
      event: "generation_event_write_failed",
      requestId: event.requestId,
      failedEvent: event.event,
    })}\n`;

    // Когда
    writer(event);

    // Тогда
    expect(writeSync).toHaveBeenNthCalledWith(1, 1, `${JSON.stringify(event)}\n`);
    expect(writeSync).toHaveBeenNthCalledWith(2, 2, fallback);
  });

  it("пишет fallback-диагностику при неполной записи события в stdout", () => {
    // Дано
    const eventLine = `${JSON.stringify(event)}\n`;
    const fallback = `${JSON.stringify({
      event: "generation_event_write_failed",
      requestId: event.requestId,
      failedEvent: event.event,
    })}\n`;
    const writeSync = vi
      .spyOn(fs, "writeSync")
      .mockImplementationOnce(() => Buffer.byteLength(eventLine) - 1)
      .mockImplementationOnce((_fileDescriptor, line) => Buffer.byteLength(String(line)));
    const writer = createFailSafeGenerationEventWriter(writeGenerationEventToStdout);

    // Когда
    writer(event);

    // Тогда
    expect(writeSync).toHaveBeenNthCalledWith(1, 1, eventLine);
    expect(writeSync).toHaveBeenNthCalledWith(2, 2, fallback);
  });

  it("не выбрасывает ошибку, если записи в оба файловых дескриптора завершились сбоем", () => {
    // Дано
    const writeSync = vi.spyOn(fs, "writeSync").mockImplementation(() => {
      throw new Error("file descriptor write failed");
    });
    const writer = createFailSafeGenerationEventWriter(writeGenerationEventToStdout);

    // Когда и тогда
    expect(() => writer(event)).not.toThrow();
    expect(writeSync).toHaveBeenCalledTimes(2);
  });
});
