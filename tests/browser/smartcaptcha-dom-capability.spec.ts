import { expect, type Route, test } from "@playwright/test";
import { fullFormValues } from "./test-data.js";

const captchaConfigUrlPattern = "**/api/captcha/config";
const generateUrlPattern = "**/api/generate";
const smartCaptchaScriptUrlPattern =
  /^https:\/\/smartcaptcha\.cloud\.yandex\.ru\/captcha\.js\?render=onload&onload=uoSmartCaptchaOnload\d+$/;
const smartCaptchaScriptSelector =
  'script[src^="https://smartcaptcha.cloud.yandex.ru/captcha.js?"]';
const confirmedProblemSubject = "common_area_premises_lighting";
const successfulGeneration = {
  title: "Синтетический результат проверки",
  body: "Тестовый текст без пользовательских и персональных данных.",
  warnings: ["Проверить синтетические сведения перед использованием"],
};
const consentVersion = "c1-2026-09-15-r1";
const firstReceiptId = "00000000-0000-4000-8000-000000000264";
const secondReceiptId = "00000000-0000-4000-8000-000000000265";
const controlledRequestId = "anonymous-browser-request-id";

async function fulfillJson(
  route: Route,
  status: number,
  payload: unknown,
  receiptId?: string,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: receiptId === undefined ? {} : { "x-consent-receipt-id": receiptId },
    body: JSON.stringify(payload),
  });
}

const fakeClassicScript = `
  (() => {
    const capabilityScript = document.currentScript;
    const callbackName = new URL(capabilityScript.src).searchParams.get("onload");
    if (callbackName === null) throw new Error("Missing classic script callback");

    const snapshot = {
      input: {
        description: document.querySelector("#description").value,
        location: document.querySelector("#location").value,
        consequences: document.querySelector("#consequences").value,
        desiredActions: document.querySelector("#desired-actions").value,
        confirmedProblemSubject: document.querySelector("#confirmed-problem-subject").value,
      },
    };
    let widgetCallback;
    let executionCount = 0;
    let resetCount = 0;

    const publishCapability = () => {
      snapshot.consent = {
        accepted: document.querySelector("#consent-accepted").checked,
        text: document.querySelector("#consent-text").textContent.replace(/\\s+/g, " ").trim(),
        version: document.querySelector("#consent-version").textContent,
        receiptId: document.querySelector("#consent-receipt-id").textContent,
      };
      const title = document.querySelector("#result-area h3")?.textContent ?? "";
      if (title !== "") {
        snapshot.output = {
          title,
          body: document.querySelector("#result-area > p")?.textContent ?? "",
          warnings: Array.from(document.querySelectorAll("#result-area li"), (item) =>
            item.textContent ?? "",
          ),
        };
      }
      const requestId = document.querySelector("#error-area .small")?.textContent ?? "";
      if (requestId !== "") snapshot.requestId = requestId;
      capabilityScript.dataset.capabilitySnapshot = JSON.stringify(snapshot);
      capabilityScript.dataset.resetCount = String(resetCount);
    };

    document.addEventListener("change", publishCapability);
    new MutationObserver(publishCapability).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    publishCapability();

    window.smartCaptcha = {
      render(_container, options) {
        widgetCallback = options.callback;
        return 37;
      },
      execute() {
        executionCount += 1;
        queueMicrotask(() => widgetCallback("synthetic-captcha-token-" + executionCount));
      },
      reset() {
        resetCount += 1;
        publishCapability();
      },
      subscribe() {
        return () => undefined;
      },
    };

    queueMicrotask(() => window[callbackName]());
  })();
`;

test("доказывает техническую возможность same-document classic script читать ввод и последующий DOM", async ({
  page,
}) => {
  const unexpectedExternalRequests: string[] = [];
  let interceptedClassicScriptUrl = "";
  let generationRequestCount = 0;
  const submittedPayloads: unknown[] = [];

  page.on("request", (request) => {
    const requestUrl = request.url();
    if (
      /^https?:/.test(requestUrl) &&
      !requestUrl.startsWith("http://request-generator:3000/") &&
      !smartCaptchaScriptUrlPattern.test(requestUrl)
    ) {
      unexpectedExternalRequests.push(requestUrl);
    }
  });
  await page.route(captchaConfigUrlPattern, async (route) => {
    await fulfillJson(route, 200, {
      generationAvailable: true,
      required: true,
      clientKey: "anonymous-public-browser-key",
    });
  });
  await page.route(smartCaptchaScriptUrlPattern, async (route) => {
    interceptedClassicScriptUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: fakeClassicScript,
    });
  });
  await page.route(generateUrlPattern, async (route) => {
    generationRequestCount += 1;
    submittedPayloads.push(route.request().postDataJSON());
    if (generationRequestCount === 1) {
      await fulfillJson(route, 200, successfulGeneration, firstReceiptId);
      return;
    }
    await fulfillJson(
      route,
      500,
      {
        error: {
          code: "internal_error",
          message: "Синтетическая ошибка после записи согласия",
          requestId: controlledRequestId,
        },
      },
      secondReceiptId,
    );
  });

  await page.goto("/");
  await page.locator("#description").fill(fullFormValues.description);
  await page.locator("#location").fill(fullFormValues.location);
  await page.locator("#consequences").fill(fullFormValues.consequences);
  await page.locator("#desired-actions").fill(fullFormValues.desiredActions);
  await page.locator("#confirmed-problem-subject").selectOption(confirmedProblemSubject);

  const consentText = (await page.locator("#consent-text").textContent())
    ?.replace(/\s+/g, " ")
    .trim();
  const classicScript = page.locator(smartCaptchaScriptSelector);
  await expect(classicScript).toHaveCount(0);

  await page.locator("#consent-accepted").check();
  await page.locator("#submit-button").click();

  await expect(page.locator("#result-area h3")).toHaveText(successfulGeneration.title);
  await expect(classicScript).toHaveCount(1);
  await expect(classicScript).toHaveAttribute(
    "data-capability-snapshot",
    JSON.stringify({
      input: { ...fullFormValues, confirmedProblemSubject },
      consent: {
        accepted: true,
        text: consentText,
        version: consentVersion,
        receiptId: firstReceiptId,
      },
      output: successfulGeneration,
    }),
  );
  await expect(classicScript).toHaveAttribute("data-reset-count", "1");
  expect(await classicScript.evaluate((script) => script.isConnected)).toBe(true);
  expect(interceptedClassicScriptUrl).toMatch(smartCaptchaScriptUrlPattern);

  await page.locator("#consent-accepted").uncheck();
  await expect(classicScript).toHaveAttribute(
    "data-capability-snapshot",
    JSON.stringify({
      input: { ...fullFormValues, confirmedProblemSubject },
      consent: {
        accepted: false,
        text: consentText,
        version: consentVersion,
        receiptId: firstReceiptId,
      },
      output: successfulGeneration,
    }),
  );
  await page.locator("#consent-accepted").check();
  await page.locator("#submit-button").click();

  await expect(page.locator("#error-area")).toContainText(
    "Синтетическая ошибка после записи согласия",
  );
  await expect(page.locator("#error-area")).toContainText(`Код запроса: ${controlledRequestId}`);
  await expect(classicScript).toHaveAttribute(
    "data-capability-snapshot",
    JSON.stringify({
      input: { ...fullFormValues, confirmedProblemSubject },
      consent: {
        accepted: true,
        text: consentText,
        version: consentVersion,
        receiptId: secondReceiptId,
      },
      output: successfulGeneration,
      requestId: `Код запроса: ${controlledRequestId}`,
    }),
  );
  await expect(classicScript).toHaveAttribute("data-reset-count", "2");
  expect(await classicScript.evaluate((script) => script.isConnected)).toBe(true);
  expect(submittedPayloads).toEqual([
    {
      ...fullFormValues,
      confirmedProblemSubject,
      consentAccepted: true,
      consentVersion,
      captchaToken: "synthetic-captcha-token-1",
    },
    {
      ...fullFormValues,
      confirmedProblemSubject,
      consentAccepted: true,
      consentVersion,
      captchaToken: "synthetic-captcha-token-2",
    },
  ]);
  expect(unexpectedExternalRequests).toEqual([]);
});
