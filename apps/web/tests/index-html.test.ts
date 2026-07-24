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
});
