import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import semanticRelease from "semantic-release";
import { BASELINE_TAG, buildReleaseConfig, currentMajorFromRepo } from "./release-rules.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "release-scenarios-"));
  // Локальный bare-repository как origin: semantic-release расширяет ветки через
  // git ls-remote, поэтому сетевых обращений быть не должно.
  // Remote задаётся именно file:// URL: release-notes-generator парсит
  // repositoryUrl через new URL(), и сырой локальный путь падает с Invalid URL
  const originDirectory = await mkdtemp(path.join(os.tmpdir(), "release-scenarios-origin-"));
  temporaryRepositories.push(directory, originDirectory);
  await execFileAsync("git", ["init", "--initial-branch=main", "--quiet", directory]);
  await execFileAsync("git", [
    "init",
    "--bare",
    "--initial-branch=main",
    "--quiet",
    originDirectory,
  ]);
  await execFileAsync("git", [
    "-C",
    directory,
    "config",
    "user.email",
    "release-scenarios@example.invalid",
  ]);
  await execFileAsync("git", ["-C", directory, "config", "user.name", "Release Scenarios"]);
  await execFileAsync("git", [
    "-C",
    directory,
    "remote",
    "add",
    "origin",
    pathToFileURL(originDirectory).href,
  ]);
  return directory;
}

async function syncOrigin(repository: string): Promise<void> {
  const { stdout } = await execFileAsync("git", ["-C", repository, "remote", "get-url", "origin"]);
  await execFileAsync("git", ["-C", repository, "push", "--quiet", stdout.trim(), "main"]);
}

async function commitEmpty(repository: string, message: string): Promise<void> {
  await execFileAsync("git", ["-C", repository, "commit", "--allow-empty", "--message", message]);
}

async function tagAnnotated(repository: string, tag: string): Promise<void> {
  await execFileAsync("git", ["-C", repository, "tag", "--annotate", "--message", tag, tag]);
}

// Тег на безродной ветке недостижим из main и не должен влиять на релиз
async function tagOnOrphanBranch(
  repository: string,
  commitMessage: string,
  tag: string,
): Promise<void> {
  await execFileAsync("git", ["-C", repository, "checkout", "--orphan", "stray-history"]);
  await commitEmpty(repository, commitMessage);
  await tagAnnotated(repository, tag);
  await execFileAsync("git", ["-C", repository, "checkout", "main"]);
}

function silentStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

async function runDryRunRelease(repository: string) {
  // Локальные плагины резолвятся относительно cwd временного репозитория,
  // поэтому пути из конфигурации переписываются в абсолютные.
  // verifyConditions у @semantic-release/github проверяет токен через сеть:
  // для проверки вычисления версии его заменяет локальный noop-плагин
  const plugins = buildReleaseConfig(currentMajorFromRepo(repository)).plugins.map((plugin) => {
    if (typeof plugin === "string") {
      return path.resolve(projectRoot, plugin);
    }
    const [name, pluginConfig] = plugin;
    return name === "@semantic-release/github"
      ? [path.resolve(projectRoot, "./scripts/release-noop-plugin.mjs"), pluginConfig]
      : plugin;
  });

  // На CI runner'а semantic-release берёт ветку из переменных окружения и выходит
  // до пайплайна, если она не входит в configured branches. Сценарии описывают
  // push в main, поэтому окружение runner'а явно приводится к этому случаю
  const environment = {
    ...process.env,
    GITHUB_TOKEN: "release-scenarios-fake-token",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
  };
  delete environment["GITHUB_HEAD_REF"];
  delete environment["GITHUB_BASE_REF"];

  return semanticRelease(
    {
      cwd: repository,
      // На CI runner'а semantic-release видит pull request-окружение и выходит
      // до пайплайна, поэтому детекция CI в сценариях явно выключена
      noCi: true,
      dryRun: true,
      branches: ["main"],
      tagFormat: "v${version}",
      plugins,
    },
    {
      cwd: repository,
      env: environment,
      stdout: silentStream(),
      stderr: silentStream(),
    },
  );
}

async function listTags(repository: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", repository, "tag", "--list"]);
  return stdout.split("\n").filter((tag) => tag.length > 0);
}

describe("сценарии выпуска на синтетической Git-истории", () => {
  it("reachable v0.2.0 + fix -> v0.2.1", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "fix: correct roof evidence rule");

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("0.2.1");
  }, 120_000);

  it("reachable v0.2.0 + perf -> v0.2.1", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "perf: optimize request parsing");

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("0.2.1");
  }, 120_000);

  it("reachable v0.2.0 + feat -> v0.2.1", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "feat: add elevator legal module");

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("0.2.1");
  }, 120_000);

  it("reachable v0.2.x + breaking change -> следующий v0.(minor+1).0", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "fix: adjust wording");
    await tagAnnotated(repository, "v0.2.3");
    await commitEmpty(
      repository,
      "feat!: change public request contract\n\nBREAKING CHANGE: new contract",
    );

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("0.3.0");
  }, 120_000);

  it("feat вместе с fix дают patch", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "fix: adjust wording");
    await commitEmpty(repository, "feat: add new legal module");

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("0.2.1");
  }, 120_000);

  it("feat вместе с breaking change дают minor", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "feat: add new legal module");
    await commitEmpty(
      repository,
      "refactor!: rework request draft contract\n\nBREAKING CHANGE: contract reworked",
    );

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("0.3.0");
  }, 120_000);

  it("docs и chore не создают релиз", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "docs: update readme");
    await commitEmpty(repository, "chore: update tooling");

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease).toBeUndefined();
  }, 120_000);

  it("reachable v1.0.0 + fix -> patch по обычному SemVer", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "chore: stable transition");
    await tagAnnotated(repository, "v1.0.0");
    await commitEmpty(repository, "fix: correct roof evidence rule");

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("1.0.1");
  }, 120_000);

  it("reachable v1.0.0 + feat -> minor по обычному SemVer", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "chore: stable transition");
    await tagAnnotated(repository, "v1.0.0");
    await commitEmpty(repository, "feat: add elevator legal module");

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("1.1.0");
  }, 120_000);

  it("reachable v1.0.0 + breaking change -> major по обычному SemVer", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await commitEmpty(repository, "chore: stable transition");
    await tagAnnotated(repository, "v1.0.0");
    await commitEmpty(
      repository,
      "feat!: change public request contract\n\nBREAKING CHANGE: new contract",
    );

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("2.0.0");
  }, 120_000);

  it("без reachable v0.2.0 автоматический релиз запрещён и v1.0.0 не создаётся", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "feat: add elevator legal module");
    await tagOnOrphanBranch(repository, "chore: historical release", "v1.0.0");
    await syncOrigin(repository);
    const tagsBefore = await listTags(repository);

    await expect(runDryRunRelease(repository)).rejects.toThrow(/недоступен|недостижим|baseline/u);

    expect(await listTags(repository)).toEqual(tagsBefore);
  }, 120_000);

  it("unreachable исторический тег не влияет на release mode", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await tagOnOrphanBranch(repository, "chore: stray high version", "v9.9.9");
    await commitEmpty(repository, "fix: correct roof evidence rule");

    await syncOrigin(repository);

    const result = await runDryRunRelease(repository);

    expect(result?.nextRelease?.version).toBe("0.2.1");
  }, 120_000);

  it("повторный запуск на уже выпущенном commit не создаёт второй релиз", async () => {
    const repository = await createRepository();
    await commitEmpty(repository, "chore: bootstrap");
    await tagAnnotated(repository, BASELINE_TAG);
    await syncOrigin(repository);

    const firstRun = await runDryRunRelease(repository);
    const secondRun = await runDryRunRelease(repository);

    expect(firstRun?.nextRelease).toBeUndefined();
    expect(secondRun?.nextRelease).toBeUndefined();
  }, 120_000);
});
