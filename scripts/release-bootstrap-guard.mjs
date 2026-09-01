import process from "node:process";
import { BASELINE_TAG, releaseState } from "./release-rules.mjs";

// Реальный клиент GitHub API. Отсутствие Release, ошибка сети, неожиданный статус
// или неоднозначный ответ должны блокировать выпуск (fail-closed): внутри возвращается
// { exists: false }, а любое исключение пробрасывается наверх.
async function defaultFetchRelease(repository, tag) {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) {
    return { exists: false };
  }
  if (!response.ok) {
    throw new Error(`GitHub API вернул статус ${response.status}`);
  }
  const body = await response.json();
  if (body?.tag_name !== tag) {
    throw new Error("GitHub API вернул неоднозначный ответ о Release");
  }
  return { exists: true };
}

export async function checkBaselineBootstrap({ environment, cwd, fetchRelease }) {
  const state = releaseState(cwd);
  if (state.contradictory) {
    return {
      allowed: false,
      reason: "противоречивая история релизов: достижим тег с major >= 1 без reachable v1.0.0",
    };
  }
  if (state.stableReached) {
    return { allowed: true };
  }
  if (!state.baselineReached) {
    return { allowed: false, reason: `baseline ${BASELINE_TAG} недостижим` };
  }

  const repository = environment.GITHUB_REPOSITORY;
  if (!repository) {
    return { allowed: false, reason: "не задан GITHUB_REPOSITORY" };
  }

  let release;
  try {
    release = await fetchRelease(repository, BASELINE_TAG);
  } catch (error) {
    return { allowed: false, reason: `не удалось проверить GitHub Release: ${error.message}` };
  }
  if (release?.exists !== true) {
    return { allowed: false, reason: `GitHub Release ${BASELINE_TAG} отсутствует` };
  }
  return { allowed: true };
}

// generateNotes выполняется только когда релиз точно будет опубликован, и раньше
// publish-шага: исключение здесь не даёт создать ни тег, ни GitHub Release
export async function generateNotes(pluginConfig, context) {
  const { allowed, reason } = await checkBaselineBootstrap({
    environment: context.env,
    cwd: context.cwd ?? process.cwd(),
    fetchRelease: pluginConfig.fetchRelease ?? defaultFetchRelease,
  });
  if (!allowed) {
    throw new Error(
      `Автоматический релиз запрещён: ${reason}. ` +
        `Bootstrap выпуска (#52) требует одновременно reachable Git tag и GitHub Release ` +
        `${BASELINE_TAG} до stable-перехода, после чего автоматизация продолжит с него.`,
    );
  }
}
