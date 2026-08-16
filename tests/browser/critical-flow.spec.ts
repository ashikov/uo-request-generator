import { expect, type Page, type Route, test } from "@playwright/test";
import {
  expectNoHorizontalDocumentOverflow,
  expectReachableByScrolling,
  expectWithinViewportHorizontally,
} from "./layout-assertions.js";
import {
  controlledServerErrorMessage,
  expectedCopiedText,
  fullFormValues,
  longGenerationResult,
  requiredDescription,
} from "./test-data.js";

const generateUrlPattern = "**/api/generate";
const standardGenerationResult = {
  title: "Проверка освещения",
  body: "Прошу проверить светильник и восстановить штатное освещение.",
  warnings: [],
};

async function fulfillJson(route: Route, status: number, payload: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function fillAllFields(page: Page): Promise<void> {
  await page.locator("#description").fill(fullFormValues.description);
  await page.locator("#location").fill(fullFormValues.location);
  await page.locator("#consequences").fill(fullFormValues.consequences);
  await page.locator("#desired-actions").fill(fullFormValues.desiredActions);
}

test("загружает начальное состояние и отправляет только обязательное описание", async ({
  page,
}) => {
  let submittedPayload: unknown;
  await page.route(generateUrlPattern, async (route) => {
    submittedPayload = route.request().postDataJSON();
    await fulfillJson(route, 200, standardGenerationResult);
  });

  await page.goto("/");

  await expect(page.locator("#result-placeholder")).toHaveText(
    "Здесь появится результат после успешной генерации.",
  );
  await expect(page.locator("#request-form")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#description")).toBeEditable();
  await expect(page.locator("#location")).toBeEditable();
  await expect(page.locator("#consequences")).toBeEditable();
  await expect(page.locator("#desired-actions")).toBeEditable();
  await expect(page.locator("#confirmed-problem-subject")).toBeEnabled();

  await page.locator("#description").fill(requiredDescription);
  await page.locator("#submit-button").click();

  await expect(page.locator("#result-area h3")).toHaveText(standardGenerationResult.title);
  expect(submittedPayload).toEqual({ description: requiredDescription });
});

test("отправляет явное подтверждение предмета для дверного сценария", async ({ page }) => {
  let submittedPayload: unknown;
  await page.route(generateUrlPattern, async (route) => {
    submittedPayload = route.request().postDataJSON();
    await fulfillJson(route, 200, standardGenerationResult);
  });
  await page.goto("/");

  await page.locator("#description").fill("Входная дверь подъезда не закрывается.");
  await page.locator("#confirmed-problem-subject").selectOption("common_area_entrance_door");
  await page.locator("#submit-button").click();

  await expect(page.locator("#result-area h3")).toHaveText(standardGenerationResult.title);
  expect(submittedPayload).toEqual({
    description: "Входная дверь подъезда не закрывается.",
    confirmedProblemSubject: "common_area_entrance_door",
  });
});

test("отправляет явное подтверждение освещения помещения общего пользования", async ({ page }) => {
  let submittedPayload: unknown;
  await page.route(generateUrlPattern, async (route) => {
    submittedPayload = route.request().postDataJSON();
    await fulfillJson(route, 200, standardGenerationResult);
  });
  await page.goto("/");

  await page
    .locator("#description")
    .fill("В общем коридоре многоквартирного дома не работает освещение.");
  await page.locator("#confirmed-problem-subject").selectOption("common_area_premises_lighting");
  await page.locator("#submit-button").click();

  await expect(page.locator("#result-area h3")).toHaveText(standardGenerationResult.title);
  expect(submittedPayload).toEqual({
    description: "В общем коридоре многоквартирного дома не работает освещение.",
    confirmedProblemSubject: "common_area_premises_lighting",
  });
});

test("показывает локальную ошибку до запроса и переводит на неё focus", async ({ page }) => {
  let generationRequestCount = 0;
  await page.route(generateUrlPattern, async (route) => {
    generationRequestCount++;
    await fulfillJson(route, 200, standardGenerationResult);
  });
  await page.goto("/");

  await page.locator("#description").fill("Коротко");
  await page.locator("#submit-button").click();

  const errorArea = page.locator("#error-area");
  await expect(errorArea).toHaveText("Описание должно содержать не менее 10 символов");
  await expect(errorArea).toBeFocused();
  await expect(page.locator("#description")).toHaveAttribute("aria-invalid", "true");
  expect(generationRequestCount).toBe(0);
});

test("сохраняет все введённые значения после контролируемой серверной ошибки", async ({ page }) => {
  let submittedPayload: unknown;
  await page.route(generateUrlPattern, async (route) => {
    submittedPayload = route.request().postDataJSON();
    await fulfillJson(route, 503, {
      error: {
        code: "generation_unavailable",
        message: controlledServerErrorMessage,
        requestId: "browser-server-error-request-id",
      },
    });
  });
  await page.goto("/");
  await fillAllFields(page);

  await page.locator("#submit-button").click();

  await expect(page.locator("#error-area")).toHaveText(controlledServerErrorMessage);
  await expect(page.locator("#error-area")).toBeFocused();
  await expect(page.locator("#description")).toHaveValue(fullFormValues.description);
  await expect(page.locator("#location")).toHaveValue(fullFormValues.location);
  await expect(page.locator("#consequences")).toHaveValue(fullFormValues.consequences);
  await expect(page.locator("#desired-actions")).toHaveValue(fullFormValues.desiredActions);
  expect(submittedPayload).toEqual(fullFormValues);
});

test("контролирует loading и блокирует повторную отправку", async ({ page }) => {
  let generationRequestCount = 0;
  let resolveRequestPayload = (_payload: unknown): void => {
    throw new Error("Обработчик intercepted request не инициализирован");
  };
  const requestPayload = new Promise<unknown>((resolve) => {
    resolveRequestPayload = resolve;
  });
  let releaseResponse = (): void => {
    throw new Error("Обработчик controlled response не инициализирован");
  };
  const responseBarrier = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route(generateUrlPattern, async (route) => {
    generationRequestCount++;
    resolveRequestPayload(route.request().postDataJSON());
    await responseBarrier;
    await fulfillJson(route, 200, standardGenerationResult);
  });
  await page.goto("/");
  await fillAllFields(page);

  await page.locator("#submit-button").click();
  expect(await requestPayload).toEqual(fullFormValues);

  const form = page.locator("#request-form");
  const submitButton = page.locator("#submit-button");
  await expect(form).toHaveAttribute("aria-busy", "true");
  await expect(submitButton).toBeDisabled();
  await expect(submitButton).toHaveText("Составляем…");
  await expectNoHorizontalDocumentOverflow(page);
  await expectWithinViewportHorizontally(page, [
    { name: "форма в loading", locator: form },
    { name: "disabled submit", locator: submitButton },
  ]);

  await form.evaluate((element) =>
    element.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })),
  );
  expect(generationRequestCount).toBe(1);

  releaseResponse();

  await expect(page.locator("#result-area h3")).toHaveText(standardGenerationResult.title);
  await expect(form).toHaveAttribute("aria-busy", "false");
  await expect(submitButton).toBeEnabled();
  expect(generationRequestCount).toBe(1);
});

test("показывает длинный результат, позволяет прокрутить и скопировать его", async ({
  page,
}, testInfo) => {
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
  await page.route(generateUrlPattern, async (route) => {
    await fulfillJson(route, 200, longGenerationResult);
  });
  await page.goto("/");
  await fillAllFields(page);

  await page.locator("#submit-button").click();

  const resultTitle = page.locator("#result-area h3");
  const resultBody = page.locator("#result-area > p");
  const warnings = page.locator("#result-area > ul li");
  const copyButton = page.getByRole("button", { name: "Скопировать заявку" });
  await expect(resultTitle).toHaveText(longGenerationResult.title);
  await expect(resultBody).toHaveText(longGenerationResult.body);
  await expect(warnings).toHaveCount(longGenerationResult.warnings.length);

  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("Viewport должен быть задан в Playwright project");
  }
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(pageHeight).toBeGreaterThan(viewport.height);

  const scrollBeforeResult = await page.evaluate(() => window.scrollY);
  await expectReachableByScrolling(page, { name: "начало результата", locator: resultTitle });
  await expectReachableByScrolling(page, { name: "warnings", locator: warnings.last() });
  await expectReachableByScrolling(page, { name: "кнопка копирования", locator: copyButton });
  if (testInfo.project.name.startsWith("mobile-")) {
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBeforeResult);
  }

  const overviewScreenshot = testInfo.outputPath("overview-success.png");
  await page.screenshot({ path: overviewScreenshot, fullPage: true });
  await testInfo.attach("overview-success", {
    path: overviewScreenshot,
    contentType: "image/png",
  });

  await copyButton.click();
  await expect(page.getByRole("status")).toHaveText("Скопировано");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__browserTestCopiedText")))
    .toBe(expectedCopiedText);
});

test("проходит по интерактивным элементам клавишами в логичном порядке", async ({ page }) => {
  await page.route(generateUrlPattern, async (route) => {
    await fulfillJson(route, 200, standardGenerationResult);
  });
  await page.goto("/");

  const expectKeyboardFocus = async (selector: string): Promise<void> => {
    const focusedElement = page.locator(selector);
    await expect(focusedElement).toBeFocused();
    const focusStyle = await focusedElement.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.outlineColor,
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(focusStyle.width).toBeGreaterThan(0);
    expect(focusStyle.style).not.toBe("none");
    expect(focusStyle.color).not.toBe("transparent");
    expect(focusStyle.color).not.toBe("rgba(0, 0, 0, 0)");

    const viewport = page.viewportSize();
    const rectangle = await focusedElement.boundingBox();
    if (viewport === null || rectangle === null) {
      throw new Error(`${selector}: focus должен иметь измеримую геометрию`);
    }
    expect(rectangle.x).toBeGreaterThanOrEqual(-1);
    expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(rectangle.y).toBeLessThan(viewport.height);
    expect(rectangle.y + rectangle.height).toBeGreaterThan(0);
  };

  await page.keyboard.press("Tab");
  await expectKeyboardFocus("#description");
  await page.keyboard.type(requiredDescription);

  for (const selector of [
    "#location",
    "#consequences",
    "#desired-actions",
    "#confirmed-problem-subject",
    "#submit-button",
  ]) {
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(selector);
  }

  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Скопировать заявку" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(".copy-button");

  await page.keyboard.press("Shift+Tab");
  await expectKeyboardFocus("#submit-button");
});
