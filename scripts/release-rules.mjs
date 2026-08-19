import { execFileSync } from "node:child_process";
import process from "node:process";

const versionTagPattern = /^v(\d+)\.(\d+)\.(\d+)$/;

export function releaseRulesFor(currentMajor) {
  if (currentMajor === 0) {
    return [
      { breaking: true, release: "minor" },
      { type: "feat", release: "minor" },
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

export function currentMajorFromRepo(cwd = process.cwd()) {
  let stdout;
  try {
    stdout = execFileSync("git", ["-C", cwd, "tag", "--list", "v*", "--sort=-v:refname"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return 0;
  }

  for (const tag of stdout.split("\n")) {
    const match = versionTagPattern.exec(tag.trim());
    if (match) {
      return Number(match[1]);
    }
  }

  return 0;
}

export function buildReleaseConfig(currentMajor) {
  return {
    branches: ["main"],
    tagFormat: "v${version}",
    plugins: [
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
