import {
  generateRequestResultSchema,
  generateRequestLimits,
  type GenerateRequestInput,
  type GenerateRequestResult,
  type LlmGateway,
} from "@uo-request-generator/core";

export type OpenAiCompatibleGatewayConfig = {
  apiUrl?: string;
  apiKey: string;
  model?: string;
  /** Схема авторизации: "Api-Key" (для Yandex AI) или "Bearer" (для OpenAI/Groq) */
  authScheme?: string;
  /** Заголовки, которые нужно добавить к запросу (например x-folder-id для Yandex AI) */
  extraHeaders?: Record<string, string>;
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

const DEFAULT_API_URL = "https://llm.api.cloud.yandex.net/v1/chat/completions";
const DEFAULT_MODEL = "yandexgpt/latest";

const SYSTEM_PROMPT = [
  "Ты — помощник жителя многоквартирного дома. Составь официальную заявку для управляющей организации (УО) по описанию проблемы.",
  "",
  "Правила:",
  "- Используй официально-деловой тон",
  "- Подробно опиши проблему, её признаки и последствия",
  "- Укажи последствия, только если они известны из ввода",
  "- Обязательно добавь ссылку на Постановление Правительства РФ от 03.04.2013 № 290",
  "- Обязательно используй фразу «На основании вышеизложенного прошу:»",
  "- После списка пунктов добавь фразу «Прошу сообщить о принятом решении и планируемых сроках выполнения работ.»",
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
  "В соответствии с Постановлением Правительства РФ от 03.04.2013 № 290 «О минимальном перечне услуг и работ, необходимых для обеспечения надлежащего содержания общего имущества в многоквартирном доме, и порядке их оказания и выполнения», <обоснование>.",
  "",
  "На основании вышеизложенного прошу:",
  "",
  "1. <пункт>",
  "2. <пункт>",
  "3. <пункт>",
  "",
  "Прошу сообщить о принятом решении и планируемых сроках выполнения работ.",
  "",
  "ПРЕДУПРЕЖДЕНИЯ:",
  "— <предупреждение, если нужно>",
].join("\n");

function parseResponse(text: string): GenerateRequestResult {
  const lines = text.split("\n").map((l) => l.trim());

  let title = "";
  let body = "";
  const warnings: string[] = [];

  const titleLine = lines.find((l) => l.startsWith("ЗАГОЛОВОК:"));
  const titleIdx = titleLine !== undefined ? lines.indexOf(titleLine) : -1;
  const warningsIdx = lines.findIndex((l) => l.startsWith("ПРЕДУПРЕЖДЕНИЯ:"));

  if (titleLine !== undefined) {
    title = titleLine.slice("ЗАГОЛОВОК:".length).trim();
  }

  const bodyStart = titleIdx !== -1 ? titleIdx + 1 : 0;
  const bodyEnd = warningsIdx !== -1 ? warningsIdx : lines.length;
  body = lines
    .slice(bodyStart, bodyEnd)
    .filter((l) => l.length > 0)
    .join("\n");

  if (!title) {
    const firstLine = lines.find((l) => l.length > 0);
    title = firstLine ?? "Заявка";
    body = lines
      .filter((l) => l.length > 0)
      .slice(1)
      .join("\n");
  }

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

  title = title.slice(0, generateRequestLimits.result.titleMax);
  if (title.length === 0) {
    title = "Заявка";
  }

  body = body.slice(0, generateRequestLimits.result.bodyMax);
  if (body.length === 0) {
    body = "Не удалось составить заявку";
  }

  const validWarnings = warnings
    .slice(0, generateRequestLimits.result.warningsMax)
    .map((w) => w.slice(0, generateRequestLimits.result.warningMax))
    .filter((w) => w.length > 0);

  const result = generateRequestResultSchema.safeParse({
    title,
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
  private readonly extraHeaders: Record<string, string>;

  constructor(config: OpenAiCompatibleGatewayConfig) {
    if (!config.apiKey) {
      throw new Error("LLM_API_KEY не может быть пустым");
    }

    this.apiUrl = config.apiUrl ?? DEFAULT_API_URL;
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.authScheme = config.authScheme ?? "Api-Key";
    this.extraHeaders = config.extraHeaders ?? {};
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

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `${this.authScheme} ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`LLM API вернул ошибку: ${response.status}`);
    }

    const data = (await response.json()) as OpenAiChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("LLM API вернул пустой ответ");
    }

    return parseResponse(content);
  }
}
