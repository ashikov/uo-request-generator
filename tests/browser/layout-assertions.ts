import { expect, type Locator, type Page } from "@playwright/test";

type Rectangle = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type NamedLocator = {
  name: string;
  locator: Locator;
};

const geometryTolerance = 1;

export async function expectVisibleFocusIndication(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const { focusStyle, unfocusedBoxShadow } = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error("Focus indication можно проверить только у HTMLElement");
    }

    const inlineTransition = element.style.getPropertyValue("transition");
    const inlineTransitionPriority = element.style.getPropertyPriority("transition");
    element.style.setProperty("transition", "none", "important");

    try {
      const style = getComputedStyle(element);
      const focused = {
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        boxShadow: style.boxShadow,
      };
      element.blur();

      return {
        focusStyle: focused,
        unfocusedBoxShadow: getComputedStyle(element).boxShadow,
      };
    } finally {
      element.focus();
      if (inlineTransition === "") {
        element.style.removeProperty("transition");
      } else {
        element.style.setProperty("transition", inlineTransition, inlineTransitionPriority);
      }
    }
  });
  await expect(locator).toBeFocused();

  const hasVisibleOutline =
    focusStyle.outlineWidth > 0 &&
    focusStyle.outlineStyle !== "none" &&
    focusStyle.outlineColor !== "transparent" &&
    focusStyle.outlineColor !== "rgba(0, 0, 0, 0)";
  const hasFocusBoxShadow =
    focusStyle.boxShadow !== "none" && focusStyle.boxShadow !== unfocusedBoxShadow;

  expect(
    hasVisibleOutline || hasFocusBoxShadow,
    "focused элемент должен иметь видимую focus-индикацию",
  ).toBe(true);
}

async function rectangles(locator: Locator): Promise<Rectangle[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        top: rectangle.top,
        right: rectangle.right,
        bottom: rectangle.bottom,
        left: rectangle.left,
        width: rectangle.width,
        height: rectangle.height,
      };
    }),
  );
}

export async function expectNoHorizontalDocumentOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));

  expect(widths.document, "document не должен прокручиваться по горизонтали").toBeLessThanOrEqual(
    widths.viewport + geometryTolerance,
  );
  expect(widths.body, "body не должен прокручиваться по горизонтали").toBeLessThanOrEqual(
    widths.viewport + geometryTolerance,
  );
}

export async function expectWithinViewportHorizontally(
  page: Page,
  elements: NamedLocator[],
): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("Viewport должен быть задан в Playwright project");
  }

  for (const { name, locator } of elements) {
    const elementRectangles = await rectangles(locator);
    expect(elementRectangles.length, `${name}: ожидается хотя бы один элемент`).toBeGreaterThan(0);

    for (const rectangle of elementRectangles) {
      expect(rectangle.width, `${name}: ширина должна быть положительной`).toBeGreaterThan(0);
      expect(rectangle.height, `${name}: высота должна быть положительной`).toBeGreaterThan(0);
      expect(rectangle.left, `${name}: левая граница вне viewport`).toBeGreaterThanOrEqual(
        -geometryTolerance,
      );
      expect(rectangle.right, `${name}: правая граница вне viewport`).toBeLessThanOrEqual(
        viewport.width + geometryTolerance,
      );
    }
  }
}

async function expectNoIntersection(
  firstName: string,
  first: Locator,
  secondName: string,
  second: Locator,
): Promise<void> {
  const [firstRectangle] = await rectangles(first);
  const [secondRectangle] = await rectangles(second);
  if (firstRectangle === undefined || secondRectangle === undefined) {
    throw new Error(`Не найдены элементы для проверки пересечения: ${firstName}, ${secondName}`);
  }

  const overlapWidth =
    Math.min(firstRectangle.right, secondRectangle.right) -
    Math.max(firstRectangle.left, secondRectangle.left);
  const overlapHeight =
    Math.min(firstRectangle.bottom, secondRectangle.bottom) -
    Math.max(firstRectangle.top, secondRectangle.top);

  expect(
    overlapWidth <= geometryTolerance || overlapHeight <= geometryTolerance,
    `${firstName} пересекается с ${secondName}`,
  ).toBe(true);
}

export async function expectElementsDoNotOverlap(
  first: NamedLocator,
  second: NamedLocator,
): Promise<void> {
  await expectNoIntersection(first.name, first.locator, second.name, second.locator);
}

export async function expectFormFieldPartsDoNotOverlap(page: Page): Promise<void> {
  const fields = [
    {
      name: "Описание проблемы",
      label: page.locator('label[for="description"]'),
      control: page.locator("#description"),
      hint: page.locator("#description-hint"),
      counter: page.locator("#description-count"),
    },
    {
      name: "Где это произошло",
      label: page.locator('label[for="location"]'),
      control: page.locator("#location"),
      hint: page.locator("#location-hint"),
      counter: page.locator("#location-count"),
    },
    {
      name: "Известные последствия",
      label: page.locator('label[for="consequences"]'),
      control: page.locator("#consequences"),
      hint: page.locator("#consequences-hint"),
      counter: page.locator("#consequences-count"),
    },
    {
      name: "Желаемые действия",
      label: page.locator('label[for="desired-actions"]'),
      control: page.locator("#desired-actions"),
      hint: page.locator("#desired-actions-hint"),
      counter: page.locator("#desired-actions-count"),
    },
  ];

  for (const field of fields) {
    await expectNoIntersection(`${field.name}: label`, field.label, "поле", field.control);
    await expectNoIntersection(`${field.name}: label`, field.label, "подсказка", field.hint);
    await expectNoIntersection(`${field.name}: label`, field.label, "счётчик", field.counter);
    await expectNoIntersection(`${field.name}: поле`, field.control, "подсказка", field.hint);
    await expectNoIntersection(`${field.name}: поле`, field.control, "счётчик", field.counter);
    await expectNoIntersection(`${field.name}: подсказка`, field.hint, "счётчик", field.counter);
  }
}

export async function expectReachableByScrolling(page: Page, element: NamedLocator): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error("Viewport должен быть задан в Playwright project");
  }

  let [rectangle] = await rectangles(element.locator);
  if (rectangle === undefined) {
    throw new Error(`${element.name}: элемент не найден`);
  }

  const isFullyVisible = (candidate: Rectangle): boolean =>
    candidate.top >= -geometryTolerance && candidate.bottom <= viewport.height + geometryTolerance;
  const requiredUserScroll = !isFullyVisible(rectangle);
  const initialScrollPosition = await page.evaluate(() => window.scrollY);

  for (let attempt = 0; attempt < 20 && !isFullyVisible(rectangle); attempt++) {
    const distanceToViewport =
      rectangle.bottom > viewport.height
        ? rectangle.bottom - viewport.height + geometryTolerance
        : rectangle.top - geometryTolerance;
    const maximumStep = Math.max(100, Math.floor(viewport.height * 0.8));
    const scrollDelta =
      Math.sign(distanceToViewport) * Math.min(Math.abs(distanceToViewport), maximumStep);
    await page.mouse.wheel(0, scrollDelta);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    const [nextRectangle] = await rectangles(element.locator);
    if (nextRectangle === undefined) {
      throw new Error(`${element.name}: элемент исчез во время прокрутки`);
    }
    rectangle = nextRectangle;
  }

  expect(rectangle.top, `${element.name}: верхняя граница недостижима`).toBeGreaterThanOrEqual(
    -geometryTolerance,
  );
  expect(rectangle.bottom, `${element.name}: нижняя граница недостижима`).toBeLessThanOrEqual(
    viewport.height + geometryTolerance,
  );
  if (requiredUserScroll) {
    expect(
      await page.evaluate(() => window.scrollY),
      `${element.name}: пользовательская прокрутка не изменила позицию страницы`,
    ).not.toBe(initialScrollPosition);
  }
}

export async function expectTextWraps(element: NamedLocator): Promise<void> {
  const measurements = await element.locator.evaluateAll((elements) =>
    elements.map((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })),
  );

  expect(measurements.length, `${element.name}: ожидается хотя бы один элемент`).toBeGreaterThan(0);
  for (const measurement of measurements) {
    expect(
      measurement.scrollWidth,
      `${element.name}: текст не должен создавать внутреннее горизонтальное переполнение`,
    ).toBeLessThanOrEqual(measurement.clientWidth + geometryTolerance);
  }
}
