import { execFileSync } from "node:child_process";
import process from "node:process";

const versionTagPattern = /^v(\d+)\.(\d+)\.(\d+)$/;

// Baseline первого публичного beta-релиза, от которого стартует автоматизация (#52)
export const BASELINE_TAG = "v0.2.0";

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
    const match = versionTagPattern.exec(tag);
    if (match) {
      versions.push({
        tag,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
      });
    }
  }

  return versions;
}

export function currentMajorFromRepo(cwd = process.cwd()) {
  const [highest] = reachableVersionTags(cwd);
  return highest ? highest.major : 0;
}

// Fail-closed bootstrap: пока baseline недостижим и stable-переход не состоялся,
// автоматический релиз запрещён, чтобы semantic-release не начал историю со своего
// стандартного первого v1.0.0
export function isReleaseBootstrapReady(cwd = process.cwd()) {
  const versions = reachableVersionTags(cwd);
  const stableReached = versions.some((version) => version.major >= 1);
  return stableReached || versions.some((version) => version.tag === BASELINE_TAG);
}

export function buildReleaseConfig(currentMajor) {
  return {
    branches: ["main"],
    tagFormat: "v${version}",
    plugins: [
      "./scripts/release-bootstrap-guard.mjs",
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
