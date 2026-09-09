import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkPrCommits, findInvalidSubjects, validatePrMessages } from "./check-pr-commits.mjs";

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
  it.each([
    { baseRef: "not-a-ref", headRef: "also-not-a-ref" },
    { baseRef: "", headRef: "HEAD" },
    { baseRef: undefined, headRef: "HEAD" },
  ])("gate отклоняет невалидные границы $baseRef..$headRef", async ({ baseRef, headRef }) => {
    const repository = await createRepository();

    await expect(
      checkPrCommits({ baseRef, headRef, title: "ci: update tooling", cwd: repository }),
    ).rejects.toThrow();
  });

  it("checkPrCommits пропускает валидные Conventional Commit subjects", async () => {
    const repository = await createRepository();
    const base = await commit(repository, "chore: bootstrap");
    await commit(repository, "fix(clean): correct roof evidence rule");
    await commit(repository, "feat: add elevator legal module");
    const head = await commit(repository, "docs: update readme");

    const invalid = await checkPrCommits({
      baseRef: base,
      headRef: head,
      title: "fix: preserve changes",
      cwd: repository,
    });

    expect(invalid).toEqual([]);
  });

  it("checkPrCommits находит неконвенциональные subjects", async () => {
    const repository = await createRepository();
    const base = await commit(repository, "chore: bootstrap");
    await commit(repository, "fix: valid subject");
    await commit(repository, "this is not conventional");
    const head = await commit(repository, "another bad one");

    const invalid = await checkPrCommits({
      baseRef: base,
      headRef: head,
      title: "fix: preserve changes",
      cwd: repository,
    });

    expect(invalid).toEqual(["another bad one", "this is not conventional"]);
  });

  it("findInvalidSubjects распознаёт типы, не входящие в спецификацию", () => {
    expect(findInvalidSubjects(["chore: ok", "typo: not allowed", "Fix: capital"]).sort()).toEqual([
      "Fix: capital",
      "typo: not allowed",
    ]);
  });

  it("checkPrCommits отклоняет пустой диапазон", async () => {
    const repository = await createRepository();
    const base = await commit(repository, "chore: bootstrap");

    await expect(
      checkPrCommits({
        baseRef: base,
        headRef: base,
        title: "ci: update tooling",
        cwd: repository,
      }),
    ).rejects.toThrow(/пуст/u);
  });
});

describe("соответствие заголовка PR уровню релиза", () => {
  it.each([
    { messages: ["feat: add option"], title: "docs: describe option" },
    { messages: ["ci: update tooling", "docs: update guide"], title: "feat: add tooling" },
    { messages: ["feat!: replace contract"], title: "feat: replace contract" },
    {
      messages: ["fix: update contract\n\nBREAKING CHANGE: remove old field"],
      title: "fix: update contract",
    },
    { messages: ["fix: correct option"], title: "fix!: correct option" },
  ])("отклоняет несовпадающий уровень: $title / $messages", async ({ messages, title }) => {
    expect(await validatePrMessages({ messages, title, currentMajor: 0 })).not.toEqual([]);
  });

  it.each([
    { messages: ["ci: update tooling", "docs: update guide"], title: "ci: update tooling" },
    {
      messages: [
        "feat: add option",
        "fix: correct option",
        "perf: speed up option",
        "docs: update guide",
      ],
      title: "fix: improve option",
    },
    {
      messages: ["feat: add option", "refactor!: replace contract"],
      title: "feat!: replace contract",
    },
    {
      messages: ["fix: update contract\n\nBREAKING CHANGE: remove old field"],
      title: "fix!: update contract",
    },
  ])("принимает совпадающий уровень до 1.0.0: $title", async ({ messages, title }) => {
    expect(await validatePrMessages({ messages, title, currentMajor: 0 })).toEqual([]);
  });

  it.each([
    "invalid title",
    "",
    "ci: ",
    "ci: valid\nfeat: injected",
    undefined,
  ])("отклоняет недопустимый заголовок %s", async (title) => {
    expect(
      await validatePrMessages({ messages: ["ci: update tooling"], title, currentMajor: 0 }),
    ).not.toEqual([]);
  });

  it("после 1.0.0 различает feat и fix по общим правилам", async () => {
    const messages = ["feat: add option", "fix: correct option"];
    expect(
      await validatePrMessages({ messages, title: "fix: improve option", currentMajor: 1 }),
    ).not.toEqual([]);
    expect(
      await validatePrMessages({ messages, title: "feat: improve option", currentMajor: 1 }),
    ).toEqual([]);
  });

  it("читает breaking footer из Git и проверяет его через gate", async () => {
    const repository = await createRepository();
    const baseRef = await commit(repository, "chore: bootstrap");
    const headRef = await commit(
      repository,
      "fix: update contract\n\nBREAKING CHANGE: remove old field",
    );
    const options = { baseRef, headRef, cwd: repository };
    expect(await checkPrCommits({ ...options, title: "fix: update contract" })).not.toEqual([]);
    expect(await checkPrCommits({ ...options, title: "fix!: update contract" })).toEqual([]);
  });

  it("выбирает stable release rules по target base для отставшей feature branch", async () => {
    const repository = await createRepository();
    await commit(repository, "chore: bootstrap");
    await execFileAsync("git", ["-C", repository, "checkout", "-b", "feature"]);
    const headRef = await commit(repository, "feat: add option");
    await execFileAsync("git", ["-C", repository, "checkout", "main"]);
    const baseRef = await commit(repository, "chore: stable transition");
    await execFileAsync("git", ["-C", repository, "tag", "v1.0.0"]);
    await execFileAsync("git", ["-C", repository, "checkout", "feature"]);

    const options = { baseRef, headRef, cwd: repository };
    expect(await checkPrCommits({ ...options, title: "fix: add option" })).not.toEqual([]);
    expect(await checkPrCommits({ ...options, title: "feat: add option" })).toEqual([]);
  });
});
