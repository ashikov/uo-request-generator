import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import semanticRelease from "semantic-release";
import { buildReleaseConfig, currentMajorFromRepo } from "./release-rules.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function silentStream() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

// Основная цель — доказать расчёт версии, а не состояние деплоя. Dry-run ничего не
// публикует и не создаёт тег/Release, поэтому проверка существования GitHub Release
// (оранжевый барьер для реальной публикации) заменяется заглушкой. Проверка
// reachability baseline-тега остаётся настоящей.
export const dryRunFetchRelease = async () => ({ exists: true });

async function runDryRun(cwd, repositoryUrl) {
  // Бросает ошибку при противоречивой истории релизов (e.g. v2.0.0 без v1.0.0)
  const currentMajor = currentMajorFromRepo(cwd);

  const plugins = buildReleaseConfig(currentMajor, {
    fetchRelease: dryRunFetchRelease,
  }).plugins.map((plugin) => {
    if (typeof plugin === "string") {
      return path.resolve(projectRoot, plugin);
    }
    const [name, pluginConfig] = plugin;
    if (name === "@semantic-release/github") {
      return [path.resolve(projectRoot, "./scripts/release-noop-plugin.mjs"), pluginConfig];
    }
    // Локальные плагины резолвятся в абсолютные пути, npm-пакеты semantic-release
    // остаются как есть — они находятся в node_modules проекта
    return name.startsWith("./")
      ? [path.resolve(projectRoot, name), pluginConfig]
      : [name, pluginConfig];
  });

  const environment = {
    ...process.env,
    GITHUB_TOKEN: "release-dry-run-local",
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY ?? "local/uo-request-generator",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
  };
  delete environment["GITHUB_HEAD_REF"];
  delete environment["GITHUB_BASE_REF"];

  const result = await semanticRelease(
    {
      cwd,
      noCi: true,
      repositoryUrl,
      dryRun: true,
      branches: ["main"],
      tagFormat: "v${version}",
      plugins,
    },
    {
      cwd,
      env: environment,
      stdout: silentStream(),
      stderr: silentStream(),
    },
  );

  if (result?.nextRelease) {
    console.log(`Расчёт версии: ${result.nextRelease.version}`);
    console.log(`Тип релиза: ${result.nextRelease.type ?? "unknown"}`);
  } else {
    console.log(
      "Релиз не создаётся: текущий набор последних коммитов не содержит значимых изменений или уже выпущен.",
    );
  }
}

async function main() {
  const source = process.cwd();
  const git = (args) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const head = git(["-C", source, "rev-parse", "HEAD"]).trim();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "release-dry-run-"));
  try {
    // semantic-release делает fetch даже в dry-run. Обе копии локальные:
    // расчёт идёт с исходного HEAD как main, не затрагивая remote и исходные refs.
    const origin = path.join(temporaryDirectory, "origin.git");
    const checkout = path.join(temporaryDirectory, "checkout");
    git(["clone", "--bare", "--no-hardlinks", source, origin]);
    git(["-C", origin, "update-ref", "refs/heads/main", head]);
    git(["clone", "--no-hardlinks", "--branch", "main", origin, checkout]);
    await runDryRun(checkout, pathToFileURL(origin).href);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main().catch((error) => {
  console.error(`Локальный dry-run завершился ошибкой: ${error.message}`);
  process.exitCode = 1;
});
