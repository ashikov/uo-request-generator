import process from "node:process";
import { BASELINE_TAG, isReleaseBootstrapReady } from "./release-rules.mjs";

// generateNotes выполняется только когда релиз точно будет опубликован, и раньше
// publish-шага: исключение здесь не даёт создать ни тег, ни GitHub Release
export async function generateNotes(pluginConfig, context) {
  if (!isReleaseBootstrapReady(context.cwd ?? process.cwd())) {
    throw new Error(
      `Автоматический релиз запрещён: baseline ${BASELINE_TAG} недостижим из текущей истории main. ` +
        `Создайте тег ${BASELINE_TAG} и GitHub Release вручную согласно #52, после чего автоматизация продолжит с него.`,
    );
  }
}
