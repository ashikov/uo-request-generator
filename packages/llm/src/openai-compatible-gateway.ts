import {
  generateRequestResultSchema,
  generateRequestLimits,
  type GenerateRequestInput,
  type GenerateRequestResult,
  type LlmGateway,
} from "@uo-request-generator/core";
import { z } from "zod";
import { GenerationProviderUnavailableError } from "./disabled-llm-gateway.js";

export type OpenAiCompatibleGatewayConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  authScheme: string;
  apiProtocol: LlmApiProtocol;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxOutputTokens?: number;
};

export const LLM_API_PROTOCOLS = ["chat-completions", "responses"] as const;
export type LlmApiProtocol = (typeof LLM_API_PROTOCOLS)[number];

type OpenAiChatMessage = {
  role: "system" | "user";
  content: string;
};

type OpenAiChatCompletionRequest = {
  model: string;
  messages: OpenAiChatMessage[];
  temperature: number;
};

type OpenAiResponsesRequest = {
  model: string;
  instructions: string;
  input: string;
  temperature: number;
  max_output_tokens: number;
};

const openAiChatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

const openAiResponsesResponseSchema = z
  .object({
    output_text: z.string().nullable().optional(),
    output: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .refine((response) => response.output_text !== undefined || response.output !== undefined);

const openAiResponsesOutputItemSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const openAiResponsesMessageSchema = z
  .object({
    type: z.literal("message"),
    content: z.array(z.unknown()),
  })
  .passthrough();

const openAiResponsesContentItemSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

const openAiResponsesOutputTextSchema = z
  .object({
    type: z.literal("output_text"),
    text: z.string(),
  })
  .passthrough();

const DEFAULT_MAX_OUTPUT_TOKENS = 1000;
const TEMPERATURE = 0.3;

const SYSTEM_PROMPT = [
  "Ты — помощник жителя многоквартирного дома. Составь короткую заявку для управляющей организации (УО) по описанию проблемы.",
  "",
  "Правила:",
  "- Используй спокойный человеческий тон без канцелярита",
  "- Кратко описывай одну наблюдаемую проблему",
  "- Указывай практические последствия, только если они известны из ввода",
  "- Добавляй раздел «Прошу:» с выполнимым требованием",
  "- Преобразуй эмоции в наблюдаемые факты",
  "- Не придумывай место, причину, виновника или повреждения",
  "- Не добавляй неподтверждённые обвинения",
  "- Не добавляй вымышленные даты, номера договоров и актов",
  "",
  "Формат ответа:",
  "ЗАГОЛОВОК: <короткий заголовок до 120 символов>",
  "",
  "<краткое описание проблемы>",
  "",
  "Прошу: <выполнимое требование>",
  "",
  "ПРЕДУПРЕЖДЕНИЯ:",
  "— <предупреждение, если нужно>",
].join("\n");

function createRequestBody(
  apiProtocol: LlmApiProtocol,
  model: string,
  userMessage: string,
  maxOutputTokens: number,
): OpenAiChatCompletionRequest | OpenAiResponsesRequest {
  if (apiProtocol === "responses") {
    return {
      model,
      instructions: SYSTEM_PROMPT,
      input: userMessage,
      temperature: TEMPERATURE,
      max_output_tokens: maxOutputTokens,
    };
  }

  return {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: TEMPERATURE,
  };
}

function extractResponsesText(responseBody: unknown): string {
  const responseResult = openAiResponsesResponseSchema.safeParse(responseBody);

  if (!responseResult.success) {
    throw new GenerationProviderUnavailableError();
  }

  const aggregatedText = responseResult.data.output_text;

  if (typeof aggregatedText === "string" && aggregatedText.trim().length > 0) {
    return aggregatedText;
  }

  const textParts: string[] = [];

  for (const outputItem of responseResult.data.output ?? []) {
    const outputItemResult = openAiResponsesOutputItemSchema.safeParse(outputItem);

    if (!outputItemResult.success) {
      throw new GenerationProviderUnavailableError();
    }

    if (outputItemResult.data.type !== "message") {
      continue;
    }

    const messageResult = openAiResponsesMessageSchema.safeParse(outputItem);

    if (!messageResult.success) {
      throw new GenerationProviderUnavailableError();
    }

    for (const contentItem of messageResult.data.content) {
      const contentItemResult = openAiResponsesContentItemSchema.safeParse(contentItem);

      if (!contentItemResult.success) {
        throw new GenerationProviderUnavailableError();
      }

      if (contentItemResult.data.type !== "output_text") {
        continue;
      }

      const outputTextResult = openAiResponsesOutputTextSchema.safeParse(contentItem);

      if (!outputTextResult.success) {
        throw new GenerationProviderUnavailableError();
      }

      textParts.push(outputTextResult.data.text);
    }
  }

  return textParts.join("");
}

function extractResponseText(apiProtocol: LlmApiProtocol, responseBody: unknown): string {
  if (apiProtocol === "responses") {
    return extractResponsesText(responseBody);
  }

  const apiResult = openAiChatCompletionResponseSchema.safeParse(responseBody);

  if (!apiResult.success) {
    throw new GenerationProviderUnavailableError();
  }

  const firstChoice = apiResult.data.choices[0];

  if (firstChoice === undefined) {
    throw new GenerationProviderUnavailableError();
  }

  return firstChoice.message.content;
}

function truncateToLength(str: string, max: number): string {
  let result = "";
  for (const char of str) {
    if (result.length + char.length > max) break;
    result += char;
  }
  return result;
}

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

  if (body.length > generateRequestLimits.result.bodyMax || !body.includes("Прошу:")) {
    throw new Error("LLM вернул некорректный формат заявки");
  }

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
    .map((w) => truncateToLength(w, generateRequestLimits.result.warningMax))
    .filter((w) => w.length > 0);

  const result = generateRequestResultSchema.safeParse({
    title: truncateToLength(title, generateRequestLimits.result.titleMax),
    body,
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
  private readonly apiProtocol: LlmApiProtocol;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;

  constructor(config: OpenAiCompatibleGatewayConfig) {
    if (!config.apiKey) {
      throw new Error("LLM_API_KEY не может быть пустым");
    }

    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.authScheme = config.authScheme;
    this.apiProtocol = config.apiProtocol;
    this.extraHeaders = config.extraHeaders ?? {};
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  async generateRequest(input: GenerateRequestInput): Promise<GenerateRequestResult> {
    const userMessage = input.location
      ? `Проблема: ${input.description}\n\nМесто: ${input.location}`
      : `Проблема: ${input.description}`;

    const requestBody = createRequestBody(
      this.apiProtocol,
      this.model,
      userMessage,
      this.maxOutputTokens,
    );

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
      if (error instanceof DOMException && error.name === "AbortError") {
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

    const content = extractResponseText(this.apiProtocol, data);

    if (!content || content.trim().length === 0) {
      throw new Error("LLM API вернул пустой ответ");
    }

    return parseResponse(content);
  }
}
