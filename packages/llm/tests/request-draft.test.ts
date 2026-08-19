import {
  COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
  COMMON_AREA_ROOF_LEGAL_BASIS_MODULE,
  COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
  COMMON_LEGAL_BASIS_BLOCK,
  CONFIRMED_PROBLEM_SUBJECT_KINDS,
  generateRequestLimits,
  type PrimaryRequestDraft,
  primaryRequestDraftLimits,
  primaryRequestLegalBasisLimits,
  renderPrimaryRequestDraft,
} from "@uo-request-generator/core";
import { describe, expect, it } from "vitest";
import { detailedEntranceDoorDraft } from "../../core/tests/primary-request-draft.fixtures.js";
import {
  createRequestDraftJsonSchema,
  createRequestDraftSystemPrompt,
  createRequestDraftSystemPromptHash,
  type GeneratedRequestDraft,
  parseRequestDraft,
  REQUEST_DRAFT_DYNAMIC_BODY_MAX,
  REQUEST_DRAFT_JSON_SCHEMA,
  REQUEST_DRAFT_SYSTEM_PROMPT,
  type RequestDraft,
} from "../src/request-draft.js";

const INVALID_RESPONSE_MESSAGE = "LLM вернул некорректный формат заявки";
const DOOR_SUBJECT_RULE = "входную дверь многоквартирного дома";
const LIGHTING_SUBJECT_RULE = "неисправную или неработающую осветительную установку";
const CLEANING_SUBJECT_RULE = "уборку помещения общего пользования многоквартирного дома";
const ROOF_SUBJECT_RULE = "проблема относится именно к крыше или кровле многоквартирного дома";
const VENTILATION_SUBJECT_RULE =
  "проблему с системой вентиляции или вентиляционным каналом либо шахтой";
const ELEVATOR_SUBJECT_RULE = "проблему с лифтом, лифтовой шахтой или лифтовым оборудованием";

function createDraft(overrides: Partial<GeneratedRequestDraft> = {}): GeneratedRequestDraft {
  return {
    outcome: "generated",
    title: "Не работает освещение",
    problem: "В общем коридоре не работает освещение уже несколько дней.",
    circumstances: null,
    impact: "В тёмное время суток проход по коридору затруднён.",
    verification: null,
    subject: null,
    actionPlan: {
      preliminaryCheck: null,
      remedyActions: ["Проверить и восстановить освещение"],
      resultCheck: null,
    },
    warnings: [],
    ...overrides,
  };
}

function createMultipleIssuesDraft(): Extract<RequestDraft, { outcome: "multiple_issues" }> {
  return {
    outcome: "multiple_issues",
    title: null,
    problem: null,
    circumstances: null,
    impact: null,
    verification: null,
    subject: null,
    actionPlan: null,
    warnings: [],
  };
}

function serializeDraft(draft: unknown): string {
  return JSON.stringify({ draft });
}

function expectInvalidResponse(draft: unknown): void {
  expect(() => parseRequestDraft(serializeDraft(draft))).toThrow(INVALID_RESPONSE_MESSAGE);
}

function expectGeneratedDraft(draft: RequestDraft): asserts draft is GeneratedRequestDraft {
  expect(draft.outcome).toBe("generated");
  if (draft.outcome !== "generated") {
    throw new Error("Ожидался черновик готовой заявки");
  }
}

function toPrimaryRequestDraft(draft: GeneratedRequestDraft): PrimaryRequestDraft {
  const { outcome: _outcome, ...primaryRequestDraft } = draft;
  return primaryRequestDraft;
}

function renderGeneratedDraft(draft: GeneratedRequestDraft) {
  return renderPrimaryRequestDraft(toPrimaryRequestDraft(draft));
}

function createDraftAtBodyLength(bodyLength: number): GeneratedRequestDraft {
  const fixedDraft = createDraft({
    problem: "а",
    circumstances: null,
    impact: null,
    verification: null,
    actionPlan: { preliminaryCheck: null, remedyActions: ["б"], resultCheck: null },
  });
  const fixedBodyLength = renderGeneratedDraft(fixedDraft).body.length;

  return createDraft({
    problem: "а".repeat(bodyLength - fixedBodyLength + 1),
    circumstances: null,
    impact: null,
    verification: null,
    actionPlan: fixedDraft.actionPlan,
  });
}

describe("REQUEST_DRAFT_SYSTEM_PROMPT", () => {
  it("создаёт стабильный hash точного system prompt", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_elevator");

    expect(createRequestDraftSystemPromptHash(prompt)).toBe(
      createRequestDraftSystemPromptHash(prompt),
    );
    expect(createRequestDraftSystemPromptHash(`${prompt} `)).not.toBe(
      createRequestDraftSystemPromptHash(prompt),
    );
  });

  it("распределяет все входные роли", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("description — свободное описание ситуации");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("location — отдельно переданное место");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("consequences — отдельно переданные");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("desiredActions — отдельно переданные");
  });

  it("различает конфликт места и совместимое уточнение", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("location явно противоречит");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("используй location в problem");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не объединяй несовместимые места");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не является конфликтом");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не требует warning");
  });

  it("сохраняет явные последствия и ограничивает безопасный вывод", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("consequences имеют приоритет");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не превращай риск в событие");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("скрытое повреждение");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("отсутствующее во вводе оборудование");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не более двух независимых");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("многоступенчатую причинную цепочку");
  });

  it("требует фактическое основание проверки без дублирования", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "обоснованную обстоятельствами проверку связанных элементов",
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Неизвестная причина сама по себе");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не превращай неизвестную причину");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("заполняй verification только ради");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "verification только повторяет actionPlan.preliminaryCheck",
    );
  });

  it("сохраняет приоритет желаемых действий", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("desiredActions имеют приоритет");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не заменяй более общими действиями");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "раздели действие между ролями без потери смысла",
    );
  });

  it("задаёт общие процедурные роли без искусственного заполнения", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("существенное неизвестное обстоятельство");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("не обязательно визуальный осмотр");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("непосредственно необходимое действие");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("а не самостоятельные диагностики или проверки");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("существенный функциональный результат");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("для простой установки или замены");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не дублируй preliminaryCheck в remedyActions");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      "не заполняй procedural plan до пяти пунктов искусственно",
    );
  });

  it("оставляет multiple_issues без частичного actionPlan", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("outcome: multiple_issues");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("actionPlan: null");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не выбирай одну проблему");
  });

  it("сохраняет границу body, законодательства и URL", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не возвращай готовый body");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain("Не выбирай и не цитируй законодательство");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_LEGAL_BASIS_BLOCK);
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain("http://");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain("https://");
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.id);
    for (const source of COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.sources) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.officialUrl);
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.title);
    }
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.id);
    for (const source of COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.sources) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.officialUrl);
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.title);
    }
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE.id);
    for (const source of COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE.sources) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.officialUrl);
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.title);
    }
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_ROOF_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_AREA_ROOF_LEGAL_BASIS_MODULE.id);
    for (const source of COMMON_AREA_ROOF_LEGAL_BASIS_MODULE.sources) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.officialUrl);
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.title);
    }
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE.id,
    );
    for (const source of COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE.sources) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.officialUrl);
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.title);
    }
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(
      COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0],
    );
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.id);
    for (const source of COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.sources) {
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.officialUrl);
      expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(source.title);
    }
  });

  it("передаёт модели динамический лимит body", () => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).toContain(
      `не более ${REQUEST_DRAFT_DYNAMIC_BODY_MAX} символов`,
    );
    expect(REQUEST_DRAFT_DYNAMIC_BODY_MAX).toBe(
      primaryRequestDraftLimits.body.max -
        primaryRequestLegalBasisLimits.maximumBlockLength -
        "\n\n".length * 2,
    );
  });

  it("запрашивает только предметный факт с проверяемым evidence, а не выбор закона", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_entrance_door");

    expect(prompt).toContain("subject описывает только предмет проблемы");
    expect(prompt).toContain("дословных непрерывных фрагментов");
    expect(prompt).toContain("subject: null");
    expect(prompt).toContain("не является выбором нормативного акта");
  });

  it("разделяет evidence rules по kind и ограничивает lighting subject", () => {
    const doorPromptRules = createRequestDraftSystemPrompt("common_area_entrance_door").split("\n");
    const lightingPromptRules = createRequestDraftSystemPrompt(
      "common_area_premises_lighting",
    ).split("\n");
    const doorEvidenceRule = doorPromptRules.find((rule) =>
      rule.includes("подтверждать и дверь, и её принадлежность"),
    );
    const lightingEvidenceRule = lightingPromptRules.find((rule) =>
      rule.includes("для kind common_area_premises_lighting evidence"),
    );
    const lightingSubjectRule = lightingPromptRules.find((rule) =>
      rule.includes("неисправную или неработающую осветительную установку"),
    );

    expect(doorEvidenceRule).toBe(
      "- для kind common_area_entrance_door evidence по отдельности или в совокупности должно подтверждать и дверь, и её принадлежность ко входу многоквартирного дома либо помещению общего пользования; не используй для evidence формулировки из созданных тобой problem, title или actionPlan",
    );
    expect(lightingEvidenceRule).toBe(
      "- для kind common_area_premises_lighting evidence по отдельности или в совокупности должно подтверждать и осветительную установку или освещение, и помещение общего пользования многоквартирного дома",
    );
    expect(lightingSubjectRule).toBe(
      "- используй kind common_area_premises_lighting, только если вход прямо указывает на неисправную или неработающую осветительную установку либо освещение внутри помещения общего пользования многоквартирного дома. Не используй его для освещения внутри квартиры, придомовой территории, уличного или фасадного освещения, жалоб на дизайн или предпочтительную яркость",
    );
    expect(doorPromptRules.join("\n")).not.toContain(LIGHTING_SUBJECT_RULE);
    expect(lightingPromptRules.join("\n")).not.toContain(DOOR_SUBJECT_RULE);
  });

  it("ограничивает cleaning subject уборкой только внутри помещений общего пользования", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_premises_cleaning");

    expect(prompt).toContain(CLEANING_SUBJECT_RULE);
    expect(prompt).toContain("подъезда, лестничной площадки, коридора или холла");
    expect(prompt).toContain("внутри квартиры");
    expect(prompt).toContain("придомовой территории");
    expect(prompt).toContain("контейнерной площадки");
    expect(prompt).toContain("вывоза ТКО");
    expect(prompt).toContain("не утверждай антисанитарное состояние");
    expect(prompt).not.toContain(DOOR_SUBJECT_RULE);
    expect(prompt).not.toContain(LIGHTING_SUBJECT_RULE);
  });

  it("требует прямое подтверждение кровли и не выводит источник воды по проявлениям", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_roof");

    expect(prompt).toContain(ROOF_SUBJECT_RULE);
    expect(prompt).toContain("мокрый потолок");
    expect(prompt).toContain("капает вода");
    expect(prompt).toContain("пятно после дождя");
    expect(prompt).toContain("укажи subject: null");
    expect(prompt).toContain("не устанавливай источник воды");
    expect(prompt).not.toContain(DOOR_SUBJECT_RULE);
    expect(prompt).not.toContain(LIGHTING_SUBJECT_RULE);
    expect(prompt).not.toContain(CLEANING_SUBJECT_RULE);
  });

  it("требует subject: null при противоречивых сведениях об источнике воды", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_roof");

    expect(prompt).toContain("прямо и непротиворечиво сообщает");
    expect(prompt).toContain(
      "внутридомовой трубопровод, стояк, инженерную систему, квартиру или помещение выше",
    );
    expect(prompt).toContain("в любом исходном поле");
    expect(prompt).toContain("укажи subject: null");
    expect(prompt).toContain("Не разрешай противоречие в пользу выбранного kind");
    expect(prompt).toContain(
      "Желаемое действие проверить, осмотреть или отремонтировать кровлю само по себе не является фактом",
    );
    expect(prompt).toContain("не может быть evidence");
  });

  it("ограничивает ventilation subject явно подтверждённой вентиляцией общего имущества", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_ventilation");

    expect(prompt).toContain(VENTILATION_SUBJECT_RULE);
    expect(prompt).toContain("обслуживают более одного помещения");
    expect(prompt).toContain("вентиляции внутри одной квартиры");
    expect(prompt).toContain("Духота");
    expect(prompt).toContain("температура");
    expect(prompt).toContain("запах");
    expect(prompt).toContain("влажность");
    expect(prompt).toContain("укажи subject: null");
    expect(prompt).toContain("Не устанавливай отсутствие нормативного воздухообмена");
    expect(prompt).toContain("засор");
    expect(prompt).toContain("дефект шахты");
    expect(prompt).toContain("неисправность оборудования");
    expect(prompt).toContain(
      "Желаемое действие проверить, очистить или отремонтировать вентиляцию само по себе не является фактом",
    );
    expect(prompt).not.toContain(DOOR_SUBJECT_RULE);
    expect(prompt).not.toContain(LIGHTING_SUBJECT_RULE);
    expect(prompt).not.toContain(CLEANING_SUBJECT_RULE);
    expect(prompt).not.toContain(ROOF_SUBJECT_RULE);
  });

  it("не считает расположение вентиляции в общем помещении достаточным подтверждением общего имущества", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_ventilation");

    expect(prompt).toContain(
      "Одного расположения вентиляции в помещении общего пользования недостаточно",
    );
    expect(prompt).toContain(
      "прямо названы общедомовыми или прямо указано, что они обслуживают более одного помещения",
    );
  });

  it("ограничивает elevator subject прямой проблемой лифта без технической диагностики", () => {
    const prompt = createRequestDraftSystemPrompt("common_area_elevator");

    expect(prompt).toContain(ELEVATOR_SUBJECT_RULE);
    expect(prompt).toContain("наблюдаемую проблему");
    expect(prompt).toContain("лифтового холла");
    expect(prompt).toContain("подъёмной платформы");
    expect(prompt).toContain("эскалатора");
    expect(prompt).toContain("Косвенный признак без прямой связи с лифтом");
    expect(prompt).toContain("укажи subject: null");
    expect(prompt).toContain("противоречат принадлежности проблемы лифту");
    expect(prompt).toContain("не разрешай противоречие в пользу выбранного kind");
    expect(prompt).toContain("желаемое действие проверить, осмотреть или отремонтировать лифт");
    expect(prompt).toContain("Не устанавливай техническую причину");
    expect(prompt).toContain("неисправный узел");
    expect(prompt).toContain("аварийность");
    expect(prompt).toContain("необходимость отключения");
    expect(prompt).toContain("Не определяй исполнителя работ");
    expect(prompt).toContain(
      "не называй и не выбирай специализированную лифтовую или обслуживающую организацию",
    );
    expect(prompt).toContain("не утверждай необходимость её привлечения");
    expect(prompt).not.toContain(DOOR_SUBJECT_RULE);
    expect(prompt).not.toContain(LIGHTING_SUBJECT_RULE);
    expect(prompt).not.toContain(CLEANING_SUBJECT_RULE);
    expect(prompt).not.toContain(ROOF_SUBJECT_RULE);
    expect(prompt).not.toContain(VENTILATION_SUBJECT_RULE);
    expect(prompt).not.toContain(COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE.paragraphs[0]);
  });

  it("закрепляет регрессию контракта обязательного subject при достаточном evidence", () => {
    const subjectRequiredWhenEvidenceSufficientMarker =
      "<subject-required-when-evidence-sufficient>";

    for (const selectedSubjectKind of CONFIRMED_PROBLEM_SUBJECT_KINDS) {
      const prompt = createRequestDraftSystemPrompt(selectedSubjectKind);

      expect([
        ...prompt.matchAll(new RegExp(subjectRequiredWhenEvidenceSufficientMarker, "g")),
      ]).toHaveLength(1);
    }
    expect([
      ...createRequestDraftSystemPrompt(undefined).matchAll(
        new RegExp(subjectRequiredWhenEvidenceSufficientMarker, "g"),
      ),
    ]).toHaveLength(0);
  });

  it("закрепляет регрессию контракта ответственности location между problem и actionPlan", () => {
    const actionPlanLocationResponsibilityMarker =
      '<action-plan-location-responsibility general-location-role="problem" action-location-reuse="distinct-target-or-action-only">';

    for (const selectedSubjectKind of [undefined, ...CONFIRMED_PROBLEM_SUBJECT_KINDS]) {
      const prompt = createRequestDraftSystemPrompt(selectedSubjectKind);

      expect([
        ...prompt.matchAll(new RegExp(actionPlanLocationResponsibilityMarker, "g")),
      ]).toHaveLength(1);
      expect(prompt).toContain("Общее место остаётся в problem");
      expect(prompt).toContain("не дублируется механически в каждом пункте actionPlan");
      expect(prompt).toContain("только если без этого нельзя отличить");
      expect(prompt).toContain("конкретный объект или действие");
    }
  });

  it.each([
    [
      undefined,
      [],
      [
        DOOR_SUBJECT_RULE,
        LIGHTING_SUBJECT_RULE,
        CLEANING_SUBJECT_RULE,
        ROOF_SUBJECT_RULE,
        VENTILATION_SUBJECT_RULE,
        ELEVATOR_SUBJECT_RULE,
      ],
    ],
    [
      "common_area_entrance_door" as const,
      [DOOR_SUBJECT_RULE],
      [
        LIGHTING_SUBJECT_RULE,
        CLEANING_SUBJECT_RULE,
        ROOF_SUBJECT_RULE,
        VENTILATION_SUBJECT_RULE,
        ELEVATOR_SUBJECT_RULE,
      ],
    ],
    [
      "common_area_premises_lighting" as const,
      [LIGHTING_SUBJECT_RULE],
      [
        DOOR_SUBJECT_RULE,
        CLEANING_SUBJECT_RULE,
        ROOF_SUBJECT_RULE,
        VENTILATION_SUBJECT_RULE,
        ELEVATOR_SUBJECT_RULE,
      ],
    ],
    [
      "common_area_premises_cleaning" as const,
      [CLEANING_SUBJECT_RULE],
      [
        DOOR_SUBJECT_RULE,
        LIGHTING_SUBJECT_RULE,
        ROOF_SUBJECT_RULE,
        VENTILATION_SUBJECT_RULE,
        ELEVATOR_SUBJECT_RULE,
      ],
    ],
    [
      "common_area_roof" as const,
      [ROOF_SUBJECT_RULE],
      [
        DOOR_SUBJECT_RULE,
        LIGHTING_SUBJECT_RULE,
        CLEANING_SUBJECT_RULE,
        VENTILATION_SUBJECT_RULE,
        ELEVATOR_SUBJECT_RULE,
      ],
    ],
    [
      "common_area_ventilation" as const,
      [VENTILATION_SUBJECT_RULE],
      [
        DOOR_SUBJECT_RULE,
        LIGHTING_SUBJECT_RULE,
        CLEANING_SUBJECT_RULE,
        ROOF_SUBJECT_RULE,
        ELEVATOR_SUBJECT_RULE,
      ],
    ],
    [
      "common_area_elevator" as const,
      [ELEVATOR_SUBJECT_RULE],
      [
        DOOR_SUBJECT_RULE,
        LIGHTING_SUBJECT_RULE,
        CLEANING_SUBJECT_RULE,
        ROOF_SUBJECT_RULE,
        VENTILATION_SUBJECT_RULE,
      ],
    ],
  ])("не включает subject-specific данные других контрактов: %s", (confirmedProblemSubject, includedFragments, excludedFragments) => {
    const prompt = createRequestDraftSystemPrompt(confirmedProblemSubject);
    const schemaText = JSON.stringify(createRequestDraftJsonSchema(confirmedProblemSubject));

    for (const fragment of includedFragments) {
      expect(prompt).toContain(fragment);
    }
    for (const fragment of excludedFragments) {
      expect(prompt).not.toContain(fragment);
    }

    const includedKinds = confirmedProblemSubject === undefined ? [] : [confirmedProblemSubject];
    const excludedKinds = [
      "common_area_entrance_door",
      "common_area_premises_lighting",
      "common_area_premises_cleaning",
      "common_area_roof",
      "common_area_ventilation",
      "common_area_elevator",
    ].filter((kind) => kind !== confirmedProblemSubject);
    for (const kind of includedKinds) {
      expect(prompt).toContain(kind);
      expect(schemaText).toContain(kind);
    }
    for (const kind of excludedKinds) {
      expect(prompt).not.toContain(kind);
      expect(schemaText).not.toContain(kind);
    }
  });

  it.each([
    "При неизвестном источнике воды используй один preliminaryCheck",
    "Для простой отсутствующей ручки",
    "Для двери, которая не закрывается",
  ])("не содержит benchmark-specific подсказку: %s", (hintPrefix) => {
    expect(REQUEST_DRAFT_SYSTEM_PROMPT).not.toContain(hintPrefix);
  });
});

describe("provider-facing RequestDraft", () => {
  it("принимает roof subject только с дословным evidence прямого указания на кровлю", () => {
    const description = "На кровле многоквартирного дома обнаружена протечка.";
    const parsed = parseRequestDraft(
      serializeDraft(
        createDraft({
          problem: description,
          subject: {
            kind: "common_area_roof",
            evidence: [{ sourceField: "description", quote: description }],
          },
        }),
      ),
    );

    expectGeneratedDraft(parsed);
    expect(parsed.subject).toEqual({
      kind: "common_area_roof",
      evidence: [{ sourceField: "description", quote: description }],
    });
  });

  it.each([
    "На потолке мокрое пятно.",
    "С потолка капает вода.",
    "После дождя появилась сырость.",
  ])("сохраняет fail-closed subject: null без прямого указания на кровлю: %s", (problem) => {
    const parsed = parseRequestDraft(serializeDraft(createDraft({ problem, subject: null })));

    expectGeneratedDraft(parsed);
    expect(parsed.subject).toBeNull();
  });

  it("принимает ventilation subject только с дословным evidence общего имущества", () => {
    const description =
      "Общедомовой вентиляционный канал, обслуживающий помещения подъезда, не работает.";
    const parsed = parseRequestDraft(
      serializeDraft(
        createDraft({
          problem: description,
          subject: {
            kind: "common_area_ventilation",
            evidence: [{ sourceField: "description", quote: description }],
          },
        }),
      ),
    );

    expectGeneratedDraft(parsed);
    expect(parsed.subject).toEqual({
      kind: "common_area_ventilation",
      evidence: [{ sourceField: "description", quote: description }],
    });
  });

  it.each([
    "В подъезде душно.",
    "В общем коридоре очень жарко.",
    "В холле появился запах.",
    "На лестничной площадке высокая влажность.",
  ])("сохраняет fail-closed subject: null по одному симптому вентиляции: %s", (problem) => {
    const parsed = parseRequestDraft(serializeDraft(createDraft({ problem, subject: null })));

    expectGeneratedDraft(parsed);
    expect(parsed.subject).toBeNull();
  });

  it("принимает elevator subject только с дословным evidence прямой проблемы лифта", () => {
    const description = "Лифт в многоквартирном доме не реагирует на вызов с первого этажа.";
    const parsed = parseRequestDraft(
      serializeDraft(
        createDraft({
          problem: description,
          subject: {
            kind: "common_area_elevator",
            evidence: [{ sourceField: "description", quote: description }],
          },
        }),
      ),
    );

    expectGeneratedDraft(parsed);
    expect(parsed.subject).toEqual({
      kind: "common_area_elevator",
      evidence: [{ sourceField: "description", quote: description }],
    });
  });

  it.each([
    "В подъезде слышен скрежет.",
    "В лифтовом холле не работает освещение.",
    "На лестничной площадке слышен шум.",
  ])("сохраняет fail-closed subject: null по косвенному признаку лифта: %s", (problem) => {
    const parsed = parseRequestDraft(serializeDraft(createDraft({ problem, subject: null })));

    expectGeneratedDraft(parsed);
    expect(parsed.subject).toBeNull();
  });

  it("задаёт строгую generated-ветку по полям и лимитам PrimaryRequestDraft", () => {
    const generatedSchema = REQUEST_DRAFT_JSON_SCHEMA.properties.draft.anyOf[0];

    expect(generatedSchema.additionalProperties).toBe(false);
    expect(generatedSchema.required).toEqual([
      "outcome",
      "title",
      "problem",
      "circumstances",
      "impact",
      "verification",
      "subject",
      "actionPlan",
      "warnings",
    ]);
    expect(generatedSchema.properties).toEqual({
      outcome: { type: "string", enum: ["generated"] },
      title: {
        type: "string",
        minLength: 1,
        maxLength: primaryRequestDraftLimits.title.max,
      },
      problem: {
        type: "string",
        minLength: 1,
        maxLength: primaryRequestDraftLimits.problem.max,
      },
      circumstances: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: primaryRequestDraftLimits.circumstances.max,
      },
      impact: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: primaryRequestDraftLimits.impact.max,
      },
      verification: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: primaryRequestDraftLimits.verification.max,
      },
      subject: {
        type: "null",
      },
      actionPlan: {
        anyOf: expect.arrayContaining([
          expect.objectContaining({
            type: "object",
            additionalProperties: false,
            required: ["preliminaryCheck", "remedyActions", "resultCheck"],
          }),
        ]),
      },
      warnings: {
        type: "array",
        maxItems: primaryRequestDraftLimits.warnings.max,
        items: {
          type: "string",
          minLength: 1,
          maxLength: primaryRequestDraftLimits.warning.max,
        },
      },
    });
  });

  it.each([
    [
      "common_area_entrance_door" as const,
      [
        "common_area_premises_lighting",
        "common_area_premises_cleaning",
        "common_area_roof",
        "common_area_ventilation",
        "common_area_elevator",
      ],
    ],
    [
      "common_area_premises_lighting" as const,
      [
        "common_area_entrance_door",
        "common_area_premises_cleaning",
        "common_area_roof",
        "common_area_ventilation",
        "common_area_elevator",
      ],
    ],
    [
      "common_area_premises_cleaning" as const,
      [
        "common_area_entrance_door",
        "common_area_premises_lighting",
        "common_area_roof",
        "common_area_ventilation",
        "common_area_elevator",
      ],
    ],
    [
      "common_area_roof" as const,
      [
        "common_area_entrance_door",
        "common_area_premises_lighting",
        "common_area_premises_cleaning",
        "common_area_ventilation",
        "common_area_elevator",
      ],
    ],
    [
      "common_area_ventilation" as const,
      [
        "common_area_entrance_door",
        "common_area_premises_lighting",
        "common_area_premises_cleaning",
        "common_area_roof",
        "common_area_elevator",
      ],
    ],
    [
      "common_area_elevator" as const,
      [
        "common_area_entrance_door",
        "common_area_premises_lighting",
        "common_area_premises_cleaning",
        "common_area_roof",
        "common_area_ventilation",
      ],
    ],
  ])("ограничивает subject выбранным kind или null: %s", (selectedKind, excludedKinds) => {
    const subjectSchema =
      createRequestDraftJsonSchema(selectedKind).properties.draft.anyOf[0].properties.subject;

    expect(subjectSchema).toEqual({
      anyOf: [
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: [selectedKind] },
            evidence: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              items: {
                type: "object",
                properties: {
                  sourceField: {
                    type: "string",
                    enum: ["description", "location", "consequences", "desiredActions"],
                  },
                  quote: { type: "string", minLength: 10, maxLength: 300 },
                },
                required: ["sourceField", "quote"],
                additionalProperties: false,
              },
            },
          },
          required: ["kind", "evidence"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    });
    for (const excludedKind of excludedKinds) {
      expect(JSON.stringify(subjectSchema)).not.toContain(excludedKind);
    }
  });

  it("ограничивает общий размер procedural plan средствами provider JSON Schema", () => {
    const actionPlanSchemas =
      REQUEST_DRAFT_JSON_SCHEMA.properties.draft.anyOf[0].properties.actionPlan.anyOf;

    expect(actionPlanSchemas).toHaveLength(4);
    expect(
      actionPlanSchemas.map((schema) => [
        schema.properties.preliminaryCheck.type,
        schema.properties.resultCheck.type,
        schema.properties.remedyActions.maxItems,
      ]),
    ).toEqual([
      ["string", "string", 3],
      ["string", "null", 4],
      ["null", "string", 4],
      ["null", "null", 5],
    ]);

    for (const schema of actionPlanSchemas) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(["preliminaryCheck", "remedyActions", "resultCheck"]);
      expect(schema.properties.remedyActions.minItems).toBe(1);
      expect(schema.properties.remedyActions.items).toEqual({
        type: "string",
        minLength: 1,
        maxLength: primaryRequestDraftLimits.action.max,
      });
    }
  });

  it("задаёт строгую multiple_issues-ветку без частичного черновика", () => {
    const multipleIssuesSchema = REQUEST_DRAFT_JSON_SCHEMA.properties.draft.anyOf[1];

    expect(multipleIssuesSchema.additionalProperties).toBe(false);
    expect(multipleIssuesSchema.required).toEqual([
      "outcome",
      "title",
      "problem",
      "circumstances",
      "impact",
      "verification",
      "subject",
      "actionPlan",
      "warnings",
    ]);
    expect(multipleIssuesSchema.properties).toEqual({
      outcome: { type: "string", enum: ["multiple_issues"] },
      title: { type: "null" },
      problem: { type: "null" },
      circumstances: { type: "null" },
      impact: { type: "null" },
      verification: { type: "null" },
      subject: { type: "null" },
      actionPlan: { type: "null" },
      warnings: { type: "array", maxItems: 0, items: { type: "string" } },
    });
  });

  it("оставляет корневую оболочку строгой", () => {
    expect(REQUEST_DRAFT_JSON_SCHEMA).toEqual({
      type: "object",
      properties: {
        draft: {
          anyOf: expect.any(Array),
        },
      },
      required: ["draft"],
      additionalProperties: false,
    });
  });

  it("не содержит нормативной роли, законодательства, URL или готового body", () => {
    const schemaText = JSON.stringify(REQUEST_DRAFT_JSON_SCHEMA);

    for (const forbiddenFragment of [
      "legalBasis",
      "legalReferences",
      "law",
      "body",
      "Жилищн",
      "Правительств",
      "http://",
      "https://",
      COMMON_LEGAL_BASIS_BLOCK,
    ]) {
      expect(schemaText).not.toContain(forbiddenFragment);
    }
  });

  it("валидирует подробный provider-facing черновик входной двери и renderer сохраняет роли", () => {
    const draft = createDraft(detailedEntranceDoorDraft);

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);
    const result = renderGeneratedDraft(parsed);

    expect(parsed).toEqual(draft);
    expect(result.body).toContain(draft.problem);
    expect(result.body).toContain(draft.circumstances);
    expect(result.body).toContain(draft.impact);
    expect(parsed.actionPlan).toEqual({
      preliminaryCheck:
        "Проверить состояние доводчика, ограничителя, креплений двери и связанных элементов",
      remedyActions: ["Установить и закрепить ручку на входной двери"],
      resultCheck: "После работ проверить нормальное открывание и закрывание двери",
    });
    expect(result.body).toContain(
      "Прошу:\n1. Проверить состояние доводчика, ограничителя, креплений двери и связанных элементов",
    );
    expect(result.body).toContain("2. Установить и закрепить ручку на входной двери");
    expect(result.body).toContain(
      "3. После работ проверить нормальное открывание и закрывание двери",
    );
    expect(result.body).not.toContain("доводчик повреждён");
    expect(result.body).not.toContain("Устранить выявленные повреждения");
  });

  it("не добавляет отсутствующие подробности в минимальный черновик входной двери", () => {
    const draft = createDraft({
      title: "Отсутствует ручка входной двери",
      problem: "У входной двери подъезда отсутствует ручка.",
      circumstances: null,
      impact: null,
      verification: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Установить ручку на входную дверь"],
        resultCheck: null,
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);
    const result = renderGeneratedDraft(parsed);

    expect(parsed.circumstances).toBeNull();
    expect(parsed.impact).toBeNull();
    expect(parsed.verification).toBeNull();
    expect(parsed.actionPlan).toEqual({
      preliminaryCheck: null,
      remedyActions: ["Установить ручку на входную дверь"],
      resultCheck: null,
    });
    expect(result.body).toContain("Прошу:\n1. Установить ручку на входную дверь");
    expect(result.body).not.toContain("\n2. ");
    for (const absentFact of [
      "открыт",
      "ограничител",
      "нагруз",
      "доводчик",
      "поврежд",
      "креплен",
      "тип ручки",
      "диагност",
      "проверить работу",
      "проверить открывание",
      "проверить закрывание",
    ]) {
      expect(result.body.toLocaleLowerCase("ru")).not.toContain(absentFact);
    }
  });

  it("сохраняет предполагаемую причину только как предмет проверки", () => {
    const draft = createDraft({
      problem: "Входная дверь закрывается не полностью.",
      circumstances: null,
      impact: null,
      verification: "Пользователь предполагает неисправность доводчика.",
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Устранить неисправность двери и восстановить её полное закрывание"],
        resultCheck: "После работ проверить полное закрывание двери",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.problem).not.toContain("неисправность доводчика");
    expect(parsed.verification).toContain("предполагает неисправность доводчика");
    expect(renderGeneratedDraft(parsed).body).toContain(parsed.verification);
  });

  it("сохраняет явный риск в impact без утверждения наступившего повреждения", () => {
    const draft = createDraft({
      problem: "Входную дверь приходится удерживать вручную.",
      circumstances: null,
      impact: "Это создаёт риск повреждения креплений двери.",
      verification: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Восстановить работу двери"],
        resultCheck: null,
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.impact).toContain("риск повреждения");
    expect(parsed.impact).not.toContain("крепления повреждены");
  });

  it("принимает impact null при отсутствии основания", () => {
    const draft = createDraft({ impact: null });

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
  });

  it("принимает от одного до пяти итоговых пунктов procedural plan", () => {
    for (const actionPlan of [
      { preliminaryCheck: null, remedyActions: ["Устранить неисправность"], resultCheck: null },
      {
        preliminaryCheck: "Проверить причину",
        remedyActions: ["Первое", "Второе", "Третье"],
        resultCheck: "Проверить результат",
      },
    ]) {
      expect(parseRequestDraft(serializeDraft(createDraft({ actionPlan })))).toEqual(
        createDraft({ actionPlan }),
      );
    }
  });

  it("отклоняет шестой итоговый пункт без усечения", () => {
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: "Проверить причину",
          remedyActions: ["Первое", "Второе", "Третье", "Четвёртое"],
          resultCheck: "Проверить результат",
        },
      }),
    );
  });

  it("сохраняет полный procedural plan для неизвестного источника протечки", () => {
    const draft = createDraft({
      title: "Протечка в общем коридоре",
      problem: "С потолка в общем коридоре капает вода. Источник поступления воды не установлен.",
      impact: null,
      verification: null,
      actionPlan: {
        preliminaryCheck: "Установить источник поступления воды",
        remedyActions: ["Устранить причину протечки"],
        resultCheck: "После работ проверить прекращение поступления воды",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.actionPlan).toEqual(draft.actionPlan);
    const body = renderGeneratedDraft(parsed).body;
    expect(body).toContain(
      "Прошу:\n1. Установить источник поступления воды.\n2. Устранить причину протечки.\n3. После работ проверить прекращение поступления воды.",
    );
    for (const inventedFact of [
      "крыша",
      "труба",
      "квартира",
      "ремонт потолка",
      "плесень",
      "короткое замыкание",
      "разрушение конструкций",
    ]) {
      expect(body.toLocaleLowerCase("ru")).not.toContain(inventedFact);
    }
  });

  it("сохраняет explicit preliminary check отдельно от remedy actions", () => {
    const draft = createDraft({
      problem: "Дверь в помещении общего пользования не закрывается полностью.",
      impact: null,
      actionPlan: {
        preliminaryCheck: "Проверить механизм закрывания двери",
        remedyActions: ["Отремонтировать дверь и восстановить полное закрывание"],
        resultCheck: "После ремонта проверить полное закрывание двери",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.actionPlan).toEqual(draft.actionPlan);
    expect(renderGeneratedDraft(parsed).body).toContain(
      "1. Проверить механизм закрывания двери.\n2. Отремонтировать дверь и восстановить полное закрывание.\n3. После ремонта проверить полное закрывание двери.",
    );
  });

  it("не требует предварительную проверку для двери, которая не закрывается", () => {
    const draft = createDraft({
      title: "Дверь не закрывается полностью",
      problem: "Дверь в помещении общего пользования не закрывается полностью.",
      impact: null,
      verification: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Устранить неисправность двери и восстановить её полное закрывание"],
        resultCheck: "После работ проверить полное закрывание двери",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);
    const body = renderGeneratedDraft(parsed).body;

    expect(parsed.actionPlan.preliminaryCheck).toBeNull();
    expect(body).toContain(
      "1. Устранить неисправность двери и восстановить её полное закрывание.\n2. После работ проверить полное закрывание двери.",
    );
    for (const inventedComponent of ["доводчик", "петля", "замок", "ручка"]) {
      expect(body.toLocaleLowerCase("ru")).not.toContain(inventedComponent);
    }
  });

  it("сохраняет explicit result check для простого действия", () => {
    const draft = createDraft({
      title: "Не закреплена крышка почтового ящика",
      problem: "Крышка почтового ящика не закреплена.",
      impact: null,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Закрепить крышку почтового ящика"],
        resultCheck: "После работ проверить надёжность крепления крышки",
      },
    });

    const parsed = parseRequestDraft(serializeDraft(draft));
    expectGeneratedDraft(parsed);

    expect(parsed.actionPlan).toEqual(draft.actionPlan);
    expect(renderGeneratedDraft(parsed).body).toContain(
      "1. Закрепить крышку почтового ящика.\n2. После работ проверить надёжность крепления крышки.",
    );
  });

  it("валидирует multiple_issues только с безопасными пустыми значениями", () => {
    const draft = createMultipleIssuesDraft();

    expect(parseRequestDraft(serializeDraft(draft))).toEqual(draft);
    expectInvalidResponse({ ...draft, verification: "Проверить причину" });
    expectInvalidResponse({
      ...draft,
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Устранить первую проблему"],
        resultCheck: null,
      },
    });
  });

  it.each([
    ["title", "title", primaryRequestDraftLimits.title.max],
    ["problem", "problem", primaryRequestDraftLimits.problem.max],
    ["circumstances", "circumstances", primaryRequestDraftLimits.circumstances.max],
    ["impact", "impact", primaryRequestDraftLimits.impact.max],
    ["verification", "verification", primaryRequestDraftLimits.verification.max],
  ] as const)("проверяет точную границу поля %s и превышение", (_caseName, field, max) => {
    const exactValue = field === "title" ? "б".repeat(max) : `${"б".repeat(max - 1)}.`;
    const exactDraft = createDraft({
      problem: "а",
      impact: null,
      actionPlan: { preliminaryCheck: null, remedyActions: ["."], resultCheck: null },
      [field]: exactValue,
    });
    const tooLongDraft = createDraft({
      problem: "а",
      impact: null,
      actionPlan: { preliminaryCheck: null, remedyActions: ["в"], resultCheck: null },
      [field]: "б".repeat(max + 1),
    });

    expect(parseRequestDraft(serializeDraft(exactDraft))).toEqual(exactDraft);
    expectInvalidResponse(tooLongDraft);
  });

  it("проверяет границы элементов actionPlan и warnings", () => {
    const exactDraft = createDraft({
      problem: "а",
      impact: null,
      actionPlan: {
        preliminaryCheck: "а".repeat(primaryRequestDraftLimits.action.max),
        remedyActions: ["б".repeat(primaryRequestDraftLimits.action.max)],
        resultCheck: "в".repeat(primaryRequestDraftLimits.action.max),
      },
      warnings: ["в".repeat(primaryRequestDraftLimits.warning.max)],
    });

    expect(parseRequestDraft(serializeDraft(exactDraft))).toEqual(exactDraft);
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["б".repeat(primaryRequestDraftLimits.action.max + 1)],
          resultCheck: null,
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: "б".repeat(primaryRequestDraftLimits.action.max + 1),
          remedyActions: ["Восстановить освещение"],
          resultCheck: null,
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Восстановить освещение"],
          resultCheck: "б".repeat(primaryRequestDraftLimits.action.max + 1),
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: " ",
          remedyActions: ["Восстановить освещение"],
          resultCheck: null,
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Восстановить освещение"],
          resultCheck: " ",
        },
      }),
    );
    expectInvalidResponse(
      createDraft({ warnings: ["в".repeat(primaryRequestDraftLimits.warning.max + 1)] }),
    );
    expectInvalidResponse(
      createDraft({
        warnings: Array.from(
          { length: primaryRequestDraftLimits.warnings.max + 1 },
          (_, index) => `Предупреждение ${String(index + 1)}`,
        ),
      }),
    );
  });

  it("проверяет точный итоговый лимит body и превышение на один символ", () => {
    const maximumBodyWithoutSpecificLegalBasis =
      generateRequestLimits.result.bodyMax -
      (primaryRequestLegalBasisLimits.maximumBlockLength - COMMON_LEGAL_BASIS_BLOCK.length);
    const exactDraft = createDraftAtBodyLength(maximumBodyWithoutSpecificLegalBasis);
    const parsed = parseRequestDraft(serializeDraft(exactDraft));
    expectGeneratedDraft(parsed);

    expect(renderGeneratedDraft(parsed).body).toHaveLength(maximumBodyWithoutSpecificLegalBasis);
    expectInvalidResponse(createDraftAtBodyLength(maximumBodyWithoutSpecificLegalBasis + 1));
  });

  it("отклоняет невалидный JSON, лишние поля и неверную ветку outcome", () => {
    expect(() => parseRequestDraft('{"draft":')).toThrow(INVALID_RESPONSE_MESSAGE);
    expectInvalidResponse({ ...createDraft(), body: "Готовый текст" });
    const { actionPlan: _actionPlan, ...legacyDraft } = createDraft();
    expectInvalidResponse({ ...legacyDraft, requests: ["Восстановить освещение"] });
    expect(() =>
      parseRequestDraft(JSON.stringify({ draft: createDraft(), explanation: "Лишнее поле" })),
    ).toThrow(INVALID_RESPONSE_MESSAGE);
    expectInvalidResponse({ ...createDraft(), outcome: "unknown" });
  });

  it("строго отклоняет legacy-поля inspection и actions без compatibility fallback", () => {
    expectInvalidResponse({
      ...createDraft(),
      actionPlan: {
        preliminaryCheck: null,
        remedyActions: ["Восстановить освещение"],
        resultCheck: null,
        inspection: null,
        actions: ["Восстановить освещение"],
      },
    });
  });

  it("отклоняет отсутствие каждого обязательного поля", () => {
    for (const field of [
      "outcome",
      "title",
      "problem",
      "circumstances",
      "impact",
      "verification",
      "subject",
      "actionPlan",
      "warnings",
    ] as const) {
      const draft: Record<string, unknown> = { ...createDraft() };
      delete draft[field];
      expectInvalidResponse(draft);
    }
  });

  it("нормализует края строк, но отклоняет переводы строк и префикс «Прошу:»", () => {
    const parsed = parseRequestDraft(
      serializeDraft(
        createDraft({
          title: "  Не работает освещение  ",
          problem: "  Не работает освещение.  ",
          circumstances: "  Свет периодически включается.  ",
          impact: null,
          verification: "  Необходимо проверить проводку.  ",
          actionPlan: {
            preliminaryCheck: "  Проверить источник неисправности  ",
            remedyActions: ["  Восстановить освещение  "],
            resultCheck: "  Проверить работу освещения  ",
          },
          warnings: ["  Не указана длительность  "],
        }),
      ),
    );
    expectGeneratedDraft(parsed);

    expect(parsed.title).toBe("Не работает освещение");
    expect(parsed.circumstances).toBe("Свет периодически включается.");
    expect(parsed.verification).toBe("Необходимо проверить проводку.");
    expect(parsed.actionPlan).toEqual({
      preliminaryCheck: "Проверить источник неисправности",
      remedyActions: ["Восстановить освещение"],
      resultCheck: "Проверить работу освещения",
    });
    expectInvalidResponse(createDraft({ circumstances: "Условие\nпроявления" }));
    for (const actionPlan of [
      {
        preliminaryCheck: "Прошу: проверить освещение",
        remedyActions: ["Восстановить освещение"],
        resultCheck: null,
      },
      {
        preliminaryCheck: null,
        remedyActions: ["Прошу: восстановить освещение"],
        resultCheck: null,
      },
      {
        preliminaryCheck: null,
        remedyActions: ["Восстановить освещение"],
        resultCheck: "Прошу: проверить освещение",
      },
    ]) {
      expectInvalidResponse(createDraft({ actionPlan }));
    }
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: [""],
          resultCheck: null,
        },
      }),
    );
    expectInvalidResponse(
      createDraft({
        actionPlan: {
          preliminaryCheck: null,
          remedyActions: ["Восстановить\nосвещение"],
          resultCheck: null,
        },
      }),
    );
  });
});
