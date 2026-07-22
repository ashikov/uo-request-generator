// @vitest-environment happy-dom
/// <reference lib="dom" />
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
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

const mockResult = {
  title: "Заголовок заявки",
  body: "Тело заявки",
  warnings: [],
};

function setupFormDOM() {
  document.body.innerHTML = `
    <form id="request-form">
      <textarea id="description" minlength="10" maxlength="500">
        Описание неисправности для проверки работы формы
      </textarea>
      <input id="location" maxlength="200" />
      <button id="submit-button" type="submit">Составить заявку</button>
    </form>
    <div id="error-area" hidden></div>
    <div id="result-area">
      <h2 id="result-title">Результат</h2>
      <p id="result-placeholder">Заполните форму</p>
    </div>
    <span id="description-count">0 / 500</span>
  `;
}

describe("copy button in app", () => {
  beforeAll(() => {
    setupFormDOM();
    return import("../public/app.js");
  });

  beforeEach(() => {
    const textarea = document.getElementById("description") as HTMLTextAreaElement;
    textarea.value = "Описание неисправности для проверки работы формы";
    (document.getElementById("location") as HTMLInputElement).value = "";
    const submitBtn = document.getElementById("submit-button") as HTMLButtonElement;
    submitBtn.disabled = false;
    submitBtn.textContent = "Составить заявку";

    const errorArea = document.getElementById("error-area") as HTMLElement;
    errorArea.textContent = "";
    errorArea.hidden = true;

    const resultArea = document.getElementById("result-area") as HTMLElement;
    const resultTitle = document.getElementById("result-title") as HTMLElement;
    const resultPlaceholder = document.getElementById("result-placeholder") as HTMLElement;
    resultArea.replaceChildren(resultTitle, resultPlaceholder);

    const descriptionCount = document.getElementById("description-count") as HTMLElement;
    descriptionCount.textContent = "0 / 500";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }),
    );
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('добавляет role="status" элементу статуса после копирования', async () => {
    document.getElementById("request-form")?.dispatchEvent(new Event("submit"));

    await vi.waitFor(() => {
      expect(document.querySelector(".copy-button")).not.toBeNull();
    });

    (document.querySelector(".copy-button") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      const status = document.querySelector(".copy-status");
      expect(status).not.toBeNull();
      expect(status?.getAttribute("role")).toBe("status");
    });
  });

  it("не показывает старый статус после повторной отправки формы", async () => {
    const form = document.getElementById("request-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit"));

    await vi.waitFor(() => {
      expect(document.querySelector(".copy-button")).not.toBeNull();
    });

    (document.querySelector(".copy-button") as HTMLButtonElement).click();
    form.dispatchEvent(new Event("submit"));

    await vi.waitFor(() => {
      expect(document.querySelector(".copy-button")).not.toBeNull();
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(document.querySelector(".copy-status")).toBeNull();
  });
});
