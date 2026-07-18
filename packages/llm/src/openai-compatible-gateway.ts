import {
  generateRequestResultSchema,
  generateRequestLimits,
  type GenerateRequestInput,
  type GenerateRequestResult,
  type LlmGateway,
} from "@uo-request-generator/core";
import { GenerationProviderUnavailableError } from "./disabled-llm-gateway.js";

export type OpenAiCompatibleGatewayConfig = {
  apiUrl?: string;
  apiKey: string;
  model?: string;
  /** Схема авторизации: "Api-Key" (для Yandex AI) или "Bearer" (для OpenAI/Groq) */
  authScheme?: string;
  /** Заголовки, которые нужно добавить к запросу (например x-folder-id для Yandex AI) */
  extraHeaders?: Record<string, string>;
  /** Таймаут HTTP-запроса в миллисекундах (по умолчанию 30 000) */
  timeoutMs?: number;
};

type OpenAiChatMessage = {
  role: "system" | "user";
  content: string;
};

type OpenAiChatCompletionRequest = {
  model: string;
  messages: OpenAiChatMessage[];
  temperature: number;
};

type OpenAiChatCompletionResponse = {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
};

/** @see https://yandex.cloud/ru/docs/yandexgpt/api-ref/v1/ */
const DEFAULT_API_URL = "https://ai.api.cloud.yandex.net/v1/chat/completions";

const SYSTEM_PROMPT = [
  "Ты — помощник жителя многоквартирного дома. Составь официальную заявку для управляющей организации (УО) по описанию проблемы.",
  "",
  "Правила:",
  "- Используй официально-деловой тон",
  "- Подробно опиши проблему, её признаки и последствия",
  "- Укажи последствия, только если они известны из ввода",
  "- Используй фразу «На основании вышеизложенного прошу:»",
  "- Добавь раздел «Прошу:» с нумерованными пунктами",
  "- Преобразуй эмоции в наблюдаемые факты",
  "- Не придумывай место, причину, виновника или повреждения",
  "- Не добавляй неподтверждённые обвинения",
  "- Не добавляй вымышленные даты, номера договоров и актов",
  "",
  "Строго соблюдай формат ответа:",
  "ЗАГОЛОВОК: <заголовок до 120 символов>",
  "",
  "<подробное описание проблемы, признаков и последствий>",
  "",
  "На основании вышеизложенного прошу:",
  "",
  "1. <пункт>",
  "2. <пункт>",
  "3. <пункт>",
  "",
  "ПРЕДУПРЕЖДЕНИЯ:",
  "— <предупреждение, если нужно>",
].join("\n");

function parseResponse(text: string): GenerateRequestResult {
  const lines = text.split("\n").map((l) => l.trim());

  const titleLine = lines.find((l) => l.startsWith("ЗАГОЛОВОК:"));
  const titleIdx = titleLine !== undefined ? lines.indexOf(titleLine) : -1;
  const warningsIdx = lines.findIndex((l) => l.startsWith("ПРЕДУПРЕЖДЕНИЯ:"));

  if (titleLine === undefined) {
    throw new Error("LLM вернул некорректный формат заявки");
  }

  const title = titleLine.slice("ЗАГОЛОВОК:".length).trim();
  if (title.length === 0) {
    throw new Error("LLM вернул некорректный формат заявки");
  }

  const bodyEnd = warningsIdx !== -1 ? warningsIdx : lines.length;
  const body = lines
    .slice(titleIdx + 1, bodyEnd)
    .filter((l) => l.length > 0)
    .join("\n");

  const warnings: string[] = [];
  if (warningsIdx !== -1) {
    for (let i = warningsIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const trimmed = line.replace(/^[—\-•]\s*/, "").trim();
      if (trimmed.length > 0) {
        warnings.push(trimmed);
      }
    }
  }

  const validWarnings = warnings
    .slice(0, generateRequestLimits.result.warningsMax)
    .map((w) => w.slice(0, generateRequestLimits.result.warningMax))
    .filter((w) => w.length > 0);

  const result = generateRequestResultSchema.safeParse({
    title: title.slice(0, generateRequestLimits.result.titleMax),
    body: body.slice(0, generateRequestLimits.result.bodyMax),
    warnings: validWarnings,
  });

  if (!result.success) {
    throw new Error("LLM вернул некорректный формат заявки");
  }

  return result.data;
}

export class OpenAiCompatibleGateway implements LlmGateway {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly authScheme: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(config: OpenAiCompatibleGatewayConfig) {
    if (!config.apiKey) {
      throw new Error("LLM_API_KEY не может быть пустым");
    }

    this.apiUrl = config.apiUrl ?? DEFAULT_API_URL;
    this.apiKey = config.apiKey;
    this.model = config.model ?? "yandexgpt/latest";
    this.authScheme = config.authScheme ?? "Api-Key";
    this.extraHeaders = config.extraHeaders ?? {};
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async generateRequest(input: GenerateRequestInput): Promise<GenerateRequestResult> {
    const userMessage = input.location
      ? `Проблема: ${input.description}\n\nМесто: ${input.location}`
      : `Проблема: ${input.description}`;

    const requestBody: OpenAiChatCompletionRequest = {
      model: this.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
    };

    let response: Response;

    try {
      const signal = AbortSignal.timeout(this.timeoutMs);
      response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${this.authScheme} ${this.apiKey}`,
          ...this.extraHeaders,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new GenerationProviderUnavailableError();
      }
      throw new GenerationProviderUnavailableError();
    }

    if (!response.ok) {
      throw new GenerationProviderUnavailableError();
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      throw new GenerationProviderUnavailableError();
    }

    const parsed = data as OpenAiChatCompletionResponse;
    const content = parsed.choices?.[0]?.message?.content;

    if (!content || content.trim().length === 0) {
      throw new Error("LLM API вернул пустой ответ");
    }

    return parseResponse(content);
  }
}
