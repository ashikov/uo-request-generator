// @vitest-environment happy-dom
/// <reference lib="dom" />
import { beforeEach, describe, expect, it, vi } from "vitest";

const initialDescription = "На тестовой площадке не работает освещение";
const initialLocation = "Учебная зона";

function setupFormDOM(): void {
  document.body.innerHTML = `
    <form id="request-form">
      <textarea id="description" minlength="10" maxlength="2000"></textarea>
      <input id="location" maxlength="120" />
      <button id="submit-button" type="submit">Составить заявку</button>
    </form>
    <div id="error-area" hidden tabindex="-1"></div>
    <div id="result-area">
      <h2 id="result-title">Готовая заявка</h2>
      <p id="result-placeholder">Здесь появится результат после успешной генерации.</p>
    </div>
    <span id="description-count">0 / 2000</span>
  `;
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
  });
}

describe("обработка ответа генерации в приложении", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    setupFormDOM();
    await import("../public/app.js");
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
});
