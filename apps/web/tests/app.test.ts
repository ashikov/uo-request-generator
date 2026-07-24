// @vitest-environment happy-dom
/// <reference lib="dom" />
import { beforeEach, describe, expect, it, vi } from "vitest";

const initialDescription = "На тестовой площадке не работает освещение";
const initialLocation = "Учебная зона";

async function initializeApp(locationValue = "", locationMaxLength = 120): Promise<void> {
  document.body.innerHTML = `
    <form id="request-form">
      <textarea id="description" minlength="10" maxlength="2000"></textarea>
      <input
        id="location"
        maxlength="${locationMaxLength}"
        value="${locationValue}"
        aria-describedby="location-hint location-count"
      />
      <button id="submit-button" type="submit">Составить заявку</button>
    </form>
    <div id="error-area" hidden tabindex="-1"></div>
    <div id="result-area">
      <h2 id="result-title">Готовая заявка</h2>
      <p id="result-placeholder">Здесь появится результат после успешной генерации.</p>
    </div>
    <span id="description-count">0 / 2000</span>
    <span id="location-count">0 / ${locationMaxLength}</span>
  `;

  await import("../public/app.js");
}

function getDescription(): HTMLTextAreaElement {
  return document.getElementById("description") as HTMLTextAreaElement;
}

function getLocation(): HTMLInputElement {
  return document.getElementById("location") as HTMLInputElement;
}

function getErrorArea(): HTMLElement {
  return document.getElementById("error-area") as HTMLElement;
}

function getSubmitButton(): HTMLButtonElement {
  return document.getElementById("submit-button") as HTMLButtonElement;
}

function getForm(): HTMLFormElement {
  return document.getElementById("request-form") as HTMLFormElement;
}

function getLocationCount(): HTMLElement {
  return document.getElementById("location-count") as HTMLElement;
}

function submitForm(): void {
  (document.getElementById("request-form") as HTMLFormElement).dispatchEvent(
    new Event("submit", { cancelable: true }),
  );
}

function setFormValues(description = initialDescription, location = initialLocation): void {
  getDescription().value = description;
  getLocation().value = location;
}

function expectFormValues(description = initialDescription, location = initialLocation): void {
  expect(getDescription().value).toBe(description);
  expect(getLocation().value).toBe(location);
}

async function expectError(message: string): Promise<void> {
  await vi.waitFor(() => {
    expect(getErrorArea().textContent).toBe(message);
    expect(getErrorArea().hidden).toBe(false);
    expect(getSubmitButton().disabled).toBe(false);
    expect(getSubmitButton().textContent).toBe("Составить заявку");
    expect(getForm().getAttribute("aria-busy")).toBe("false");
  });
}

describe("обработка ответа генерации в приложении", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    await initializeApp();
  });

  it("показывает начальный счётчик location по текущему значению и maxlength", async () => {
    vi.resetModules();
    await initializeApp("Подъезд", 77);

    expect(getLocationCount().textContent).toBe("7 / 77");
    expect(getLocation().getAttribute("aria-describedby")).toBe("location-hint location-count");
  });

  it("обновляет счётчик location и берёт максимум из DOM-свойства", () => {
    getLocation().value = "Этаж";
    getLocation().maxLength = 37;

    getLocation().dispatchEvent(new Event("input"));

    expect(getLocationCount().textContent).toBe("4 / 37");
  });

  it("показывает локальную ошибку до сетевого запроса и сохраняет поля", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("Коротко");

    submitForm();

    await expectError("Описание должно содержать не менее 10 символов");
    expect(fetchMock).not.toHaveBeenCalled();
    expectFormValues("Коротко");
  });

  it("не удаляет предыдущий успешный результат при локально невалидной отправке", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            title: "Не работает освещение",
            body: "Прошу проверить освещение на тестовой площадке.",
            warnings: [],
          }),
      }),
    );
    setFormValues();
    submitForm();

    await vi.waitFor(() => {
      expect(document.querySelector("#result-area h3")?.textContent).toBe("Не работает освещение");
    });

    setFormValues("Коротко");
    submitForm();

    await expectError("Описание должно содержать не менее 10 символов");
    expect(document.querySelector("#result-area h3")?.textContent).toBe("Не работает освещение");
  });

  it("показывает сетевую ошибку только при исключении fetch и сохраняет поля", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unavailable")));
    setFormValues();

    submitForm();

    await expectError("Не удалось связаться с сервисом. Попробуйте позже");
    expect(getErrorArea().textContent).not.toContain("некорректный ответ");
    expectFormValues();
  });

  it("показывает контролируемое сообщение API и не раскрывает его служебные поля", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: "validation_error",
              message: "Проверьте формат и содержание запроса",
              requestId: "test-request-id",
            },
          }),
      }),
    );
    setFormValues();

    submitForm();

    await expectError("Проверьте формат и содержание запроса");
    expect(getErrorArea().textContent).not.toContain("validation_error");
    expect(getErrorArea().textContent).not.toContain("test-request-id");
    expectFormValues();
  });

  it("заменяет некорректную ошибку API безопасным общим сообщением", async () => {
    const internalMessage = "Внутренняя диагностическая строка";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: "unexpected_error",
              message: internalMessage,
            },
          }),
      }),
    );
    setFormValues();

    submitForm();

    await expectError("Не удалось составить заявку");
    expect(getErrorArea().textContent).not.toContain(internalMessage);
    expectFormValues();
  });

  it("отделяет не-JSON ответ от сетевой ошибки и сохраняет поля", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      }),
    );
    setFormValues();

    submitForm();

    await expectError("Сервис вернул некорректный ответ. Попробуйте позже");
    expect(getErrorArea().textContent).not.toContain("Не удалось связаться с сервисом");
    expectFormValues();
  });

  it("не отображает некорректный успешный результат и не создаёт кнопку копирования", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ title: "", body: "Текст заявки", warnings: [] }),
      }),
    );
    setFormValues();

    submitForm();

    await expectError("Сервис вернул некорректный результат");
    expect(document.querySelector("#result-area h3")).toBeNull();
    expect(document.querySelector(".copy-button")).toBeNull();
    expectFormValues();
  });

  it("отображает корректный результат и сохраняет работу кнопки копирования", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            title: "Не работает освещение",
            body: "Прошу проверить освещение на тестовой площадке.",
            warnings: [],
          }),
      }),
    );
    setFormValues();

    submitForm();

    await vi.waitFor(() => {
      expect(document.querySelector("#result-area h3")?.textContent).toBe("Не работает освещение");
    });
    expect(document.querySelector("#result-area p")?.textContent).toBe(
      "Прошу проверить освещение на тестовой площадке.",
    );
    expect(getErrorArea().hidden).toBe(true);

    (document.querySelector(".copy-button") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "Не работает освещение\n\nПрошу проверить освещение на тестовой площадке.",
      );
    });
  });

  it("блокирует повторный submit до завершения первого запроса", async () => {
    let resolveResponse: (value: Response) => void = () => {
      throw new Error("Обработчик Promise не инициализирован");
    };
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingResponse);
    vi.stubGlobal("fetch", fetchMock);
    setFormValues();

    submitForm();
    const placeholderAfterFirstSubmit = document.getElementById("result-placeholder");
    submitForm();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.getElementById("result-placeholder")).toBe(placeholderAfterFirstSubmit);
    expect(getSubmitButton().disabled).toBe(true);
    expect(getSubmitButton().textContent).toBe("Составляем…");
    expect(getForm().getAttribute("aria-busy")).toBe("true");

    resolveResponse({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    } as Response);

    await vi.waitFor(() => {
      expect(getSubmitButton().disabled).toBe(false);
      expect(getForm().getAttribute("aria-busy")).toBe("false");
    });
  });

  it("сбрасывает предыдущий результат и статус копирования при новом валидном запросе", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const successResponse = {
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    };
    let resolveResponse: (value: Response) => void = () => {
      throw new Error("Обработчик Promise не инициализирован");
    };
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(successResponse)
      .mockReturnValueOnce(pendingResponse);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    setFormValues();

    submitForm();
    await vi.waitFor(() => {
      expect(document.querySelector(".copy-button")).not.toBeNull();
    });
    (document.querySelector(".copy-button") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(document.querySelector(".copy-status")).not.toBeNull();
    });

    submitForm();

    expect(document.querySelector("#result-area h3")).toBeNull();
    expect(document.querySelector(".copy-button")).toBeNull();
    expect(document.querySelector(".copy-status")).toBeNull();
    expect(getSubmitButton().disabled).toBe(true);

    resolveResponse({
      ok: true,
      json: () => Promise.resolve({ title: "Новая заявка", body: "Новый текст", warnings: [] }),
    } as Response);

    await vi.waitFor(() => {
      expect(document.querySelector("#result-area h3")?.textContent).toBe("Новая заявка");
    });
  });
});
