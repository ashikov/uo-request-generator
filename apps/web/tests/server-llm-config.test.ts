import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const applicationDirectory = fileURLToPath(new URL("..", import.meta.url));
const llmVariableNames = [
  "LLM_API_PROTOCOL",
  "LLM_API_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_PROVIDER",
  "LLM_AUTH_SCHEME",
  "LLM_FOLDER_ID",
] as const;

function startServerWithPartialLlmConfiguration(): Promise<{
  code: number | null;
  stderr: string;
  timedOut: boolean;
}> {
  const environment = { ...process.env };
  for (const variableName of llmVariableNames) {
    delete environment[variableName];
  }
  environment.LLM_API_URL = "https://provider.example/v1/chat/completions";
  environment.LLM_API_KEY = "startup-private-api-key-sentinel";
  environment.LLM_AUTH_SCHEME = "Bearer";
  environment.LLM_MODEL = "startup-private-model-sentinel";
  environment.PORT = "39891";

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--conditions=development", "--import", "tsx", "src/server.ts"],
      {
        cwd: applicationDirectory,
        env: environment,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 2_000);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr, timedOut });
    });
  });
}

describe("startup с LLM-конфигурацией", () => {
  it("не запускает HTTP-сервис с частичной custom-конфигурацией", async () => {
    const result = await startServerWithPartialLlmConfiguration();

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid LLM configuration");
    expect(result.stderr).not.toContain("startup-private-api-key-sentinel");
    expect(result.stderr).not.toContain("startup-private-model-sentinel");
    expect(result.stderr).not.toContain("https://provider.example/v1/chat/completions");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
