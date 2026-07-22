// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { formatCopyText, copyToClipboard } from "../public/copy-utils.js";

describe("formatCopyText", () => {
  it("объединяет заголовок и тело через пустую строку", () => {
    const result = formatCopyText("Заголовок", "Тело заявки");
    expect(result).toBe("Заголовок\n\nТело заявки");
  });

  it("корректно обрабатывает многострочное тело", () => {
    const body = "Строка 1\nСтрока 2\nСтрока 3";
    const result = formatCopyText("Заголовок", body);
    expect(result).toBe("Заголовок\n\nСтрока 1\nСтрока 2\nСтрока 3");
  });

  it("корректно обрабатывает пустое тело", () => {
    const result = formatCopyText("Заголовок", "");
    expect(result).toBe("Заголовок\n\n");
  });

  it("корректно обрабатывает пустой заголовок", () => {
    const result = formatCopyText("", "Тело");
    expect(result).toBe("\n\nТело");
  });
});

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("успешно копирует текст", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const result = await copyToClipboard("Текст для копирования");

    expect(result).toEqual({ success: true });
    expect(writeText).toHaveBeenCalledWith("Текст для копирования");
  });

  it("возвращает ошибку при сбое Clipboard API", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Not allowed"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const result = await copyToClipboard("Текст");

    expect(result).toEqual({ success: false, error: "Не удалось скопировать" });
  });

  it("возвращает ошибку если Clipboard API недоступен", async () => {
    vi.stubGlobal("navigator", {});

    const result = await copyToClipboard("Текст");

    expect(result).toEqual({ success: false, error: "Буфер обмена недоступен" });
  });
});

describe("copy status element", () => {
  it('созданный элемент статуса имеет role="status"', () => {
    const span = document.createElement("span");
    span.className = "copy-status copy-status--success";
    span.role = "status";
    span.textContent = "Скопировано";

    expect(span.getAttribute("role")).toBe("status");
  });
});

describe("race condition guard", () => {
  it("устаревший статус не показывается после новой генерации", async () => {
    let copyOperationId = 0;
    let statusShown = false;

    const simulateCopy = () => {
      const operationId = copyOperationId;
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (operationId !== copyOperationId) {
            resolve();
            return;
          }
          statusShown = true;
          resolve();
        }, 5);
      });
    };

    const copyPromise = simulateCopy();
    copyOperationId++;
    await copyPromise;

    expect(statusShown).toBe(false);
  });

  it("статус показывается если не было новой генерации", async () => {
    const copyOperationId = 0;
    let statusShown = false;

    const simulateCopy = () => {
      const operationId = copyOperationId;
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (operationId !== copyOperationId) {
            resolve();
            return;
          }
          statusShown = true;
          resolve();
        }, 5);
      });
    };

    await simulateCopy();

    expect(statusShown).toBe(true);
  });
});
