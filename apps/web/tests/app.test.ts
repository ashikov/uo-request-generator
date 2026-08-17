// @vitest-environment happy-dom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initialDescription = "На тестовой площадке не работает освещение";
const initialLocation = "Учебная зона";
const initialConsequences = "В вечернее время проход затруднён";
const initialDesiredActions = "Проверить и восстановить освещение";

type CaptchaRenderOptions = {
  sitekey: string;
  invisible: boolean;
  hideShield: boolean;
  callback: (token: string) => void;
};

function createCaptchaApi() {
  const eventCallbacks = new Map<string, () => void>();
  return {
    render: vi.fn((_container: HTMLElement, _options: CaptchaRenderOptions) => 23),
    execute: vi.fn(),
    reset: vi.fn(),
    subscribe: vi.fn((_widgetId: number, event: string, callback: () => void) => {
      eventCallbacks.set(event, callback);
      return () => eventCallbacks.delete(event);
    }),
    eventCallbacks,
  };
}

function smartCaptchaCallbackNameFromScript(script: HTMLScriptElement): string {
  const callbackName = new URL(script.src).searchParams.get("onload");
  if (callbackName === null) {
    throw new Error("Expected SmartCaptcha onload callback in script URL");
  }
  return callbackName;
}

function invokeWindowCallback(callbackName: string): void {
  const callback = Reflect.get(window, callbackName);
  if (typeof callback === "function") {
    callback();
  }
}

async function initializeApp(
  locationValue = "",
  locationMaxLength = 120,
  consequencesValue = "",
  desiredActionsValue = "",
  contextMaxLength = 500,
  captchaOptions: {
    config?: unknown;
    api?: ReturnType<typeof createCaptchaApi>;
    fetch?: typeof fetch;
    initialize?: boolean;
  } = {},
): Promise<void> {
  document.body.innerHTML = `
    <form id="request-form">
      <textarea
        id="description"
        minlength="10"
        maxlength="2000"
        aria-describedby="description-hint description-count"
      ></textarea>
      <input
        id="location"
        maxlength="${locationMaxLength}"
        value="${locationValue}"
        aria-describedby="location-hint location-count"
      />
      <textarea
        id="consequences"
        maxlength="${contextMaxLength}"
        aria-describedby="consequences-hint consequences-count"
      >${consequencesValue}</textarea>
      <textarea
        id="desired-actions"
        maxlength="${contextMaxLength}"
        aria-describedby="desired-actions-hint desired-actions-count"
      >${desiredActionsValue}</textarea>
      <select
        id="confirmed-problem-subject"
        name="confirmedProblemSubject"
        aria-describedby="confirmed-problem-subject-hint confirmed-problem-subject-context"
      >
        <option value="">Не выбрано</option>
        <option
          value="common_area_entrance_door"
          data-subject-hint="Подходит для входной двери МКД или двери помещения общего пользования. Не относится к двери квартиры или частного помещения."
        >
          Входная дверь
        </option>
        <option
          value="common_area_premises_lighting"
          data-subject-hint="Подходит для освещения помещений общего пользования МКД. Не относится к освещению внутри квартиры, придомовому, уличному или фасадному освещению."
        >
          Освещение
        </option>
        <option
          value="common_area_premises_cleaning"
          data-subject-hint="Подходит для уборки подъезда, лестничной площадки, коридора, холла и других помещений общего пользования МКД. Не относится к квартире, придомовой территории, контейнерной площадке или вывозу ТКО."
        >
          Уборка
        </option>
        <option
          value="common_area_roof"
          data-subject-hint="Подходит только если известно, что проблема относится именно к кровле МКД. Не выбирайте этот пункт только из-за протечки, мокрого потолка или пятна, если источник воды не установлен."
        >
          Кровля
        </option>
        <option
          value="common_area_ventilation"
          data-subject-hint="Подходит только для явно известной проблемы с системой вентиляции или вентиляционным каналом/шахтой общего имущества МКД, обслуживающими более одного помещения. Духота, жара, запах или влажность сами по себе не подтверждают проблему вентиляции. Не относится к вентиляции внутри одной квартиры, дымовым каналам или газовому оборудованию."
        >
          Вентиляция
        </option>
        <option
          value="common_area_elevator"
          data-subject-hint="Подходит, когда проблема явно относится к лифту, лифтовой шахте или лифтовому оборудованию МКД. Косвенные признаки сами по себе не подтверждают проблему с лифтом; сервис не определяет техническую причину или аварийность."
        >
          Лифт
        </option>
      </select>
      <span id="confirmed-problem-subject-hint">
        Выберите только точный предмет проблемы.
      </span>
      <span id="confirmed-problem-subject-context" role="status" aria-live="polite" hidden></span>
      <div id="captcha-container"></div>
      <p id="captcha-notice" hidden>
        Этот сайт защищён Yandex SmartCaptcha.
        <a href="https://yandex.ru/legal/smartcaptcha_notice/ru/">Уведомление об условиях обработки данных сервисом</a>
      </p>
      <button id="submit-button" type="submit">Составить заявку</button>
    </form>
    <div id="error-area" hidden tabindex="-1"></div>
    <div id="result-area">
      <h2 id="result-title">Готовая заявка</h2>
      <p id="result-placeholder">Здесь появится результат после успешной генерации.</p>
    </div>
    <span id="description-hint">Опишите одну проблему обычными словами</span>
    <span id="description-count">0 / 2000</span>
    <span id="location-count">0 / ${locationMaxLength}</span>
    <span id="consequences-count">0 / ${contextMaxLength}</span>
    <span id="desired-actions-count">0 / ${contextMaxLength}</span>
  `;

  Reflect.deleteProperty(window, "smartCaptcha");
  if (captchaOptions.api !== undefined) {
    Object.assign(window, { smartCaptcha: captchaOptions.api });
  }
  vi.stubGlobal(
    "fetch",
    captchaOptions.fetch ??
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(captchaOptions.config ?? { required: false }),
      }),
  );

  const appModule = await import("../public/app.js");
  if (captchaOptions.initialize !== false) {
    await appModule.initializeCaptcha();
  }
}

function getDescription(): HTMLTextAreaElement {
  return document.getElementById("description") as HTMLTextAreaElement;
}

function getLocation(): HTMLInputElement {
  return document.getElementById("location") as HTMLInputElement;
}

function getConsequences(): HTMLTextAreaElement {
  return document.getElementById("consequences") as HTMLTextAreaElement;
}

function getDesiredActions(): HTMLTextAreaElement {
  return document.getElementById("desired-actions") as HTMLTextAreaElement;
}

function getConfirmedProblemSubject(): HTMLSelectElement {
  return document.getElementById("confirmed-problem-subject") as HTMLSelectElement;
}

function getConfirmedProblemSubjectHint(): HTMLElement {
  return document.getElementById("confirmed-problem-subject-hint") as HTMLElement;
}

function getConfirmedProblemSubjectContext(): HTMLElement {
  return document.getElementById("confirmed-problem-subject-context") as HTMLElement;
}

function getErrorArea(): HTMLElement {
  return document.getElementById("error-area") as HTMLElement;
}

function getSubmitButton(): HTMLButtonElement {
  return document.getElementById("submit-button") as HTMLButtonElement;
}

function getCopyButton(): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Скопировать заявку",
    ) ?? null
  );
}

function getCaptchaNotice(): HTMLElement {
  return document.getElementById("captcha-notice") as HTMLElement;
}

function getForm(): HTMLFormElement {
  return document.getElementById("request-form") as HTMLFormElement;
}

function getLocationCount(): HTMLElement {
  return document.getElementById("location-count") as HTMLElement;
}

function getConsequencesCount(): HTMLElement {
  return document.getElementById("consequences-count") as HTMLElement;
}

function getDesiredActionsCount(): HTMLElement {
  return document.getElementById("desired-actions-count") as HTMLElement;
}

function submitForm(): void {
  (document.getElementById("request-form") as HTMLFormElement).dispatchEvent(
    new Event("submit", { cancelable: true }),
  );
}

function setFormValues(
  description = initialDescription,
  location = initialLocation,
  consequences = "",
  desiredActions = "",
): void {
  getDescription().value = description;
  getLocation().value = location;
  getConsequences().value = consequences;
  getDesiredActions().value = desiredActions;
}

function expectFormValues(
  description = initialDescription,
  location = initialLocation,
  consequences = "",
  desiredActions = "",
): void {
  expect(getDescription().value).toBe(description);
  expect(getLocation().value).toBe(location);
  expect(getConsequences().value).toBe(consequences);
  expect(getDesiredActions().value).toBe(desiredActions);
}

function expectDescriptionDescribedBy(...expectedIds: string[]): void {
  const describedBy = getDescription().getAttribute("aria-describedby");
  const ids = describedBy?.split(/\s+/) ?? [];

  expect(ids).toEqual(expectedIds);
  expect(new Set(ids).size).toBe(ids.length);
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("уведомление SmartCaptcha", () => {
  it("показывает уведомление только при включённой CAPTCHA и не загружает внешний script", async () => {
    await initializeApp("", 120, "", "", 500, {
      config: { required: true, clientKey: "test-public-client-key" },
      initialize: false,
    });

    await vi.waitFor(() => expect(getCaptchaNotice().hidden).toBe(false));
    expect(document.querySelector('script[src*="smartcaptcha"]')).toBeNull();
  });

  it("не показывает уведомление при отключённой CAPTCHA", async () => {
    await initializeApp("", 120, "", "", 500, { initialize: false });

    await vi.waitFor(() => expect(getCaptchaNotice().hidden).toBe(true));
  });

  it("не показывает уведомление при недостоверной публичной конфигурации", async () => {
    await initializeApp("", 120, "", "", 500, {
      config: { required: true },
      initialize: false,
    });

    await vi.waitFor(() => expect(getCaptchaNotice().hidden).toBe(true));
  });

  it("не показывает уведомление при недоступной публичной конфигурации", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("temporary configuration failure"));
    await initializeApp("", 120, "", "", 500, {
      fetch: fetchMock,
      initialize: false,
    });

    await vi.waitFor(() => expect(getCaptchaNotice().hidden).toBe(true));
  });
});

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

  it("инициализирует и обновляет счётчики дополнительных полей", async () => {
    vi.resetModules();
    await initializeApp("", 120, "Проход затруднён", "Проверить освещение", 77);

    expect(getConsequencesCount().textContent).toBe("16 / 77");
    expect(getDesiredActionsCount().textContent).toBe("19 / 77");
    expect(getConsequences().getAttribute("aria-describedby")).toBe(
      "consequences-hint consequences-count",
    );
    expect(getDesiredActions().getAttribute("aria-describedby")).toBe(
      "desired-actions-hint desired-actions-count",
    );

    getConsequences().value = "Известно";
    getDesiredActions().value = "Проверить";
    getConsequences().dispatchEvent(new Event("input"));
    getDesiredActions().dispatchEvent(new Event("input"));

    expect(getConsequencesCount().textContent).toBe("8 / 77");
    expect(getDesiredActionsCount().textContent).toBe("9 / 77");
  });

  it("содержит предметный выбор с актуальным пояснением и доступностью", () => {
    expect(getConfirmedProblemSubject().getAttribute("aria-describedby")).toBe(
      "confirmed-problem-subject-hint confirmed-problem-subject-context",
    );
    expect(getConfirmedProblemSubject().value).toBe("");
    expect(
      Array.from(getConfirmedProblemSubject().options).map((option) => option.textContent?.trim()),
    ).toEqual([
      "Не выбрано",
      "Входная дверь",
      "Освещение",
      "Уборка",
      "Кровля",
      "Вентиляция",
      "Лифт",
    ]);
    expect(getConfirmedProblemSubjectHint().textContent?.trim()).toBe(
      "Выберите только точный предмет проблемы.",
    );
  });

  it("показывает пояснение только для выбранного предмета проблемы", () => {
    const subjectSelect = getConfirmedProblemSubject();
    const contextHint = getConfirmedProblemSubjectContext();

    expect(subjectSelect.value).toBe("");
    expect(getConfirmedProblemSubjectHint().textContent?.trim()).toBe(
      "Выберите только точный предмет проблемы.",
    );
    expect(contextHint.hidden).toBe(true);

    subjectSelect.value = "common_area_entrance_door";
    subjectSelect.dispatchEvent(new Event("change"));
    expect(contextHint.hidden).toBe(false);
    expect(contextHint.textContent).toContain("входной двери МКД");
    expect(contextHint.textContent).toContain("двери квартиры");
    expect(contextHint.textContent).toContain("частного помещения");

    subjectSelect.value = "common_area_premises_lighting";
    subjectSelect.dispatchEvent(new Event("change"));
    expect(contextHint.textContent).toContain("освещения помещений общего пользования МКД");
    expect(contextHint.textContent).toContain("освещению внутри квартиры");
    expect(contextHint.textContent).toContain("придомовому, уличному или фасадному освещению");
    expect(contextHint.textContent).not.toContain("входной двери МКД");

    subjectSelect.value = "common_area_premises_cleaning";
    subjectSelect.dispatchEvent(new Event("change"));
    expect(contextHint.textContent).toContain("уборки подъезда");
    expect(contextHint.textContent).toContain("лестничной площадки");
    expect(contextHint.textContent).toContain("коридора, холла");
    expect(contextHint.textContent).toContain("придомовой территории");
    expect(contextHint.textContent).toContain("контейнерной площадке или вывозу ТКО");
    expect(contextHint.textContent).not.toContain("освещения помещений");

    subjectSelect.value = "common_area_roof";
    subjectSelect.dispatchEvent(new Event("change"));
    expect(contextHint.textContent).toContain("именно к кровле МКД");
    expect(contextHint.textContent).toContain("протечки, мокрого потолка или пятна");
    expect(contextHint.textContent).toContain("источник воды не установлен");
    expect(contextHint.textContent).not.toContain("уборки подъезда");

    subjectSelect.value = "common_area_ventilation";
    subjectSelect.dispatchEvent(new Event("change"));
    expect(contextHint.textContent).toContain("системой вентиляции");
    expect(contextHint.textContent).toContain("вентиляционным каналом/шахтой общего имущества МКД");
    expect(contextHint.textContent).toContain("обслуживающими более одного помещения");
    expect(contextHint.textContent).toContain("Духота, жара, запах или влажность");
    expect(contextHint.textContent).toContain("вентиляции внутри одной квартиры");
    expect(contextHint.textContent).not.toContain("именно к кровле МКД");

    subjectSelect.value = "common_area_elevator";
    subjectSelect.dispatchEvent(new Event("change"));
    expect(contextHint.textContent).toContain("явно относится к лифту");
    expect(contextHint.textContent).toContain("Косвенные признаки");
    expect(contextHint.textContent).toContain("не определяет техническую причину или аварийность");
    expect(contextHint.textContent).not.toContain("системой вентиляции");

    subjectSelect.value = "";
    subjectSelect.dispatchEvent(new Event("change"));
    expect(contextHint.hidden).toBe(true);
    expect(contextHint.textContent).toBe("");
  });

  it("не отправляет пустые дополнительные поля", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues(initialDescription, initialLocation, "   ", "");

    submitForm();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      description: initialDescription,
      location: initialLocation,
    });
  });

  it("не отправляет подтверждение предмета при отсутствии выбора", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues(initialDescription, initialLocation);
    getConfirmedProblemSubject().value = "";

    submitForm();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      description: initialDescription,
      location: initialLocation,
    });
  });

  it("отправляет каждое дополнительное поле отдельно и вместе", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    setFormValues(initialDescription, "", "Проход затруднён");
    submitForm();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getSubmitButton().disabled).toBe(false));

    setFormValues(initialDescription, "", "", "Проверить освещение");
    submitForm();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(getSubmitButton().disabled).toBe(false));

    setFormValues(initialDescription, "", "Проход затруднён", "Проверить освещение");
    submitForm();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      consequences: "Проход затруднён",
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      desiredActions: "Проверить освещение",
    });
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      consequences: "Проход затруднён",
      desiredActions: "Проверить освещение",
    });
  });

  it("отправляет явное подтверждение двери общего пользования только при выборе", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("Входная дверь подъезда не закрывается", "");
    getConfirmedProblemSubject().value = "common_area_entrance_door";

    submitForm();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      description: "Входная дверь подъезда не закрывается",
      confirmedProblemSubject: "common_area_entrance_door",
    });
  });

  it("отправляет явное подтверждение освещения помещения общего пользования", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("В общем коридоре многоквартирного дома не работает освещение", "");
    getConfirmedProblemSubject().value = "common_area_premises_lighting";

    submitForm();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      description: "В общем коридоре многоквартирного дома не работает освещение",
      confirmedProblemSubject: "common_area_premises_lighting",
    });
  });

  it("отправляет явное подтверждение уборки помещения общего пользования", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("В подъезде многоквартирного дома не выполнена уборка", "");
    getConfirmedProblemSubject().value = "common_area_premises_cleaning";

    submitForm();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      description: "В подъезде многоквартирного дома не выполнена уборка",
      confirmedProblemSubject: "common_area_premises_cleaning",
    });
  });

  it("отправляет явное подтверждение кровли многоквартирного дома", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("На кровле многоквартирного дома обнаружена протечка", "");
    getConfirmedProblemSubject().value = "common_area_roof";

    submitForm();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      description: "На кровле многоквартирного дома обнаружена протечка",
      confirmedProblemSubject: "common_area_roof",
    });
  });

  it("отправляет явное подтверждение лифта общего имущества", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("Лифт в многоквартирном доме не реагирует на вызов", "");
    getConfirmedProblemSubject().value = "common_area_elevator";

    submitForm();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      description: "Лифт в многоквартирном доме не реагирует на вызов",
      confirmedProblemSubject: "common_area_elevator",
    });
  });

  it.each([
    ["последствия", getConsequences, initialDesiredActions, "Последствия"],
    ["желаемые действия", getDesiredActions, initialConsequences, "Желаемые действия"],
  ])("блокирует слишком длинные %s до запроса и сохраняет дополнительные поля", async (_caseName, getField, otherValue, fieldLabel) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const value = "а".repeat(getField().maxLength + 1);
    const values = fieldLabel === "Последствия" ? [value, otherValue] : [otherValue, value];
    setFormValues(initialDescription, initialLocation, values[0], values[1]);

    submitForm();

    await expectError(`${fieldLabel} должны содержать не более ${getField().maxLength} символов`);
    expect(fetchMock).not.toHaveBeenCalled();
    expectFormValues(initialDescription, initialLocation, values[0], values[1]);
  });

  it("показывает локальную ошибку до сетевого запроса и сохраняет поля", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("Коротко", initialLocation, initialConsequences, initialDesiredActions);

    submitForm();

    await expectError("Описание должно содержать не менее 10 символов");
    expect(fetchMock).not.toHaveBeenCalled();
    expectFormValues("Коротко", initialLocation, initialConsequences, initialDesiredActions);
    expect(getDescription().getAttribute("aria-invalid")).toBe("true");
    expectDescriptionDescribedBy("description-hint", "description-count", "error-area");
  });

  it("снимает состояние ошибки описания после изменения значения", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network error"));
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("Коротко");

    submitForm();

    await expectError("Описание должно содержать не менее 10 символов");
    getDescription().value = initialDescription;
    getDescription().dispatchEvent(new Event("input"));

    expect(getDescription().getAttribute("aria-invalid")).toBeNull();
    expectDescriptionDescribedBy("description-hint", "description-count");

    submitForm();

    await expectError("Не удалось связаться с сервисом. Попробуйте позже");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getDescription().getAttribute("aria-invalid")).toBeNull();
    expectDescriptionDescribedBy("description-hint", "description-count");
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
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);
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
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);

    submitForm();

    await expectError("Не удалось связаться с сервисом. Попробуйте позже");
    expect(getErrorArea().textContent).not.toContain("некорректный ответ");
    expect(getDescription().getAttribute("aria-invalid")).toBeNull();
    expectDescriptionDescribedBy("description-hint", "description-count");
    expectFormValues(
      initialDescription,
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
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
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);

    submitForm();

    await expectError("Проверьте формат и содержание запроса");
    expect(getErrorArea().textContent).not.toContain("validation_error");
    expect(getErrorArea().textContent).not.toContain("test-request-id");
    expect(getDescription().getAttribute("aria-invalid")).toBeNull();
    expectDescriptionDescribedBy("description-hint", "description-count");
    expectFormValues(
      initialDescription,
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
  });

  it("обрабатывает multiple_issues без потери формы и допускает исправленную отправку", async () => {
    const multipleIssuesMessage =
      "Опишите одну проблему. Для каждой отдельной проблемы составьте отдельную заявку.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            title: "Предыдущая заявка",
            body: "Предыдущий текст заявки",
            warnings: [],
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: "multiple_issues",
              message: multipleIssuesMessage,
              requestId: "test-multiple-issues-request-id",
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            title: "Исправленная заявка",
            body: "Текст об одной связанной проблеме",
            warnings: [],
          }),
      });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);
    submitForm();
    await vi.waitFor(() => {
      expect(document.querySelector("#result-area h3")?.textContent).toBe("Предыдущая заявка");
    });

    setFormValues(
      "На площадке сломаны качели, а в соседнем дворе лежит старый диван",
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
    submitForm();

    await expectError(multipleIssuesMessage);
    expectFormValues(
      "На площадке сломаны качели, а в соседнем дворе лежит старый диван",
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
    expect(document.querySelector("#result-area h3")).toBeNull();
    expect(document.querySelector("#result-area p")?.id).toBe("result-placeholder");
    expect(getCopyButton()).toBeNull();
    expect(getErrorArea().textContent).not.toContain("multiple_issues");
    expect(getErrorArea().textContent).not.toContain("test-multiple-issues-request-id");

    setFormValues(
      "На детской площадке сломаны качели и торчат острые болты",
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
    submitForm();

    await vi.waitFor(() => {
      expect(document.querySelector("#result-area h3")?.textContent).toBe("Исправленная заявка");
      expect(getCopyButton()).not.toBeNull();
      expect(getSubmitButton().disabled).toBe(false);
      expect(getForm().getAttribute("aria-busy")).toBe("false");
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("принимает rate_limit_exceeded и показывает безопасное серверное сообщение", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: () =>
          Promise.resolve({
            error: {
              code: "rate_limit_exceeded",
              message: "Слишком много запросов. Попробуйте позже",
              requestId: "test-rate-limit-request-id",
            },
          }),
      }),
    );
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);

    submitForm();

    await expectError("Слишком много запросов. Попробуйте позже");
    expect(getErrorArea().textContent).not.toContain("rate_limit_exceeded");
    expect(getErrorArea().textContent).not.toContain("test-rate-limit-request-id");
    expectFormValues(
      initialDescription,
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
  });

  it("принимает generation_unavailable и показывает безопасное серверное сообщение", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: "generation_unavailable",
              message: "Генерация временно недоступна. Попробуйте позже",
              requestId: "test-generation-unavailable-request-id",
            },
          }),
      }),
    );
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);

    submitForm();

    await expectError("Генерация временно недоступна. Попробуйте позже");
    expect(getErrorArea().textContent).not.toContain("generation_unavailable");
    expect(getErrorArea().textContent).not.toContain("test-generation-unavailable-request-id");
    expectFormValues(
      initialDescription,
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
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
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);

    submitForm();

    await expectError("Не удалось составить заявку");
    expect(getErrorArea().textContent).not.toContain(internalMessage);
    expectFormValues(
      initialDescription,
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
  });

  it("отделяет не-JSON ответ от сетевой ошибки и сохраняет поля", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      }),
    );
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);

    submitForm();

    await expectError("Сервис вернул некорректный ответ. Попробуйте позже");
    expect(getErrorArea().textContent).not.toContain("Не удалось связаться с сервисом");
    expectFormValues(
      initialDescription,
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
  });

  it("не отображает некорректный успешный результат и не создаёт кнопку копирования", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ title: "", body: "Текст заявки", warnings: [] }),
      }),
    );
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);

    submitForm();

    await expectError("Сервис вернул некорректный результат");
    expect(document.querySelector("#result-area h3")).toBeNull();
    expect(getCopyButton()).toBeNull();
    expectFormValues(
      initialDescription,
      initialLocation,
      initialConsequences,
      initialDesiredActions,
    );
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

    (getCopyButton() as HTMLButtonElement).click();

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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
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
      expect(getCopyButton()).not.toBeNull();
    });
    (getCopyButton() as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(document.querySelector(".copy-status")).not.toBeNull();
    });

    submitForm();

    expect(document.querySelector("#result-area h3")).toBeNull();
    expect(getCopyButton()).toBeNull();
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

  it("не загружает и не запускает CAPTCHA в отключённом режиме", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues();

    submitForm();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(document.querySelector('script[src*="smartcaptcha"]')).toBeNull();
    expect("smartCaptcha" in window).toBe(false);
  });

  it("не запускает CAPTCHA для невалидной формы", async () => {
    vi.resetModules();
    const captchaApi = createCaptchaApi();
    await initializeApp("", 120, "", "", 500, {
      config: { required: true, clientKey: "test-public-client-key" },
      api: captchaApi,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setFormValues("Коротко");

    submitForm();

    await expectError("Описание должно содержать не менее 10 символов");
    expect(captchaApi.execute).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("выполняет CAPTCHA и отправляет callback-токен ровно один раз", async () => {
    vi.resetModules();
    const captchaApi = createCaptchaApi();
    await initializeApp("", 120, "", "", 500, {
      config: { required: true, clientKey: "test-public-client-key" },
      api: captchaApi,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues(initialDescription, initialLocation, initialConsequences, initialDesiredActions);
    const callback = captchaApi.render.mock.calls[0]?.[1].callback;

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledOnce());
    submitForm();

    expect(captchaApi.render).toHaveBeenCalledWith(
      document.getElementById("captcha-container"),
      expect.objectContaining({
        sitekey: "test-public-client-key",
        invisible: true,
        hideShield: true,
      }),
    );
    expect(captchaApi.execute).toHaveBeenCalledOnce();
    expect(captchaApi.execute).toHaveBeenCalledWith(23);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSubmitButton().disabled).toBe(true);
    expect(getForm().getAttribute("aria-busy")).toBe("true");

    callback?.("test-captcha-token");
    callback?.("duplicate-token");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      description: initialDescription,
      location: initialLocation,
      consequences: initialConsequences,
      desiredActions: initialDesiredActions,
      captchaToken: "test-captcha-token",
    });
    await vi.waitFor(() => {
      expect(captchaApi.reset).toHaveBeenCalledWith(23);
      expect(getSubmitButton().disabled).toBe(false);
      expect(getForm().getAttribute("aria-busy")).toBe("false");
    });
  });

  it("выходит из loading при challenge-hidden", async () => {
    vi.resetModules();
    const captchaApi = createCaptchaApi();
    await initializeApp("", 120, "", "", 500, {
      config: { required: true, clientKey: "test-public-client-key" },
      api: captchaApi,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setFormValues();

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledOnce());
    captchaApi.eventCallbacks.get("challenge-hidden")?.();

    await expectError("Проверка временно недоступна. Попробуйте позже");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("выходит из loading по timeout и позволяет начать следующую попытку", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const captchaApi = createCaptchaApi();
    await initializeApp("", 120, "", "", 500, {
      config: { required: true, clientKey: "test-public-client-key" },
      api: captchaApi,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues();
    const callback = captchaApi.render.mock.calls[0]?.[1].callback;

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(120_000);
    await expectError("Проверка временно недоступна. Попробуйте позже");
    callback?.("late-token");
    expect(fetchMock).not.toHaveBeenCalled();

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledTimes(2));
    callback?.("token-after-timeout");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      captchaToken: "token-after-timeout",
    });
    vi.useRealTimers();
  });

  it("повторяет временно недоступную конфигурацию при следующем submit", async () => {
    vi.resetModules();
    const captchaApi = createCaptchaApi();
    let configRequests = 0;
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      if (String(input) === "/api/captcha/config") {
        configRequests++;
        if (configRequests <= 2) {
          return Promise.reject(new Error("temporary configuration failure"));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ required: true, clientKey: "test-public-client-key" }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
      });
    });
    await initializeApp("", 120, "", "", 500, {
      api: captchaApi,
      fetch: fetchMock as typeof fetch,
      initialize: false,
    });
    await vi.waitFor(() => expect(configRequests).toBe(1));
    setFormValues();

    submitForm();
    await expectError("Проверка временно недоступна. Попробуйте позже");
    expect(captchaApi.execute).not.toHaveBeenCalled();

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledOnce());
    captchaApi.render.mock.calls[0]?.[1].callback("token-after-config-retry");

    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === "/api/generate"),
      ).toHaveLength(1),
    );
    expect(configRequests).toBe(3);
    expect(captchaApi.render).toHaveBeenCalledOnce();
  });

  it("повторяет загрузку SmartCaptcha script при следующем submit", async () => {
    vi.resetModules();
    const captchaApi = createCaptchaApi();
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      if (String(input) === "/api/captcha/config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ required: true, clientKey: "test-public-client-key" }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
      });
    });
    let scriptAttempt = 0;
    const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      scriptAttempt++;
      const script = nodes[0] as HTMLScriptElement;
      if (scriptAttempt === 1) {
        queueMicrotask(() => script.onerror?.(new Event("error")));
        return;
      }

      Object.assign(window, { smartCaptcha: captchaApi });
      const callbackName = smartCaptchaCallbackNameFromScript(script);
      queueMicrotask(() => invokeWindowCallback(callbackName));
    });
    await initializeApp("", 120, "", "", 500, {
      fetch: fetchMock as typeof fetch,
      initialize: false,
    });
    setFormValues();

    submitForm();
    await expectError("Проверка временно недоступна. Попробуйте позже");
    expect(captchaApi.execute).not.toHaveBeenCalled();

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledOnce());
    captchaApi.render.mock.calls[0]?.[1].callback("token-after-script-retry");

    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input) === "/api/generate"),
      ).toHaveLength(1),
    );
    expect(append).toHaveBeenCalledTimes(2);
    expect(captchaApi.render).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "captcha_failed",
      {
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: "captcha_failed",
              message: "Не удалось выполнить проверку. Попробуйте ещё раз",
              requestId: "test-captcha-failed-request-id",
            },
          }),
      },
      "Не удалось выполнить проверку. Попробуйте ещё раз",
    ],
    [
      "captcha_unavailable",
      {
        ok: false,
        json: () =>
          Promise.resolve({
            error: {
              code: "captcha_unavailable",
              message: "Проверка временно недоступна. Попробуйте позже",
              requestId: "test-captcha-unavailable-request-id",
            },
          }),
      },
      "Проверка временно недоступна. Попробуйте позже",
    ],
    [
      "сетевая ошибка",
      new Error("network unavailable"),
      "Не удалось связаться с сервисом. Попробуйте позже",
    ],
  ])("сбрасывает CAPTCHA после исхода: %s", async (_caseName, outcome, message) => {
    vi.resetModules();
    const captchaApi = createCaptchaApi();
    await initializeApp("", 120, "", "", 500, {
      config: { required: true, clientKey: "test-public-client-key" },
      api: captchaApi,
    });
    const fetchMock =
      outcome instanceof Error
        ? vi.fn().mockRejectedValue(outcome)
        : vi.fn().mockResolvedValue(outcome);
    vi.stubGlobal("fetch", fetchMock);
    setFormValues();
    const callback = captchaApi.render.mock.calls[0]?.[1].callback;

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledOnce());
    callback?.("test-captcha-token");

    await expectError(message);
    expect(captchaApi.reset).toHaveBeenCalledWith(23);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("требует новый токен для следующей попытки", async () => {
    vi.resetModules();
    const captchaApi = createCaptchaApi();
    await initializeApp("", 120, "", "", 500, {
      config: { required: true, clientKey: "test-public-client-key" },
      api: captchaApi,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ title: "Заявка", body: "Текст", warnings: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setFormValues();
    const callback = captchaApi.render.mock.calls[0]?.[1].callback;

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledOnce());
    callback?.("first-token");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getSubmitButton().disabled).toBe(false));

    submitForm();
    await vi.waitFor(() => expect(captchaApi.execute).toHaveBeenCalledTimes(2));
    expect(captchaApi.execute).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    callback?.("second-token");

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      captchaToken: "second-token",
    });
  });

  it("не отправляет запрос при некорректной публичной конфигурации", async () => {
    vi.resetModules();
    await initializeApp("", 120, "", "", 500, {
      config: { required: true },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setFormValues();

    submitForm();

    await expectError("Проверка временно недоступна. Попробуйте позже");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/captcha/config", {
      headers: { accept: "application/json" },
    });
  });
});
