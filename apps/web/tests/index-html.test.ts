import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), "../public");

describe("публичная страница", () => {
  it("содержит актуальное предупреждение о проверке заявки", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toContain(
      "Проверьте готовую заявку перед отправкой. Текст сформирован автоматически и может требовать уточнения.",
    );
    expect(html).not.toContain(
      "Генерация через LLM пока не подключена. Форма вернёт контролируемую ошибку.",
    );
  });

  it("содержит необязательные поля контекста с доступными подсказками и счётчиками", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toMatch(/<label for="consequences">Известные последствия<\/label>/);
    expect(html).toMatch(/id="consequences"[\s\S]*maxlength="500"/);
    expect(html).toContain('aria-describedby="consequences-hint consequences-count"');
    expect(html).toContain('id="consequences-hint"');
    expect(html).toContain('id="consequences-count" aria-live="polite"');

    expect(html).toMatch(/<label for="desired-actions">Желаемые действия<\/label>/);
    expect(html).toMatch(/id="desired-actions"[\s\S]*maxlength="500"/);
    expect(html).toContain('aria-describedby="desired-actions-hint desired-actions-count"');
    expect(html).toContain('id="desired-actions-hint"');
    expect(html).toContain('id="desired-actions-count" aria-live="polite"');
  });

  it("отделяет обязательное описание от группы необязательных сведений", async () => {
    const html = await readFile(join(publicDirectory, "index.html"), "utf8");

    expect(html).toMatch(/<label for="description">[\s\S]*Обязательное поле[\s\S]*<\/label>/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="optional-fields-title"/);
    expect(html).toContain('id="optional-fields-title"');
    expect(html).toContain("Дополнительные сведения");
  });
});
