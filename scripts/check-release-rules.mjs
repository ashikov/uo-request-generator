import { analyzeCommits } from "@semantic-release/commit-analyzer";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildReleaseConfig, parseVersionTag, releaseStateFromVersions } from "./release-rules.mjs";

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

const tagScenarios = [
  { tag: "v0.2.0", expected: [0, 2, 0] },
  { tag: "v1.0.0", expected: [1, 0, 0] },
  { tag: "v12.34.56", expected: [12, 34, 56] },
  { tag: "v01.0.0", expected: null },
  { tag: "v1.01.0", expected: null },
  { tag: "v1.0.01", expected: null },
  { tag: "v1.0", expected: null },
  { tag: "v1", expected: null },
  { tag: "v1.0.0-beta", expected: null },
  { tag: "v1.0.0+build", expected: null },
  { tag: "v0.0.0-dev", expected: null },
  { tag: "1.0.0", expected: null },
  { tag: "release-v1.0.0", expected: null },
];

const releaseStateScenarios = [
  {
    name: "один v0.2.0 даёт pre-1.0 режим без stable",
    tags: ["v0.2.0"],
    expected: {
      stableReached: false,
      baselineReached: true,
      contradictory: false,
      currentMajor: 0,
    },
  },
  {
    name: "неканонический v01.0.0 не включает stable mode",
    tags: ["v0.2.0", "v01.0.0"],
    expected: {
      stableReached: false,
      baselineReached: true,
      contradictory: false,
      currentMajor: 0,
    },
  },
  {
    name: "v2.0.0 без v1.0.0 считается противоречием",
    tags: ["v0.2.0", "v2.0.0"],
    expected: { stableReached: false, baselineReached: true, contradictory: true, currentMajor: 0 },
  },
  {
    name: "v1.2.0 без v1.0.0 считается противоречием",
    tags: ["v0.2.0", "v1.2.0"],
    expected: { stableReached: false, baselineReached: true, contradictory: true, currentMajor: 0 },
  },
  {
    name: "явное v1.0.0 включает stable mode",
    tags: ["v0.2.0", "v1.0.0"],
    expected: { stableReached: true, baselineReached: true, contradictory: false, currentMajor: 1 },
  },
  {
    name: "v1.0.0 и v2.0.0 дают stable-режим с currentMajor 2",
    tags: ["v0.2.0", "v1.0.0", "v2.0.0"],
    expected: { stableReached: true, baselineReached: true, contradictory: false, currentMajor: 2 },
  },
  {
    name: "v0.2.0 и v1.0.0 без baseline-тега всё равно дают stable",
    tags: ["v1.0.0"],
    expected: {
      stableReached: true,
      baselineReached: false,
      contradictory: false,
      currentMajor: 1,
    },
  },
  {
    name: "без тегов — pre-1.0 режим без baseline",
    tags: [],
    expected: {
      stableReached: false,
      baselineReached: false,
      contradictory: false,
      currentMajor: 0,
    },
  },
];

function checkTagParsing() {
  const failures = [];
  for (const scenario of tagScenarios) {
    const result = parseVersionTag(scenario.tag);
    const passed =
      scenario.expected === null
        ? result === null
        : result !== null &&
          result.major === scenario.expected[0] &&
          result.minor === scenario.expected[1] &&
          result.patch === scenario.expected[2];
    if (!passed) {
      failures.push(
        `тег ${scenario.tag}: ожидался ${String(scenario.expected)}, получен ${String(result)}`,
      );
    }
    console.log(`${passed ? "PASS" : "FAIL"}  ${scenario.tag}`);
  }
  return failures;
}

function checkReleaseState() {
  const failures = [];
  for (const scenario of releaseStateScenarios) {
    const versions = scenario.tags.map(parseVersionTag).filter((version) => version !== null);
    const state = releaseStateFromVersions(versions);
    const passed =
      state.stableReached === scenario.expected.stableReached &&
      state.baselineReached === scenario.expected.baselineReached &&
      state.contradictory === scenario.expected.contradictory &&
      state.currentMajor === scenario.expected.currentMajor;
    if (!passed) {
      failures.push(
        `${scenario.name}: ожидалось ${JSON.stringify(scenario.expected)}, получено ${JSON.stringify(state)}`,
      );
    }
    console.log(`${passed ? "PASS" : "FAIL"}  ${scenario.name}`);
  }
  return failures;
}

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
  const failures = [
    ...checkTagParsing(),
    ...checkReleaseState(),
    ...(await checkScenarios()),
    ...checkConfigStructure(),
  ];

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
