import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { buildReleaseConfig, currentMajorFromRepo } from "./release-rules.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const conventionalCommitPattern =
  /^(feat|fix|perf|docs|test|refactor|style|chore|ci|build)(\([^\r\n)]+\))?!?: [^\s\r\n][^\r\n]*$/u;

export function readCommitMessages({ baseRef, headRef, cwd = process.cwd() }) {
  if (![baseRef, headRef].every((ref) => typeof ref === "string" && ref.length > 0)) {
    throw new Error("Обе границы диапазона коммитов обязательны");
  }
  let stdout;
  try {
    // Полные сообщения сохраняют BREAKING CHANGE footer. NUL разделяет коммиты,
    // не смешивая их с многострочным телом сообщения.
    stdout = execFileSync(
      "git",
      ["-C", cwd, "log", "-z", "--format=%B", "--end-of-options", `${baseRef}..${headRef}`, "--"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (error) {
    throw new Error(`Не удалось прочитать коммиты диапазона: ${error.message}`);
  }
  if (!stdout) {
    throw new Error("Диапазон коммитов PR пуст");
  }
  return stdout.replace(/\0$/u, "").split("\0");
}

export function findInvalidSubjects(subjects) {
  return subjects.filter(
    (subject) => typeof subject !== "string" || !conventionalCommitPattern.test(subject),
  );
}

export async function validatePrMessages({ messages, title, currentMajor }) {
  const invalid = findInvalidSubjects(messages.map((message) => message.split("\n", 1)[0]));
  if (findInvalidSubjects([title]).length > 0) {
    invalid.push("Заголовок PR должен быть Conventional Commit");
  }
  if (invalid.length > 0) {
    return invalid;
  }

  const config = buildReleaseConfig(currentMajor).plugins.find(
    ([name]) => name === "@semantic-release/commit-analyzer",
  )[1];
  const context = { cwd: projectRoot, logger: { log() {} } };
  const commitLevel = await analyzeCommits(config, {
    ...context,
    commits: messages.map((message) => ({ message })),
  });
  const titleLevel = await analyzeCommits(config, {
    ...context,
    commits: [{ message: title }],
  });
  return commitLevel === titleLevel
    ? []
    : [
        `Уровень релиза заголовка PR (${titleLevel ?? "no release"}) не совпадает с уровнем коммитов (${commitLevel ?? "no release"})`,
      ];
}

export async function checkPrCommits({ baseRef, headRef, title, cwd = process.cwd() }) {
  const messages = readCommitMessages({ baseRef, headRef, cwd });
  return validatePrMessages({ messages, title, currentMajor: currentMajorFromRepo(cwd, baseRef) });
}

const invokedAsMainModule =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsMainModule) {
  try {
    const invalid = await checkPrCommits({
      baseRef: process.env.BASE_SHA,
      headRef: process.env.HEAD_SHA,
      title: process.env.PR_TITLE,
    });
    if (invalid.length > 0) {
      console.error("Проверка Conventional Commits и заголовка PR не пройдена:");
      for (const message of invalid) {
        console.error(message);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Проверка PR завершилась ошибкой: ${error.message}`);
    process.exitCode = 1;
  }
}
