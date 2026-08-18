import { expect, type Page, test } from "@playwright/test";
import {
  expectElementsDoNotOverlap,
  expectFormFieldPartsDoNotOverlap,
  expectNoHorizontalDocumentOverflow,
  expectReachableByScrolling,
  expectTextWraps,
  expectWithinViewportHorizontally,
} from "./layout-assertions.js";
import {
  controlledServerErrorMessage,
  expectedCopiedText,
  fullFormValues,
  longGenerationResult,
} from "./test-data.js";

const generateUrlPattern = "**/api/generate";

async function waitForScrollToSettle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let previousScrollY = window.scrollY;
        let stableFrameCount = 0;

        const checkScrollPosition = () => {
          if (window.scrollY === previousScrollY) {
            stableFrameCount++;
          } else {
            stableFrameCount = 0;
            previousScrollY = window.scrollY;
          }

          if (stableFrameCount >= 2) {
            resolve();
            return;
          }

          requestAnimationFrame(checkScrollPosition);
        };

        requestAnimationFrame(checkScrollPosition);
      }),
  );
}

async function expectCoreLayout(page: Page): Promise<void> {
  await waitForScrollToSettle(page);
  await expectNoHorizontalDocumentOverflow(page);
  await expectWithinViewportHorizontally(page, [
    { name: "основной container", locator: page.locator("main") },
    { name: "форма", locator: page.locator("#request-form") },
    { name: "labels", locator: page.locator("#request-form label") },
    { name: "поля", locator: page.locator("#request-form input, select, textarea") },
    {
      name: "подсказки и счётчики",
      locator: page.locator('#request-form [id$="-hint"], #request-form [id$="-count"]'),
    },
    { name: "основная кнопка", locator: page.locator("#submit-button") },
    { name: "область результата", locator: page.locator("#result-area") },
    { name: "пояснение о самостоятельной отправке", locator: page.locator("#submission-notice") },
    {
      name: "служебное сообщение",
      locator: page.getByText("Проверьте готовую заявку перед отправкой", { exact: false }),
    },
  ]);
  await expectFormFieldPartsDoNotOverlap(page);
}

test("сохраняет layout-инварианты от формы до длинного результата", async ({ page }, testInfo) => {
  const unexpectedExternalRequests: string[] = [];
  page.on("request", (request) => {
    const requestUrl = request.url();
    if (/^https?:/.test(requestUrl) && !requestUrl.startsWith("http://web:3000/")) {
      unexpectedExternalRequests.push(requestUrl);
    }
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(text: string) {
          Reflect.set(window, "__browserTestCopiedText", text);
        },
      },
    });
  });

  let generationRequestCount = 0;
  await page.route(generateUrlPattern, async (route) => {
    generationRequestCount++;
    expect(route.request().method()).toBe("POST");

    if (generationRequestCount === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "generation_unavailable",
            message: controlledServerErrorMessage,
            requestId: "browser-layout-request-id",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(longGenerationResult),
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Заявка в управляющую организацию" }),
  ).toBeVisible();
  await expect(page.locator("#submission-notice")).toHaveText(
    "Сервис только подготавливает текст заявки и не отправляет её. Готовый текст нужно отправить в управляющую организацию самостоятельно.",
  );
  await expect(page.locator("#submission-notice")).toBeVisible();
  await expect(page.locator("#request-form")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#captcha-notice")).toBeHidden();

  const fields = [
    page.getByLabel("Описание проблемы Обязательное поле"),
    page.getByLabel("Где это произошло"),
    page.getByLabel("Известные последствия"),
    page.getByLabel("Желаемые действия"),
  ];
  for (const field of fields) {
    await expect(field).toBeEditable();
  }

  await expectCoreLayout(page);
  if (testInfo.project.name === "desktop-1280x800") {
    const viewport = page.viewportSize();
    const containerRectangle = await page.locator("main").boundingBox();
    if (viewport === null || containerRectangle === null) {
      throw new Error("Desktop container должен иметь измеримый viewport");
    }
    expect(containerRectangle.width).toBeLessThan(viewport.width);
    expect(containerRectangle.x).toBeCloseTo((viewport.width - containerRectangle.width) / 2, 0);
  }
  await expectWithinViewportHorizontally(page, [
    { name: "начальное сообщение", locator: page.locator("#result-placeholder") },
  ]);
  await expectTextWraps({
    name: "длинные подсказки",
    locator: page.locator(
      "#description-hint, #location-hint, #consequences-hint, #desired-actions-hint",
    ),
  });
  await expectReachableByScrolling(page, {
    name: "поле желаемых действий",
    locator: page.locator("#desired-actions"),
  });
  await expectReachableByScrolling(page, {
    name: "основная кнопка",
    locator: page.locator("#submit-button"),
  });

  await page.locator("#description").fill("Коротко");
  await page.locator("#submit-button").click();
  await expect(page.locator("#error-area")).toHaveText(
    "Описание должно содержать не менее 10 символов",
  );
  expect(generationRequestCount).toBe(0);
  await expectWithinViewportHorizontally(page, [
    { name: "локальная ошибка", locator: page.locator("#error-area") },
  ]);
  await expectTextWraps({ name: "локальная ошибка", locator: page.locator("#error-area") });
  await expectNoHorizontalDocumentOverflow(page);

  await page.locator("#description").fill(fullFormValues.description);
  await page.locator("#location").fill(fullFormValues.location);
  await page.locator("#consequences").fill(fullFormValues.consequences);
  await page.locator("#desired-actions").fill(fullFormValues.desiredActions);
  await page.locator("#submit-button").click();

  const errorArea = page.locator("#error-area");
  await expect(errorArea).toContainText(controlledServerErrorMessage);
  await expect(errorArea).toContainText("Код запроса: browser-layout-request-id");
  await expect(page.locator("#description")).toHaveValue(fullFormValues.description);
  await expect(page.locator("#location")).toHaveValue(fullFormValues.location);
  await expect(page.locator("#consequences")).toHaveValue(fullFormValues.consequences);
  await expect(page.locator("#desired-actions")).toHaveValue(fullFormValues.desiredActions);
  await expectWithinViewportHorizontally(page, [
    { name: "длинная серверная ошибка", locator: errorArea },
  ]);
  await expectTextWraps({ name: "длинная серверная ошибка", locator: errorArea });
  await expectNoHorizontalDocumentOverflow(page);

  await page.locator("#submit-button").click();

  const resultTitle = page.locator("#result-area h3");
  const resultBody = page.locator("#result-area > p");
  const warningsList = page.locator("#result-area > ul");
  const warnings = warningsList.locator("li");
  const copyButton = page.getByRole("button", { name: "Скопировать заявку" });
  await expect(resultTitle).toHaveText(longGenerationResult.title);
  await expect(resultBody).toHaveText(longGenerationResult.body);
  await expect(warnings).toHaveCount(longGenerationResult.warnings.length);
  await expect(copyButton).toBeEnabled();

  await expectCoreLayout(page);
  await expectWithinViewportHorizontally(page, [
    { name: "заголовок результата", locator: resultTitle },
    { name: "длинный текст результата", locator: resultBody },
    { name: "warnings", locator: warnings },
    { name: "кнопка копирования", locator: copyButton },
  ]);
  await expectTextWraps({ name: "заголовок результата", locator: resultTitle });
  await expectTextWraps({ name: "длинный текст результата", locator: resultBody });
  await expectTextWraps({ name: "warnings", locator: warnings });
  await expectElementsDoNotOverlap(
    { name: "текст результата", locator: resultBody },
    { name: "кнопка копирования", locator: copyButton },
  );
  await expectElementsDoNotOverlap(
    { name: "кнопка копирования", locator: copyButton },
    { name: "список warnings", locator: warningsList },
  );
  await expectReachableByScrolling(page, { name: "кнопка копирования", locator: copyButton });

  await copyButton.click();
  const copyStatus = page.getByRole("status");
  await expect(copyStatus).toHaveText("Скопировано");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__browserTestCopiedText")))
    .toBe(expectedCopiedText);
  await expectWithinViewportHorizontally(page, [
    { name: "статус копирования", locator: copyStatus },
  ]);
  await expectTextWraps({ name: "статус копирования", locator: copyStatus });
  await expectElementsDoNotOverlap(
    { name: "список warnings", locator: warningsList },
    { name: "статус копирования", locator: copyStatus },
  );
  await expectNoHorizontalDocumentOverflow(page);

  expect(generationRequestCount).toBe(2);
  expect(unexpectedExternalRequests).toEqual([]);
});
