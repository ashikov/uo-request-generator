import path from "node:path";
import process from "node:process";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
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

async function main() {
  const cwd = process.cwd();
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
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
  };
  delete environment["GITHUB_HEAD_REF"];
  delete environment["GITHUB_BASE_REF"];

  const result = await semanticRelease(
    {
      cwd,
      noCi: true,
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

await main().catch((error) => {
  console.error(`Локальный dry-run завершился ошибкой: ${error.message}`);
  process.exitCode = 1;
});
