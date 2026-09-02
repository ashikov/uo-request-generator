import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const conventionalCommitPattern =
  /^(feat|fix|perf|docs|test|refactor|style|chore|ci|build)(\([^)]+\))?!?:\s.+/;

// Чтение subjects отдельно от валидации: ошибка git log обязана явно завершиться
// ошибкой (fail-closed), а не молча дать пустой список коммитов
export function readCommitSubjects({ baseRef, headRef, cwd = process.cwd() }) {
  let stdout;
  try {
    stdout = execFileSync("git", ["-C", cwd, "log", "--format=%s", `${baseRef}..${headRef}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new Error(
      `Не удалось прочитать коммиты диапазона ${baseRef}..${headRef}: ${error.message}`,
    );
  }
  return stdout.split("\n").filter((line) => line.length > 0);
}

export function findInvalidSubjects(subjects) {
  return subjects.filter((subject) => !conventionalCommitPattern.test(subject));
}

export function checkPrCommits({ baseRef, headRef, cwd = process.cwd() }) {
  const subjects = readCommitSubjects({ baseRef, headRef, cwd });
  return findInvalidSubjects(subjects);
}

const invokedAsMainModule =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsMainModule) {
  const { BASE_SHA, HEAD_SHA } = process.env;
  if (!BASE_SHA || !HEAD_SHA) {
    console.error("::error::BASE_SHA и HEAD_SHA обязательны");
    process.exitCode = 1;
  } else {
    const invalid = checkPrCommits({ baseRef: BASE_SHA, headRef: HEAD_SHA });
    if (invalid.length > 0) {
      console.error("::error::Each PR commit must follow the Conventional Commits specification");
      console.error("Invalid commit subjects:");
      for (const subject of invalid) {
        console.error(subject);
      }
      process.exitCode = 1;
    }
  }
}
