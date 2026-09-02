import { execFileSync } from "node:child_process";
import process from "node:process";

// Только канонические SemVer без ведущих нулей и без pre-release меток: теги вроде
// v01.0.0 или v1.0.0-beta не являются валидной версией релиза и не учитываются
const versionTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Разбирает версионный тег в компоненты либо возвращает null для неканонических тегов
export function parseVersionTag(tag) {
  const match = versionTagPattern.exec(tag);
  if (!match) {
    return null;
  }
  return {
    tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

// Baseline первого публичного beta-релиза, от которого стартует автоматизация (#52)
export const BASELINE_TAG = "v0.2.0";

// Переход на стабильную версию возможен только через явное v1.0.0 (#52)
const STABLE_TAG = "v1.0.0";

export function releaseRulesFor(currentMajor) {
  if (currentMajor === 0) {
    return [
      { breaking: true, release: "minor" },
      { type: "feat", release: "patch" },
      { type: "fix", release: "patch" },
      { type: "perf", release: "patch" },
    ];
  }

  return [
    { breaking: true, release: "major" },
    { type: "feat", release: "minor" },
    { type: "fix", release: "patch" },
    { type: "perf", release: "patch" },
  ];
}

function listGitVersionTags(cwd) {
  // Ошибки чтения Git-состояния не глушатся: для безопасности релиза нужен fail closed
  return execFileSync(
    "git",
    ["-C", cwd, "tag", "--list", "v*", "--merged", "HEAD", "--sort=-v:refname"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

// Только теги, достижимые из HEAD, — та же история релизов, которую видит semantic-release
export function reachableVersionTags(cwd = process.cwd()) {
  const stdout = listGitVersionTags(cwd);

  const versions = [];
  for (const line of stdout.split("\n")) {
    const tag = line.trim();
    const version = parseVersionTag(tag);
    if (version) {
      versions.push(version);
    }
  }

  return versions;
}

// Состояние релизной истории, вычисляемое по достижимым версионным тегам
export function releaseStateFromVersions(versions) {
  const stableReached = versions.some((version) => version.tag === STABLE_TAG);
  const baselineReached = versions.some((version) => version.tag === BASELINE_TAG);
  // Противоречие fail-open: достижимый тег с major >= 1 без явного v1.0.0 означает,
  // что история «перепрыгнула» стабильный переход. Такое состояние блокирует релиз,
  // а не трактуется как корректный stable-переход
  const contradictory = versions.some((version) => version.major >= 1) && !stableReached;
  // До v1.0.0 действует pre-1.0 политика выпусков, независимо от того, какие
  // строго большие версии присутствуют в истории (если только состояние не противоречиво)
  const currentMajor = stableReached
    ? Math.max(...versions.filter((version) => version.major >= 1).map((version) => version.major))
    : 0;
  return { versions, stableReached, baselineReached, contradictory, currentMajor };
}

export function releaseState(cwd = process.cwd()) {
  return releaseStateFromVersions(reachableVersionTags(cwd));
}

export function currentMajorFromRepo(cwd = process.cwd()) {
  const state = releaseState(cwd);
  if (state.contradictory) {
    throw new Error(
      `Противоречивая история релизов: достижим тег с major >= 1 без reachable ${STABLE_TAG}. ` +
        `Стабильный переход возможен только через явное ${STABLE_TAG}.`,
    );
  }
  return state.currentMajor;
}

// Fail-closed bootstrap: пока baseline недостижим и stable-переход не состоялся,
// автоматический релиз запрещён, чтобы semantic-release не начал историю со своего
// стандартного первого v1.0.0
export function isReleaseBootstrapReady(cwd = process.cwd()) {
  const state = releaseState(cwd);
  if (state.contradictory) {
    throw new Error(
      `Противоречивая история релизов: достижим тег с major >= 1 без reachable ${STABLE_TAG}. ` +
        `Стабильный переход возможен только через явное ${STABLE_TAG}.`,
    );
  }
  return state.stableReached || state.baselineReached;
}

export function buildReleaseConfig(currentMajor, { fetchRelease } = {}) {
  return {
    branches: ["main"],
    tagFormat: "v${version}",
    plugins: [
      ["./scripts/release-bootstrap-guard.mjs", { fetchRelease }],
      [
        "@semantic-release/commit-analyzer",
        {
          preset: "conventionalcommits",
          releaseRules: releaseRulesFor(currentMajor),
        },
      ],
      [
        "@semantic-release/release-notes-generator",
        {
          preset: "conventionalcommits",
        },
      ],
      [
        "@semantic-release/github",
        {
          successComment: false,
          failComment: false,
        },
      ],
    ],
  };
}
