import { analyzeCommits } from "@semantic-release/commit-analyzer";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildReleaseConfig } from "./release-rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scenarios = [
  {
    name: "fix после v0.2.0 даёт patch",
    currentMajor: 0,
    commits: [{ hash: "a", message: "fix: correct roof evidence rule" }],
    expected: "patch",
  },
  {
    name: "perf после v0.2.0 даёт patch",
    currentMajor: 0,
    commits: [{ hash: "b", message: "perf: optimize request parsing" }],
    expected: "patch",
  },
  {
    name: "feat до 1.0.0 даёт patch, а не minor",
    currentMajor: 0,
    commits: [{ hash: "c", message: "feat: add elevator legal module" }],
    expected: "patch",
  },
  {
    name: "breaking change до 1.0.0 даёт следующий minor, а не v1.0.0",
    currentMajor: 0,
    commits: [
      {
        hash: "d",
        message: "feat!: change public request contract\n\nBREAKING CHANGE: new contract",
      },
    ],
    expected: "minor",
  },
  {
    name: "docs и chore не создают версию",
    currentMajor: 0,
    commits: [
      { hash: "e", message: "docs: update readme" },
      { hash: "f", message: "chore: update tooling" },
    ],
    expected: null,
  },
  {
    name: "в стабильном режиме breaking change увеличивает major",
    currentMajor: 1,
    commits: [
      {
        hash: "g",
        message: "fix!: remove legacy API\n\nBREAKING CHANGE: legacy API removed",
      },
    ],
    expected: "major",
  },
  {
    name: "несколько неразрывных изменений образуют одну версию по максимуму",
    currentMajor: 0,
    commits: [
      { hash: "h", message: "fix: adjust wording" },
      { hash: "i", message: "feat: add new legal module" },
    ],
    expected: "patch",
  },
  {
    name: "feat вместе с breaking change образуют minor",
    currentMajor: 0,
    commits: [
      { hash: "j", message: "feat: add new legal module" },
      {
        hash: "k",
        message: "refactor!: rework request draft contract\n\nBREAKING CHANGE: contract reworked",
      },
    ],
    expected: "minor",
  },
];

const silentLogger = {
  error: () => {},
  log: () => {},
  warn: () => {},
};

function commitAnalyzerConfig(currentMajor) {
  const config = buildReleaseConfig(currentMajor);
  return config.plugins.find(([name]) => name === "@semantic-release/commit-analyzer")[1];
}

async function checkScenarios() {
  const failures = [];

  for (const scenario of scenarios) {
    const releaseType = await analyzeCommits(commitAnalyzerConfig(scenario.currentMajor), {
      commits: scenario.commits,
      cwd: root,
      logger: silentLogger,
    });
    const passed = releaseType === scenario.expected;
    if (!passed) {
      failures.push(
        `${scenario.name}: ожидался release type ${String(scenario.expected)}, получен ${String(releaseType)}`,
      );
    }
    console.log(`${passed ? "PASS" : "FAIL"}  ${scenario.name}`);
  }

  return failures;
}

function checkConfigStructure() {
  const failures = [];
  const config = buildReleaseConfig(0);

  if (JSON.stringify(config.branches) !== JSON.stringify(["main"])) {
    failures.push("branches должен содержать только main");
  }
  if (config.tagFormat !== "v${version}") {
    failures.push("tagFormat должен быть v${version}");
  }

  const pluginNames = config.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
  for (const required of [
    "./scripts/release-bootstrap-guard.mjs",
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github",
  ]) {
    if (!pluginNames.includes(required)) {
      failures.push(`отсутствует плагин ${required}`);
    }
  }

  if (pluginNames[0] !== "./scripts/release-bootstrap-guard.mjs") {
    failures.push(
      "bootstrap-guard должен идти первым, чтобы блокировать публикацию до создания тега",
    );
  }

  const githubConfig = config.plugins.find(([name]) => name === "@semantic-release/github")[1];
  if (githubConfig.successComment !== false) {
    failures.push("github successComment должен быть отключён");
  }
  if (githubConfig.failComment !== false) {
    failures.push("github failComment должен быть отключён");
  }

  return failures;
}

async function main() {
  const failures = [...(await checkScenarios()), ...checkConfigStructure()];

  if (failures.length > 0) {
    console.error("Найдены нарушения правил релиза:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Правила выпуска версий корректны.");
  }
}

await main();
