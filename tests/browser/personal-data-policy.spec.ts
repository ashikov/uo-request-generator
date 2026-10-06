import { expect, test } from "@playwright/test";

test("отдаёт страницу политики без авторизации", async ({ page }, testInfo) => {
  const response = await page.goto("/policy.html");

  expect(response).not.toBeNull();
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Политика обработки персональных данных");
  await expect(
    page.getByRole("heading", { level: 1, name: "Политика обработки персональных данных" }),
  ).toBeVisible();
  await expect(page.getByText("Версия 1. Дата публикации: 06.10.2026.")).toBeVisible();

  const policyScreenshot = testInfo.outputPath("personal-data-policy.png");
  await page.screenshot({ path: policyScreenshot, fullPage: true });
  await testInfo.attach("personal-data-policy", {
    path: policyScreenshot,
    contentType: "image/png",
  });
});

test("ведёт со страницы формы на страницу политики", async ({ page }) => {
  await page.goto("/");

  const policyLink = page.locator("#personal-data-policy-link");
  await expect(policyLink).toBeVisible();
  await expect(policyLink).toHaveAttribute("href", "/policy.html");

  await policyLink.click();

  await expect(page).toHaveURL(/\/policy\.html$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Политика обработки персональных данных" }),
  ).toBeVisible();
});
