import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), "../public");

describe("публичная страница", () => {
  it("подключает Bootstrap локально без CDN и JavaScript bundle", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toContain('<link rel="stylesheet" href="/vendor/bootstrap/bootstrap.min.css" />');
    expect(html).not.toMatch(/https?:\/\/[^"']*bootstrap/i);
    expect(html).not.toMatch(/bootstrap(?:\.bundle)?(?:\.min)?\.js/i);
  });

  it("содержит актуальное предупреждение о проверке заявки", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toMatch(
      /Проверьте готовую заявку перед отправкой\. Текст сформирован автоматически и может\s+требовать уточнения\./,
    );
    expect(html).not.toContain(
      "Генерация через LLM пока не подключена. Форма вернёт контролируемую ошибку.",
    );
  });

  it("содержит необязательные поля контекста с доступными подсказками и счётчиками", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toMatch(/for="consequences"[\s\S]*Известные последствия/);
    expect(html).toMatch(/id="consequences"[\s\S]*maxlength="500"/);
    expect(html).toContain('aria-describedby="consequences-hint consequences-count"');
    expect(html).toContain('id="consequences-hint"');
    expect(html).toMatch(/id="consequences-count"[^>]*aria-live="polite"/);

    expect(html).toMatch(/for="desired-actions"[\s\S]*Желаемые действия/);
    expect(html).toMatch(/id="desired-actions"[\s\S]*maxlength="500"/);
    expect(html).toContain('aria-describedby="desired-actions-hint desired-actions-count"');
    expect(html).toContain('id="desired-actions-hint"');
    expect(html).toMatch(/id="desired-actions-count"[^>]*aria-live="polite"/);
  });

  it("содержит скрытое до проверки конфигурации уведомление SmartCaptcha", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toMatch(/id="captcha-notice"[^>]*hidden/);
    expect(html).toContain("Этот сайт защищён Yandex SmartCaptcha.");
    expect(html).toContain('href="https://yandex.ru/legal/smartcaptcha_notice/ru/"');
  });

  it("отделяет обязательное описание от группы необязательных сведений", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toMatch(
      /<label[^>]*for="description"[^>]*>[\s\S]*Обязательное поле[\s\S]*<\/label>/,
    );
    expect(html).toMatch(/<section[^>]*aria-labelledby="optional-fields-title"/);
    expect(html).toContain('id="optional-fields-title"');
    expect(html).toContain("Дополнительные сведения");
  });

  it("содержит необязательный выбор предмета проблемы с понятным пояснением", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toMatch(
      /for="confirmed-problem-subject"[\s\S]*Предмет проблемы \(необязательно\)/,
    );
    expect(html).toContain('id="confirmed-problem-subject"');
    expect(html).toContain(
      'aria-describedby="confirmed-problem-subject-hint confirmed-problem-subject-context"',
    );
    expect(html).toContain("Входная дверь МКД или помещения общего пользования");
    expect(html).toContain('data-subject-hint="Подходит для входной двери МКД');
    expect(html).toContain('value="common_area_premises_lighting"');
    expect(html).toContain("Освещение помещения общего пользования МКД");
    expect(html).toContain(
      'data-subject-hint="Подходит для освещения помещений общего пользования МКД',
    );
    expect(html).toContain('id="confirmed-problem-subject-hint"');
    expect(html).toContain("Выберите только точный предмет проблемы.");
    expect(html).toContain(
      '<div id="confirmed-problem-subject-context" class="form-text" role="status" hidden></div>',
    );
  });
});
