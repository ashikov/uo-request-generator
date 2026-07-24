import {
  generateRequestLimits,
  generateRequestResultSchema,
  type GenerateRequestResult,
} from "@uo-request-generator/core";
import { z } from "zod";

const INVALID_RESPONSE_MESSAGE = "LLM вернул некорректный формат заявки";

export const requestDraftLimits = {
  titleMax: generateRequestLimits.result.titleMax,
  problemMax: generateRequestLimits.description.max,
  impactMax: 500,
  requestsMax: 3,
  requestMax: 500,
  warningsMax: generateRequestLimits.result.warningsMax,
  warningMax: generateRequestLimits.result.warningMax,
} as const;

const requestDraftString = (maxLength: number) => z.string().trim().min(1).max(maxLength);

type RequestDraftBodyParts = {
  problem: string;
  impact: string | null;
  requests: string[];
};

function buildRequestBody(draft: RequestDraftBodyParts): string {
  const requestLines = draft.requests.map((request, index) => `${String(index + 1)}. ${request}`);
  const requestBlock = ["Прошу:", ...requestLines].join("\n");
  const bodyBlocks = [draft.problem];

  if (draft.impact !== null) {
    bodyBlocks.push(draft.impact);
  }

  bodyBlocks.push(requestBlock);

  return bodyBlocks.join("\n\n");
}

export const requestDraftSchema = z
  .object({
    title: requestDraftString(requestDraftLimits.titleMax),
    problem: requestDraftString(requestDraftLimits.problemMax),
    impact: z.union([requestDraftString(requestDraftLimits.impactMax), z.null()]),
    requests: z
      .array(requestDraftString(requestDraftLimits.requestMax))
      .min(1)
      .max(requestDraftLimits.requestsMax),
    warnings: z
      .array(requestDraftString(requestDraftLimits.warningMax))
      .max(requestDraftLimits.warningsMax),
  })
  .strict()
  .superRefine((draft, context) => {
    if (buildRequestBody(draft).length > generateRequestLimits.result.bodyMax) {
      context.addIssue({
        code: "custom",
        message: "Сформированный текст заявки превышает допустимую длину",
      });
    }
  });

export type RequestDraft = z.infer<typeof requestDraftSchema>;

export const REQUEST_DRAFT_SYSTEM_PROMPT = [
  "Ты — помощник жителя многоквартирного дома. По описанию одной проблемы подготовь структурированный черновик заявки для управляющей организации (УО).",
  "",
  "Верни только один валидный JSON-объект без Markdown-блоков, пояснений и текста до или после JSON.",
  "Не используй старые маркеры «ЗАГОЛОВОК:» и «ПРЕДУПРЕЖДЕНИЯ:».",
  "",
  "Обязательная структура JSON:",
  `- title: непустая строка до ${requestDraftLimits.titleMax} символов`,
  `- problem: непустая строка до ${requestDraftLimits.problemMax} символов`,
  `- impact: непустая строка до ${requestDraftLimits.impactMax} символов или null`,
  `- requests: массив от 1 до ${requestDraftLimits.requestsMax} непустых строк, каждая до ${requestDraftLimits.requestMax} символов`,
  `- warnings: массив до ${requestDraftLimits.warningsMax} непустых строк, каждая до ${requestDraftLimits.warningMax} символов`,
  `- Сформированный из problem, impact, раздела «Прошу:» и нумерованных требований body должен содержать не более ${generateRequestLimits.result.bodyMax} символов`,
  "",
  "Правила содержания:",
  "- Сохраняй переданные объект, место, наблюдаемые признаки, длительность, повторяемость и известные последствия",
  "- Формулируй компактный, но достаточный текст без потери полезных подробностей и удаляй повторы",
  "- Отделяй наблюдаемую проблему в problem от её известного практического значения в impact",
  "- Если практическое значение проблемы неизвестно из пользовательского ввода, укажи impact: null",
  "- Формулируй от одного до трёх конкретных выполнимых требований",
  "- В requests помещай только сами требования без нумерации, маркеров списка и префикса «Прошу:»",
  "- Преобразуй эмоции в наблюдаемые факты, только когда это возможно без домысливания",
  "- Не придумывай причины, виновников, повреждения, риски, последствия и выполненные работы",
  "- Не добавляй неподтверждённые обвинения, законодательство и правовое обоснование",
  "- Не требуй письменный ответ и не устанавливай конкретный срок исполнения по умолчанию",
  "- Не создавай впечатление, что приложение самостоятельно отправляет заявку в УО",
  "- Если предупреждений нет, укажи warnings: []",
  "",
  "Пример точного формата JSON:",
  "{",
  '  "title": "Не работает освещение в общем коридоре",',
  '  "problem": "В общем коридоре не работает освещение уже несколько дней.",',
  '  "impact": null,',
  '  "requests": ["Проверить освещение", "Устранить неисправность"],',
  '  "warnings": []',
  "}",
].join("\n");

function invalidResponseError(): Error {
  return new Error(INVALID_RESPONSE_MESSAGE);
}

export function parseRequestDraft(responseText: string): RequestDraft {
  let parsedResponse: unknown;

  try {
    parsedResponse = JSON.parse(responseText);
  } catch {
    throw invalidResponseError();
  }

  const draftResult = requestDraftSchema.safeParse(parsedResponse);

  if (!draftResult.success) {
    throw invalidResponseError();
  }

  return draftResult.data;
}

export function formatRequestDraft(draft: RequestDraft): GenerateRequestResult {
  const result = generateRequestResultSchema.safeParse({
    title: draft.title,
    body: buildRequestBody(draft),
    warnings: draft.warnings,
  });

  if (!result.success) {
    throw invalidResponseError();
  }

  return result.data;
}
