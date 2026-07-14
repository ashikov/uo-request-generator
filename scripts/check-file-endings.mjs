import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const skippedDirectories = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "reports",
  "test-results",
]);

const generatedFiles = new Set(["pnpm-lock.yaml"]);
const markdownExtensions = new Set([".md", ".mdx"]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonc",
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
  ".gitignore",
  ".nvmrc",
  "Dockerfile",
  "Makefile",
]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        files.push(...(await collectFiles(path.join(directory, entry.name))));
      }
      continue;
    }

    if (entry.isFile()) {
      files.push(path.join(directory, entry.name));
    }
  }

  return files;
}

function isSupportedTextFile(filePath) {
  const fileName = path.basename(filePath);
  return textFileNames.has(fileName) || textExtensions.has(path.extname(fileName));
}

function isBinary(content) {
  return content.includes(0);
}

const errors = [];
const files = await collectFiles(root);

for (const filePath of files) {
  const fileName = path.basename(filePath);
  if (generatedFiles.has(fileName) || !isSupportedTextFile(filePath)) {
    continue;
  }

  const content = await readFile(filePath);
  if (isBinary(content)) {
    continue;
  }

  const relativePath = path.relative(root, filePath);
  const isMarkdown = markdownExtensions.has(path.extname(fileName));
  const hasValidEnding = isMarkdown
    ? content.length >= 2 &&
      content.subarray(-2).toString() === "\n\n" &&
      (content.length < 3 || content.subarray(-3).toString() !== "\n\n\n")
    : content.length >= 1 &&
      content.subarray(-1).toString() === "\n" &&
      (content.length < 2 || content.subarray(-2).toString() !== "\n\n");

  if (!hasValidEnding) {
    errors.push(
      `${relativePath}: ${
        isMarkdown
          ? "ожидается ровно одна пустая строка перед EOF"
          : "ожидается один перевод строки перед EOF"
      }`,
    );
  }
}

if (errors.length > 0) {
  console.error("Найдены некорректные окончания файлов:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Окончания текстовых файлов корректны.");
}
