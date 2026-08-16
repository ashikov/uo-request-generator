import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkFileEndings } from "./check-file-endings.mjs";

const temporaryDirectories: string[] = [];
const execFile = promisify(execFileCallback);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function checkTemporaryFiles(
  trackedFiles: Record<string, string>,
  untrackedFiles: Record<string, string> = {},
): Promise<string[]> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "check-file-endings-"));
  temporaryDirectories.push(directory);

  await execFile("git", ["init", "--quiet", directory]);

  await writeFiles(directory, trackedFiles);
  await execFile("git", ["-C", directory, "add", "--all"]);
  await writeFiles(directory, untrackedFiles);

  return checkFileEndings(directory);
}

async function writeFiles(directory: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([fileName, content]) => {
      const filePath = path.join(directory, fileName);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }),
  );
}

describe("check-file-endings", () => {
  it("принимает поддерживаемые файлы с одним завершающим LF", async () => {
    await expect(
      checkTemporaryFiles({
        "tracked/regular.txt": "Обычный текст\n",
        "tracked/document.md": "# Документ\n",
        "tracked/component.mdx": "# Компонент\n",
      }),
    ).resolves.toEqual([]);
  });

  it("отклоняет tracked-файл с дополнительной пустой строкой", async () => {
    const errors = await checkTemporaryFiles({
      "tracked/document.md": "# Документ\n\n",
    });

    expect(errors).toEqual(["tracked/document.md: ожидается один перевод строки перед EOF"]);
  });

  it("отклоняет файл без завершающего LF", async () => {
    await expect(checkTemporaryFiles({ "tracked/regular.txt": "Обычный текст" })).resolves.toEqual([
      "tracked/regular.txt: ожидается один перевод строки перед EOF",
    ]);
  });

  it("отклоняет tracked-файл с CRLF", async () => {
    await expect(
      checkTemporaryFiles({ "tracked/regular.txt": "Обычный текст\r\n" }),
    ).resolves.toEqual(["tracked/regular.txt: ожидается один перевод строки перед EOF"]);
  });

  it("отклоняет tracked-файл с CRLF и дополнительной пустой строкой", async () => {
    await expect(
      checkTemporaryFiles({ "tracked/regular.txt": "Обычный текст\r\n\r\n" }),
    ).resolves.toEqual(["tracked/regular.txt: ожидается один перевод строки перед EOF"]);
  });

  it("игнорирует некорректные untracked-файлы", async () => {
    await expect(
      checkTemporaryFiles(
        { "tracked/regular.txt": "Обычный текст\n" },
        { "untracked/invalid.txt": "Некорректный текст" },
      ),
    ).resolves.toEqual([]);
  });
});
