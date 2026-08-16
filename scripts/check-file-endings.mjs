import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFile = promisify(execFileCallback);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".mjs",
  ".sh",
  ".toml",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const textFileNames = new Set([
  ".dockerignore",
  ".editorconfig",
  ".env.example",
  ".env.production.example",
  ".gitignore",
  ".nvmrc",
  "Dockerfile",
  "Makefile",
]);

async function collectTrackedFiles(directory) {
  const { stdout } = await execFile("git", ["-C", directory, "ls-files", "-z"]);
  return stdout.split("\0").filter(Boolean);
}

function isSupportedTextFile(filePath) {
  const fileName = path.basename(filePath);
  return textFileNames.has(fileName) || textExtensions.has(path.extname(fileName));
}

function isBinary(content) {
  return content.includes(0);
}

export async function checkFileEndings(directory = root) {
  const errors = [];
  const files = await collectTrackedFiles(directory);

  for (const relativePath of files) {
    const filePath = path.join(directory, relativePath);
    if (!isSupportedTextFile(filePath)) {
      continue;
    }

    const content = await readFile(filePath);
    if (isBinary(content)) {
      continue;
    }

    const hasValidEnding =
      content.length >= 1 &&
      content.at(-1) === 0x0a &&
      (content.length < 2 || (content.at(-2) !== 0x0a && content.at(-2) !== 0x0d));

    if (!hasValidEnding) {
      errors.push(`${relativePath}: ожидается один перевод строки перед EOF`);
    }
  }

  return errors;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const errors = await checkFileEndings();

  if (errors.length > 0) {
    console.error("Найдены некорректные окончания файлов:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Окончания текстовых файлов корректны.");
  }
}
