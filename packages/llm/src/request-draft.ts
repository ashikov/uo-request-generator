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

export const REQUEST_DRAFT_RESPONSE_FORMAT_NAME = "request_draft";

// Провайдерская схема ограничивает только устойчиво поддерживаемую структуру ответа.
// Локальная requestDraftSchema остаётся окончательной проверкой предметных и межполевых правил.
export const REQUEST_DRAFT_JSON_SCHEMA = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["generated", "multiple_issues"],
    },
    title: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: requestDraftLimits.titleMax,
    },
    problem: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: requestDraftLimits.problemMax,
    },
    impact: {
      type: ["string", "null"],
      minLength: 1,
      maxLength: requestDraftLimits.impactMax,
    },
    requests: {
      type: "array",
      minItems: 0,
      maxItems: requestDraftLimits.requestsMax,
      items: {
        type: "string",
        minLength: 1,
        maxLength: requestDraftLimits.requestMax,
      },
    },
    warnings: {
      type: "array",
      maxItems: requestDraftLimits.warningsMax,
      items: {
        type: "string",
        minLength: 1,
        maxLength: requestDraftLimits.warningMax,
      },
    },
  },
  required: ["outcome", "title", "problem", "impact", "requests", "warnings"],
  additionalProperties: false,
} as const;

const requestDraftString = (maxLength: number) =>
  z
    .string()
    .regex(/^[^\r\n]*$/)
    .trim()
    .min(1)
    .max(maxLength);

const requestDraftRequest = requestDraftString(requestDraftLimits.requestMax).refine(
  (request) => !/^прошу\s*:/iu.test(request),
);

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

const generatedRequestDraftSchema = z
  .object({
    outcome: z.literal("generated"),
    title: requestDraftString(requestDraftLimits.titleMax),
    problem: requestDraftString(requestDraftLimits.problemMax),
    impact: z.union([requestDraftString(requestDraftLimits.impactMax), z.null()]),
    requests: z.array(requestDraftRequest).min(1).max(requestDraftLimits.requestsMax),
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

const multipleIssuesRequestDraftSchema = z
  .object({
    outcome: z.literal("multiple_issues"),
    title: z.null(),
    problem: z.null(),
    impact: z.null(),
    requests: z.array(z.never()).length(0),
    warnings: z.array(z.never()).length(0),
  })
  .strict();

export const requestDraftSchema = z.discriminatedUnion("outcome", [
  generatedRequestDraftSchema,
  multipleIssuesRequestDraftSchema,
]);

export type RequestDraft = z.infer<typeof requestDraftSchema>;
export type GeneratedRequestDraft = z.infer<typeof generatedRequestDraftSchema>;

export const REQUEST_DRAFT_SYSTEM_PROMPT = [
  "Ты — помощник жителя многоквартирного дома. Определи, описывает ли ввод одну связанную проблему или несколько самостоятельных несвязанных проблем.",
  "",
  "Верни только один валидный JSON-объект без Markdown-блоков, пояснений и текста до или после JSON.",
  "Не используй старые маркеры «ЗАГОЛОВОК:» и «ПРЕДУПРЕЖДЕНИЯ:».",
  "Не объясняй и не обосновывай классификацию.",
  "",
  "Обязательная структура JSON:",
  '- outcome: "generated" или "multiple_issues"',
  `- title: непустая строка до ${requestDraftLimits.titleMax} символов или null`,
  `- problem: непустая строка до ${requestDraftLimits.problemMax} символов или null`,
  `- impact: непустая строка до ${requestDraftLimits.impactMax} символов или null`,
  `- requests: массив до ${requestDraftLimits.requestsMax} непустых строк, каждая до ${requestDraftLimits.requestMax} символов`,
  `- warnings: массив до ${requestDraftLimits.warningsMax} непустых строк, каждая до ${requestDraftLimits.warningMax} символов`,
  "- Все строковые поля должны быть однострочными и не содержать переводов строк",
  "",
  "Правила классификации:",
  "- Одна связанная проблема может включать несколько признаков, последствий, мест проявления и желаемых действий, если они относятся к одному объекту или одной причинно связанной ситуации",
  "- Несколько самостоятельных проблем являются несвязанными, если каждую можно независимо описать и устранить отдельной заявкой",
  "- Не выбирай одну из несвязанных проблем и не объединяй их в одну заявку",
  "",
  'Правила outcome: "generated":',
  '- Используй outcome: "generated" только для одной связанной проблемы',
  `- title и problem должны быть непустыми строками, impact — непустой строкой или null, requests — массивом от 1 до ${requestDraftLimits.requestsMax} строк`,
  `- Сформированный из problem, impact, раздела «Прошу:» и нумерованных требований body должен содержать не более ${generateRequestLimits.result.bodyMax} символов`,
  "- Сохраняй переданные объект, место, наблюдаемые признаки, длительность, повторяемость и известные последствия",
  "- Учитывай известные последствия и желаемые действия только если они явно переданы пользователем",
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
  'Правила outcome: "multiple_issues":',
  '- Используй outcome: "multiple_issues" только для нескольких самостоятельных несвязанных проблем',
  "- Укажи title: null, problem: null, impact: null, requests: [] и warnings: []",
  "- Не формируй заголовок, описание, последствия, требования или предупреждения",
  "",
  "Короткие примеры:",
  '- «Протечка крыши, намокший потолок и отслаивающаяся штукатурка» — одна связанная проблема, outcome: "generated"',
  '- «Сломанные качели и торчащие из них острые болты» — одна связанная проблема, outcome: "generated"',
  '- «Трещина на трубе, капающая вода и просьба проверить соединения» — одна связанная проблема, outcome: "generated"',
  '- «Сломанные качели на детской площадке и старый диван возле мусорных баков в соседнем дворе» — несколько несвязанных проблем, outcome: "multiple_issues"',
  "",
  "Пример JSON для generated:",
  "{",
  '  "outcome": "generated",',
  '  "title": "Не работает освещение в общем коридоре",',
  '  "problem": "В общем коридоре не работает освещение уже несколько дней.",',
  '  "impact": null,',
  '  "requests": ["Проверить освещение", "Устранить неисправность"],',
  '  "warnings": []',
  "}",
  "",
  "Пример JSON для multiple_issues:",
  "{",
  '  "outcome": "multiple_issues",',
  '  "title": null,',
  '  "problem": null,',
  '  "impact": null,',
  '  "requests": [],',
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

export function formatRequestDraft(draft: GeneratedRequestDraft): GenerateRequestResult {
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
