import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkFileEndings } from "./check-file-endings.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function checkTemporaryFiles(files: Record<string, string>): Promise<string[]> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "check-file-endings-"));
  temporaryDirectories.push(directory);

  await Promise.all(
    Object.entries(files).map(([fileName, content]) =>
      writeFile(path.join(directory, fileName), content),
    ),
  );

  return checkFileEndings(directory);
}

describe("check-file-endings", () => {
  it("принимает поддерживаемые файлы с одним завершающим LF", async () => {
    await expect(
      checkTemporaryFiles({
        "regular.txt": "Обычный текст\n",
        "document.md": "# Документ\n",
        "component.mdx": "# Компонент\n",
      }),
    ).resolves.toEqual([]);
  });

  it("отклоняет Markdown и обычный текст с дополнительной пустой строкой", async () => {
    const errors = await checkTemporaryFiles({
      "document.md": "# Документ\n\n",
      "regular.txt": "Обычный текст\n\n",
    });

    expect(errors).toHaveLength(2);
    expect(errors).toEqual(
      expect.arrayContaining([
        "document.md: ожидается один перевод строки перед EOF",
        "regular.txt: ожидается один перевод строки перед EOF",
      ]),
    );
  });

  it("отклоняет файл без завершающего LF", async () => {
    await expect(checkTemporaryFiles({ "regular.txt": "Обычный текст" })).resolves.toEqual([
      "regular.txt: ожидается один перевод строки перед EOF",
    ]);
  });
});
