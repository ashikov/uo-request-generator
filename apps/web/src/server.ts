import { OpenAiCompatibleGateway } from "@uo-request-generator/llm";
import { createApp } from "./app.js";

const DEFAULT_PORT = 3000;

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

function createLlmGateway() {
  const apiKey = process.env.LLM_API_KEY;

  if (apiKey === undefined || apiKey === "") {
    return undefined;
  }

  const apiUrl = process.env.LLM_API_URL;
  const userModel = process.env.LLM_MODEL;
  const authScheme = process.env.LLM_AUTH_SCHEME;
  const folderId = process.env.LLM_FOLDER_ID;

  const extraHeaders: Record<string, string> = {};
  if (folderId !== undefined && folderId !== "") {
    extraHeaders["x-folder-id"] = folderId;
  }

  const model =
    userModel ??
    (folderId !== undefined && folderId !== "" ? `gpt://${folderId}/yandexgpt/latest` : undefined);

  return new OpenAiCompatibleGateway({
    apiKey,
    ...(apiUrl !== undefined ? { apiUrl } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(authScheme !== undefined ? { authScheme } : {}),
    ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
  });
}

async function main(): Promise<void> {
  const llmGateway = createLlmGateway();
  const app = llmGateway !== undefined ? createApp({ llmGateway }) : createApp();
  let isClosing = false;

  async function close(): Promise<void> {
    if (isClosing) {
      return;
    }

    isClosing = true;
    await app.close();
  }

  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });

  try {
    await app.listen({
      host: process.env.HOST ?? "0.0.0.0",
      port: readPort(process.env.PORT),
    });
  } catch {
    process.exitCode = 1;
    await close();
  }
}

void main();
