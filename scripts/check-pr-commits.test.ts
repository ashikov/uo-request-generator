import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkPrCommits, findInvalidSubjects, readCommitSubjects } from "./check-pr-commits.mjs";

const execFileAsync = promisify(execFile);
const temporaryRepositories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRepositories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createRepository(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "check-pr-commits-"));
  temporaryRepositories.push(directory);
  await execFileAsync("git", ["init", "--quiet", "--initial-branch=main", directory]);
  await execFileAsync("git", ["-C", directory, "config", "user.email", "check@example.invalid"]);
  await execFileAsync("git", ["-C", directory, "config", "user.name", "Check PR Commits"]);
  return directory;
}

async function commit(repository: string, message: string): Promise<string> {
  await execFileAsync("git", ["-C", repository, "commit", "--allow-empty", "--message", message]);
  const { stdout } = await execFileAsync("git", ["-C", repository, "rev-parse", "HEAD"]);
  return stdout.trim();
}

describe("check-pr-commits", () => {
  it("readCommitSubjects не может прочитать невалидный диапазон и бросает ошибку", async () => {
    const repository = await createRepository();

    expect(() =>
      readCommitSubjects({ baseRef: "not-a-ref", headRef: "also-not-a-ref", cwd: repository }),
    ).toThrow(/Не удалось прочитать коммиты/u);
  });

  it("checkPrCommits пропускает валидные Conventional Commit subjects", async () => {
    const repository = await createRepository();
    const base = await commit(repository, "chore: bootstrap");
    await commit(repository, "fix(clean): correct roof evidence rule");
    await commit(repository, "feat: add elevator legal module");
    const head = await commit(repository, "docs: update readme");

    const invalid = checkPrCommits({ baseRef: base, headRef: head, cwd: repository });

    expect(invalid).toEqual([]);
  });

  it("checkPrCommits находит неконвенциональные subjects", async () => {
    const repository = await createRepository();
    const base = await commit(repository, "chore: bootstrap");
    await commit(repository, "fix: valid subject");
    await commit(repository, "this is not conventional");
    const head = await commit(repository, "another bad one");

    const invalid = checkPrCommits({ baseRef: base, headRef: head, cwd: repository });

    expect(invalid).toEqual(["another bad one", "this is not conventional"]);
  });

  it("findInvalidSubjects распознаёт типы, не входящие в спецификацию", () => {
    expect(findInvalidSubjects(["chore: ok", "typo: not allowed", "Fix: capital"]).sort()).toEqual([
      "Fix: capital",
      "typo: not allowed",
    ]);
  });

  it("checkPrCommits на пустом диапазоне не требует коммитов", async () => {
    const repository = await createRepository();
    const base = await commit(repository, "chore: bootstrap");

    const invalid = checkPrCommits({ baseRef: base, headRef: base, cwd: repository });

    expect(invalid).toEqual([]);
  });
});
