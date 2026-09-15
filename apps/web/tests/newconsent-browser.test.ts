// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true}}
/// <reference lib="dom" />
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const getController = vi.hoisted(() => vi.fn());
vi.mock("../public/smartcaptcha.js", () => ({
  createSmartCaptchaInitializer: () => ({
    getController,
    getPublicConfig: async () => ({ generationAvailable: true, required: false }),
  }),
}));
const receipt = "00000000-0000-4000-8000-000000000264";
const consentText =
  "Я даю согласие на обработку персональных данных, которые указываю в этой форме, исключительно для подготовки и возврата мне текста одной заявки в управляющую организацию. Для этой цели введённые данные могут быть переданы внешнему сервису на базе LLM, используемому оператором для подготовки текста заявки. Согласие действует до достижения указанной цели или до его отзыва. Отозвать согласие можно, написав на zayavka@ashikov.ru.";

beforeEach(async () => {
  vi.resetModules();
  getController.mockReset().mockResolvedValue({ status: "disabled" });
  const html = readFileSync("apps/web/public/index.html", "utf8");
  document.body.innerHTML = html.slice(
    html.indexOf(">", html.indexOf("<body")) + 1,
    html.indexOf("</body>"),
  );
  await import("../public/app.js");
  (document.querySelector("#description") as HTMLTextAreaElement).value =
    "Синтетическое описание неисправности освещения";
});
afterEach(() => vi.unstubAllGlobals());
function submit() {
  document.querySelector("#request-form")?.dispatchEvent(new Event("submit", { cancelable: true }));
}
function accept() {
  const checkbox = document.querySelector<HTMLInputElement>("#consent-accepted");
  expect(checkbox).not.toBeNull();
  if (checkbox) checkbox.checked = true;
}
it("показывает отдельное неподтверждённое согласие с точным текстом и версией", () => {
  expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  const checkbox = document.querySelector<HTMLInputElement>("#consent-accepted");
  expect(checkbox?.checked).toBe(false);
  expect(checkbox?.required).toBe(true);
  expect(document.querySelector("#consent-text")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
    consentText,
  );
  expect(document.querySelector("#consent-version")?.textContent).toBe("c1-2026-09-15-r1");
});
it("без согласия не получает CAPTCHA controller и не отправляет POST", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  submit();
  await vi.waitFor(() =>
    expect(document.querySelector("#error-area")?.textContent).toContain("согласие"),
  );
  expect(getController).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(document.querySelector("#consent-accepted")?.getAttribute("aria-invalid")).toBe("true");
});
it.each([
  "success",
  "error",
  "malformed",
  "invalid-result",
])("сохраняет receipt при ответе %s и отправляет точную версию", async (kind) => {
  accept();
  const payload =
    kind === "success"
      ? { title: "Синтетический заголовок", body: "Учебный результат", warnings: [] }
      : kind === "error"
        ? {
            error: {
              code: "internal_error",
              message: "Ошибка генерации",
              requestId: "synthetic-request",
            },
          }
        : {};
  const response = new Response(kind === "malformed" ? "{" : JSON.stringify(payload), {
    status: kind === "error" ? 500 : 200,
    headers: { "x-consent-receipt-id": receipt },
  });
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  submit();
  await vi.waitFor(() =>
    expect(document.querySelector("#consent-receipt-id")?.textContent).toBe(receipt),
  );
  expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toMatchObject({
    consentAccepted: true,
    consentVersion: "c1-2026-09-15-r1",
  });
  expect(document.querySelector<HTMLAnchorElement>("#consent-receipt-area a")?.href).toBe(
    "mailto:zayavka@ashikov.ru",
  );
  expect(document.querySelector("#result-area #consent-receipt-id")).toBeNull();
});

it("не отправляет запрос, если checkbox снят во время получения CAPTCHA token", async () => {
  accept();
  let completeToken: (token: string) => void = () => {};
  const requestToken = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        completeToken = resolve;
      }),
  );
  const reset = vi.fn();
  getController.mockResolvedValue({ status: "ready", requestToken, reset });
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  submit();
  await vi.waitFor(() => expect(requestToken).toHaveBeenCalledOnce());
  (document.querySelector("#consent-accepted") as HTMLInputElement).checked = false;
  completeToken("synthetic-token");
  await vi.waitFor(() => expect(reset).toHaveBeenCalledOnce());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(document.querySelector("#error-area")?.textContent).toContain("согласие");
});
