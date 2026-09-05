import type { ConfirmedProblemSubject, GenerateRequestInput } from "../src/index.js";

export type ScenarioCategory =
  | "only_required_description"
  | "description_with_location"
  | "known_consequences"
  | "desired_actions"
  | "all_fields"
  | "emotional_description"
  | "wording_normalization"
  | "minimum_sufficient_requests"
  | "location_action_deduplication"
  | "simple_defect"
  | "location_preservation"
  | "ambiguous_location"
  | "compatible_location"
  | "impact_subject_preservation"
  | "impact_normalization"
  | "unconfirmed_remedy"
  | "multiple_unrelated_issues"
  | "cleaning"
  | "lighting"
  | "elevator"
  | "unknown_remedy"
  | "explicit_remedy";

export type HardExpectation =
  | { kind: "warning_presence"; expected: boolean }
  | { kind: "subject_kind"; expected: ConfirmedProblemSubject | null }
  | { kind: "forbidden_subject_kind"; forbidden: ConfirmedProblemSubject }
  | { kind: "selected_normative_module"; expected: string | null };

export type ExpectationClassification = {
  blockerProductInvariants: readonly string[];
  qualityExpectations: readonly string[];
  acceptedBetaLimitations: readonly string[];
};

export type IssueProvenance = { issue: 200 | 201 | 202 | 203 | 218 | 219 };

type TestScenarioBase = {
  id: string;
  category: ScenarioCategory;
  input: GenerateRequestInput;
  expectationClassification?: ExpectationClassification;
};

export type TestScenario =
  | (TestScenarioBase & {
      expectedOutcome: "generated";
      mustPreserveFacts: string[];
      mustNotInvent: string[];
      expectWarning?: boolean;
      hardExpectations: readonly HardExpectation[];
      semanticExpectations: readonly string[];
      provenance?: IssueProvenance;
    })
  | (TestScenarioBase & {
      expectedOutcome: "multiple_issues";
      hardExpectations: readonly HardExpectation[];
      semanticExpectations: readonly string[];
      provenance?: IssueProvenance;
    });

type LegacyTestScenario =
  | (TestScenarioBase & {
      expectedOutcome: "generated";
      mustPreserveFacts: string[];
      mustNotInvent: string[];
      expectWarning?: boolean;
      provenance?: IssueProvenance;
      hardExpectations?: readonly HardExpectation[];
    })
  | (TestScenarioBase & {
      expectedOutcome: "multiple_issues";
      provenance?: IssueProvenance;
    });

const commonDoorConfirm: Partial<GenerateRequestInput> = {
  confirmedProblemSubject: "common_area_entrance_door",
};

const scenarioDefinitions: LegacyTestScenario[] = [
  {
    id: "only-description",
    category: "only_required_description",
    expectedOutcome: "generated",
    input: {
      description: "На лестничной площадке не работает освещение.",
    },
    mustPreserveFacts: ["на лестничной площадке не работает освещение"],
    mustNotInvent: [
      "перегоревшая лампа",
      "неисправность проводки или автомата",
      "факт падения",
      "факт травмы",
      "угроза жизни",
    ],
    expectWarning: false,
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить наблюдаемый факт об отсутствии освещения.",
        "Не придумывать причину, технический способ ремонта или наступивший вред.",
      ],
      qualityExpectations: ["Нормализовать описание в естественную деловую формулировку."],
      acceptedBetaLimitations: [
        "Единственный generic request item достаточен без отдельной диагностики и проверки результата.",
      ],
    },
  },
  {
    id: "description-location",
    category: "description_with_location",
    expectedOutcome: "generated",
    input: {
      description:
        "Во дворе провалился асфальт возле детской площадки. Яма глубиной около полуметра.",
      location: "детская площадка во дворе",
    },
    mustPreserveFacts: ["провал асфальта возле детской площадки", "глубина ямы около полуметра"],
    mustNotInvent: ["точные размеры ямы", "дата образования провала", "ответственные за ремонт"],
    expectWarning: false,
  },
  {
    id: "consequences",
    category: "known_consequences",
    expectedOutcome: "generated",
    input: {
      description: "Дверь помещения общего пользования не закрывается полностью.",
      consequences: "Существует риск утраты имущества из помещения.",
      ...commonDoorConfirm,
    },
    mustPreserveFacts: [
      "дверь помещения общего пользования не закрывается полностью",
      "явно переданный риск утраты имущества",
    ],
    mustNotInvent: [
      "утверждение, что имущество уже утрачено",
      "факт кражи",
      "конкретная неисправность двери",
    ],
    expectWarning: false,
  },
  {
    id: "desired-actions",
    category: "desired_actions",
    expectedOutcome: "generated",
    input: {
      description:
        "На трубе холодного водоснабжения в ванной появилась трещина, постоянно капает вода.",
      desiredActions:
        "Прошу заменить повреждённый участок трубы и проверить герметичность соединений.",
    },
    mustPreserveFacts: [
      "замена повреждённого участка трубы",
      "трещина на трубе холодного водоснабжения",
      "постоянная течь воды",
      "проверка герметичности соединений",
    ],
    mustNotInvent: [
      "стоимость ремонтных работ",
      "конкретные сроки выполнения",
      "название ремонтной организации",
    ],
    expectWarning: false,
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить explicit desiredActions целиком в одном backend-owned request item.",
        "Не добавлять рядом generic request item и не придумывать ремонт сверх пользовательского текста.",
      ],
      qualityExpectations: ["Не дублировать desiredActions в описательных полях."],
      acceptedBetaLimitations: ["Составное требование не сегментируется на отдельные действия."],
    },
  },
  {
    id: "all-fields",
    category: "all_fields",
    expectedOutcome: "generated",
    input: {
      description: "В подвале дома скопление воды и затхлый запах.",
      location: "подвал, секция 2",
      consequences:
        "Затопление подвала, риск появления плесени и грибка, повреждение хранящихся вещей.",
      desiredActions:
        "Прошу провести осмотр, откачать воду, установить и устранить причину скопления воды и обработать помещение от плесени.",
    },
    mustPreserveFacts: [
      "скопление воды в подвале",
      "затхлый запах",
      "затопление подвала",
      "секция 2 подвала",
      "риск появления плесени и грибка",
      "повреждение хранящихся вещей",
      "осмотр подвала",
      "откачка воды",
      "установление и устранение причины скопления воды",
      "обработка помещения от плесени",
    ],
    mustNotInvent: ["адрес или номер дома", "контактные данные", "сумма нанесённого ущерба"],
    expectWarning: false,
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить все explicit desiredActions целиком в одном backend-owned request item.",
        "Сохранить явно переданные описание, место и последствия без выдуманных фактов.",
      ],
      qualityExpectations: ["Не дублировать одни сведения между описательными полями."],
      acceptedBetaLimitations: ["Составное требование не разбивается на процедурные роли."],
    },
  },
  {
    id: "emotional",
    category: "emotional_description",
    expectedOutcome: "generated",
    input: {
      description:
        "Кошмар! Третью неделю лифт не работает! Соседка на восьмом этаже еле ходит, а мы с коляской как альпинисты. Когда это прекратится?! Сил нет!",
    },
    mustPreserveFacts: [
      "лифт не работает три недели",
      "соседке с восьмого этажа тяжело ходить при неработающем лифте",
      "неудобства для пользователя с коляской",
    ],
    mustNotInvent: [
      "фамилии жильцов",
      "номер дома",
      "точная дата поломки лифта",
      "возрастные, медицинские или социальные категории жильцов",
      "требования сообщить сроки ремонта, предоставить ответ или отчитаться о работах",
    ],
    expectWarning: false,
  },
  {
    id: "wording-normalization",
    category: "wording_normalization",
    expectedOutcome: "generated",
    input: {
      description: "дверь в помещение общего пользования не закрывается до конца надо исправить",
      ...commonDoorConfirm,
    },
    mustPreserveFacts: ["дверь в помещении общего пользования не закрывается полностью"],
    mustNotInvent: [
      "неисправность доводчика",
      "неисправность замка или петель",
      "уже произошедшая кража",
      "срок выполнения работ",
    ],
    expectWarning: false,
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить пользовательский факт о двери, которая не закрывается до конца.",
        "Не добавлять риск доступа, причину неисправности или конкретный ремонт без основания.",
      ],
      qualityExpectations: ["Нормализовать разговорную формулировку без изменения смысла."],
      acceptedBetaLimitations: [
        "Не требовать автоматически установление причины и проверку двери после работ.",
      ],
    },
  },
  {
    id: "minimum-sufficient-requests",
    category: "minimum_sufficient_requests",
    expectedOutcome: "generated",
    input: {
      description: "С потолка в общем коридоре капает вода. Источник протечки неизвестен.",
    },
    mustPreserveFacts: ["с потолка в общем коридоре капает вода", "источник протечки неизвестен"],
    mustNotInvent: [
      "крыша как источник протечки",
      "труба как источник протечки",
      "квартира как источник протечки",
      "повреждение или ремонт потолка",
      "плесень, короткое замыкание или разрушение конструкций",
    ],
    expectWarning: false,
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить наблюдаемую воду и неизвестность её источника.",
        "Не превращать предполагаемый источник или способ ремонта в установленный факт.",
      ],
      qualityExpectations: ["Сформулировать неизвестность ясно и без лишнего текста."],
      acceptedBetaLimitations: [
        "Не требовать автоматически цепочку установления причины, устранения и проверки результата.",
      ],
    },
  },
  {
    id: "location-action-deduplication",
    category: "location_action_deduplication",
    expectedOutcome: "generated",
    input: {
      description: "С потолка в общем коридоре капает вода. Источник протечки неизвестен.",
      location: "подъезд 2, этаж 5",
    },
    mustPreserveFacts: [
      "с потолка в общем коридоре капает вода",
      "источник протечки неизвестен",
      "место проблемы: подъезд 2, этаж 5",
    ],
    mustNotInvent: [
      "крыша как источник протечки",
      "труба как источник протечки",
      "квартира как источник протечки",
      "другой конкретный источник протечки",
    ],
    expectWarning: false,
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить оба места проявления и неизвестность источника.",
        "Не придумывать конкретный источник воды.",
      ],
      qualityExpectations: ["Не повторять место механически в описательной части."],
      acceptedBetaLimitations: ["Раздел требований содержит один generic request item."],
    },
  },
  {
    id: "simple-defect",
    category: "simple_defect",
    expectedOutcome: "generated",
    input: {
      description: "На входной двери отсутствует ручка.",
    },
    mustPreserveFacts: ["на входной двери отсутствует ручка"],
    mustNotInvent: [
      "причина отсутствия ручки",
      "конкретная установка ручки без explicit desiredActions",
      "неисправность доводчика",
      "обязательная диагностика причины",
      "искусственная цепочка диагностика → ремонт → проверка",
      "необоснованное практическое значение или риск",
      "дополнительные формальные требования",
    ],
    expectWarning: false,
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить наблюдаемый факт отсутствия ручки.",
        "Не выбирать установку ручки или другой конкретный ремонт без explicit desiredActions.",
      ],
      qualityExpectations: ["Сохранить краткую естественную формулировку проблемы."],
      acceptedBetaLimitations: ["Generic request item является достаточным требованием."],
    },
  },
  {
    id: "location-preservation",
    category: "location_preservation",
    expectedOutcome: "generated",
    input: {
      description: "Дверь в помещении общего пользования не закрывается полностью.",
      location: "подъезд 3, этаж 4",
      ...commonDoorConfirm,
    },
    mustPreserveFacts: ["дверь не закрывается полностью", "подъезд 3", "этаж 4"],
    mustNotInvent: [
      "конкретная причина неисправности",
      "номер дома",
      "скрытое повреждение двери",
      "уже произошедшая кража",
    ],
    expectWarning: false,
  },
  {
    id: "ambiguous-location",
    category: "ambiguous_location",
    expectedOutcome: "generated",
    input: {
      description:
        "Дверь в помещении общего пользования во втором подъезде не закрывается полностью.",
      location: "подъезд 3, этаж 4",
      ...commonDoorConfirm,
    },
    mustPreserveFacts: ["дверь не закрывается полностью", "второй подъезд", "подъезд 3", "этаж 4"],
    mustNotInvent: [
      "утверждение, что одно из двух мест фактически верное",
      "автоматическое разделение связанной проблемы на две заявки",
      "warning, который объявляет одно из мест фактически верным",
    ],
  },
  {
    id: "multi-location",
    category: "location_preservation",
    expectedOutcome: "generated",
    input: {
      description:
        "Двери в помещениях общего пользования во втором и третьем подъездах не закрываются полностью.",
      location: "четвёртый этаж",
      ...commonDoorConfirm,
    },
    mustPreserveFacts: [
      "двери не закрываются полностью",
      "второй и третий подъезды",
      "четвёртый этаж",
      "одна связанная проблема в нескольких местах",
    ],
    mustNotInvent: [
      "утверждение, что верно только одно место",
      "автоматическое разделение связанной проблемы на несколько заявок",
      "конкретная причина неисправности дверей",
    ],
    expectWarning: false,
  },
  {
    id: "compatible-location",
    category: "compatible_location",
    expectedOutcome: "generated",
    input: {
      description: "В третьем подъезде дверь не закрывается полностью.",
      location: "подъезд 3, этаж 4",
      ...commonDoorConfirm,
    },
    mustPreserveFacts: ["дверь не закрывается полностью", "подъезд 3", "этаж 4"],
    mustNotInvent: ["конфликт места", "другой подъезд", "причина неисправности"],
    expectWarning: false,
  },
  {
    id: "impact-subject-subjective",
    category: "impact_subject_preservation",
    provenance: { issue: 203 },
    expectedOutcome: "generated",
    input: {
      description: "В кабине лифта не работает освещение.",
      consequences: "В кабине темно и страшно.",
    },
    mustPreserveFacts: ["темнота в кабине лифта", "субъективный дискомфорт без новой группы людей"],
    mustNotInvent: [
      "страх пассажиров",
      "страх жильцов",
      "опасения других пользователей",
      "массовое чувство страха",
    ],
    expectWarning: false,
  },
  {
    id: "impact-subject-objective",
    category: "impact_subject_preservation",
    provenance: { issue: 203 },
    expectedOutcome: "generated",
    input: {
      description: "На лестничной площадке не работает освещение.",
      consequences: "Вечером проход плохо виден.",
    },
    mustPreserveFacts: [
      "ограниченная видимость прохода в вечернее время",
      "нейтральная профессиональная формулировка ограниченной видимости без новой группы людей",
    ],
    mustNotInvent: [
      "затруднение прохода жильцов",
      "массовое неудобство",
      "неопределённое количество затронутых людей",
    ],
    expectWarning: false,
  },
  {
    id: "impact-subject-explicit-group",
    category: "impact_subject_preservation",
    provenance: { issue: 203 },
    expectedOutcome: "generated",
    input: {
      description: "Входная дверь подъезда открывается с усилием.",
      consequences: "Пожилым жильцам трудно открыть дверь.",
    },
    mustPreserveFacts: [
      "пожилым жильцам трудно открыть дверь",
      "явно указанная группа людей сохранена без расширения",
    ],
    mustNotInvent: [
      "всем жителям трудно открыть дверь",
      "большому числу жильцов",
      "другой группе людей",
    ],
    expectWarning: false,
  },
  {
    id: "unconfirmed-remedy-lighting",
    category: "unconfirmed_remedy",
    expectedOutcome: "generated",
    input: {
      description: "В кабине лифта не работает освещение.",
      desiredActions: "Восстановить освещение.",
    },
    mustPreserveFacts: ["восстановление освещения в кабине лифта"],
    mustNotInvent: [
      "замена лампы",
      "замена проводки",
      "замена выключателя",
      "закрытый перечень предполагаемых причин",
    ],
    expectWarning: false,
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить explicit desiredActions о восстановлении освещения целиком.",
        "Не придумывать лампу, проводку, выключатель или иной способ ремонта.",
      ],
      qualityExpectations: ["Не дублировать пользовательское требование в descriptive prose."],
      acceptedBetaLimitations: ["Не добавлять отдельное требование установить причину."],
    },
  },
  {
    id: "unconfirmed-remedy-door",
    category: "unconfirmed_remedy",
    expectedOutcome: "generated",
    input: {
      description: "Входная дверь открывается с большим усилием.",
      desiredActions: "Восстановить нормальное открывание двери.",
    },
    mustPreserveFacts: ["восстановление нормального открывания двери"],
    mustNotInvent: [
      "регулировка петель",
      "замена доводчика",
      "ремонт замка",
      "смазка конкретного механизма",
    ],
    expectWarning: false,
  },
  {
    id: "confirmed-remedy-door-handle",
    category: "unconfirmed_remedy",
    provenance: { issue: 202 },
    expectedOutcome: "generated",
    input: {
      description: "На входной двери отсутствует ручка.",
      desiredActions: "Установить ручку на входную дверь.",
    },
    mustPreserveFacts: [
      "установка ручки на входную дверь",
      "конкретное действие, непосредственно следующее из отсутствия ручки",
    ],
    mustNotInvent: ["обязательная диагностика двери", "неподтверждённая причина отсутствия ручки"],
    expectWarning: false,
  },
  {
    id: "multiple-issues",
    category: "multiple_unrelated_issues",
    expectedOutcome: "multiple_issues",
    input: {
      description:
        "На детской площадке сломаны качели, торчат острые болты. А ещё в соседнем дворе кто-то бросил старый диван возле мусорных баков, и он уже неделю там валяется.",
    },
  },
];

function toTestScenario(scenario: LegacyTestScenario): TestScenario {
  if (scenario.expectedOutcome === "multiple_issues") {
    return {
      ...scenario,
      hardExpectations: [],
      semanticExpectations: [
        "Не объединять две самостоятельные наблюдаемые проблемы в одну заявку.",
      ],
    };
  }

  return {
    ...scenario,
    hardExpectations: [
      ...(scenario.expectWarning === undefined
        ? []
        : [{ kind: "warning_presence" as const, expected: scenario.expectWarning }]),
      ...(scenario.hardExpectations ?? []),
    ],
    semanticExpectations: [
      ...scenario.mustPreserveFacts.map((expectation) => `Сохранить: ${expectation}.`),
      ...scenario.mustNotInvent.map((expectation) => `Не добавлять: ${expectation}.`),
    ],
  };
}

const commonCleaningHardExpectations: readonly HardExpectation[] = [
  { kind: "warning_presence", expected: false },
  { kind: "subject_kind", expected: "common_area_premises_cleaning" },
  { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
  { kind: "forbidden_subject_kind", forbidden: "common_area_entrance_door" },
  { kind: "selected_normative_module", expected: "common-area-cleaning" },
];

const regressionScenarios: TestScenario[] = [
  {
    id: "cleaning-elevator-cabin",
    category: "cleaning",
    provenance: { issue: 200 },
    expectedOutcome: "generated",
    input: {
      description:
        "В кабине грузового лифта несколько дней остаётся загрязнение и неприятный запах. Сам лифт работает.",
      location: "второй подъезд",
      desiredActions: "Убрать загрязнение из кабины грузового лифта.",
      confirmedProblemSubject: "common_area_premises_cleaning",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: commonCleaningHardExpectations,
    semanticExpectations: [
      "Не переинтерпретировать загрязнение исправной кабины лифта как техническую неисправность лифта.",
      "Сохранить проблему как уборку помещения общего пользования.",
    ],
  },
  {
    id: "cleaning-entrance-door",
    category: "cleaning",
    provenance: { issue: 200 },
    expectedOutcome: "generated",
    input: {
      description:
        "На входной двери несколько дней остаётся загрязнение и неприятный запах. Дверь открывается и закрывается нормально.",
      location: "второй подъезд",
      desiredActions: "Очистить входную дверь от загрязнения.",
      confirmedProblemSubject: "common_area_premises_cleaning",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: commonCleaningHardExpectations,
    semanticExpectations: [
      "Не назначать технический ремонт двери только из-за её загрязнения.",
      "Сохранить подтверждённую применимость уборки.",
    ],
  },
  {
    id: "cleaning-common-area-wall",
    category: "cleaning",
    provenance: { issue: 200 },
    expectedOutcome: "generated",
    input: {
      description: "На стене в подъезде несколько дней остаётся загрязнение и неприятный запах.",
      location: "второй подъезд",
      desiredActions: "Очистить стену от загрязнения.",
      confirmedProblemSubject: "common_area_premises_cleaning",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: commonCleaningHardExpectations,
    semanticExpectations: [
      "Не придумывать повреждение стены или иной технический дефект.",
      "Описать проблему как уборку загрязнения.",
    ],
  },
  {
    id: "cleaning-entrance-door-mistaken-door-confirmation",
    category: "cleaning",
    provenance: { issue: 200 },
    expectedOutcome: "generated",
    input: {
      description:
        "Технически исправная входная дверь загрязнена, но нормально открывается и закрывается.",
      location: "второй подъезд",
      desiredActions: "Очистить входную дверь от загрязнения.",
      confirmedProblemSubject: "common_area_entrance_door",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: [
      { kind: "warning_presence", expected: false },
      { kind: "subject_kind", expected: "common_area_premises_cleaning" },
      { kind: "forbidden_subject_kind", forbidden: "common_area_entrance_door" },
      { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
      { kind: "selected_normative_module", expected: null },
    ],
    semanticExpectations: [
      "Не выбирать технический предмет двери только из-за ошибочного backend-подтверждения.",
      "Не применять ни door-, ни cleaning-module при расхождении подтверждённого и independently inferred subject.",
    ],
  },
  {
    id: "cleaning-elevator-cabin-mistaken-elevator-confirmation",
    category: "cleaning",
    provenance: { issue: 200 },
    expectedOutcome: "generated",
    input: {
      description: "В исправной кабине лифта загрязнены пол и стены. Лифт работает.",
      location: "второй подъезд",
      desiredActions: "Убрать загрязнение из кабины.",
      confirmedProblemSubject: "common_area_elevator",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: [
      { kind: "warning_presence", expected: false },
      { kind: "subject_kind", expected: "common_area_premises_cleaning" },
      { kind: "forbidden_subject_kind", forbidden: "common_area_entrance_door" },
      { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
      { kind: "selected_normative_module", expected: null },
    ],
    semanticExpectations: [
      "Не выбирать технический предмет лифта только из-за ошибочного backend-подтверждения.",
      "Не применять ни elevator-, ни cleaning-module при расхождении подтверждённого и independently inferred subject.",
    ],
  },
  {
    id: "lighting-elevator-cabin",
    category: "lighting",
    provenance: { issue: 201 },
    expectedOutcome: "generated",
    input: {
      description: "В кабине лифта не работает освещение.",
      location: "второй подъезд",
      consequences: "В кабине темно.",
      desiredActions: "Восстановить освещение.",
      confirmedProblemSubject: "common_area_premises_lighting",
    },
    mustPreserveFacts: ["отсутствие освещения в кабине лифта", "в кабине темно"],
    mustNotInvent: [
      "техническая неисправность лифта",
      "неисправность лампы, проводки, выключателя или другого конкретного элемента",
      "замена лампы или другой неподтверждённый способ ремонта",
    ],
    expectWarning: false,
    hardExpectations: [
      { kind: "warning_presence", expected: false },
      { kind: "subject_kind", expected: "common_area_premises_lighting" },
      { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
      { kind: "selected_normative_module", expected: "common-area-lighting" },
    ],
    semanticExpectations: [
      "Не терять предмет освещения только из-за места проявления в кабине лифта.",
      "Не превращать отсутствие света само по себе в техническую проблему лифта.",
      "Сохранить explicit desiredActions целиком в одном backend-owned request item.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить subject освещения и не выбрать технический subject лифта.",
        "Сохранить explicit desiredActions целиком без неподтверждённого способа ремонта.",
      ],
      qualityExpectations: ["Естественно сохранить место и явно переданное последствие."],
      acceptedBetaLimitations: ["Не формировать отдельный план диагностики и проверки результата."],
    },
  },
  {
    id: "elevator-position-indicator",
    category: "elevator",
    provenance: { issue: 218 },
    expectedOutcome: "generated",
    input: {
      description: "На первом этаже не работает индикатор положения лифта.",
      location: "второй подъезд",
      consequences: "Из-за этого не видно, на каком этаже находится лифт.",
      desiredActions: "Восстановить работу индикатора.",
      confirmedProblemSubject: "common_area_elevator",
    },
    mustPreserveFacts: [
      "неработающий индикатор положения лифта на первом этаже",
      "второй подъезд",
      "не видно, на каком этаже находится лифт",
      "восстановление работы индикатора",
    ],
    mustNotInvent: [
      "причина неисправности индикатора",
      "аварийное состояние лифта",
      "необходимость отключения лифта",
      "конкретный способ ремонта или замена оборудования",
    ],
    expectWarning: false,
    hardExpectations: [
      { kind: "warning_presence", expected: false },
      { kind: "subject_kind", expected: "common_area_elevator" },
      { kind: "selected_normative_module", expected: "common-area-elevator" },
    ],
    semanticExpectations: [
      "Сохранить неисправность индикатора как наблюдаемую проблему лифтового оборудования.",
      "Не устанавливать техническую причину или конкретный способ ремонта.",
    ],
  },
  {
    id: "elevator-subject-false-positive-lighting",
    category: "elevator",
    provenance: { issue: 218 },
    expectedOutcome: "generated",
    input: {
      description: "В кабине лифта не работает освещение.",
      location: "второй подъезд",
      consequences: "В кабине темно.",
      desiredActions: "Восстановить освещение.",
      confirmedProblemSubject: "common_area_elevator",
    },
    mustPreserveFacts: [
      "отсутствие освещения в кабине лифта",
      "второй подъезд",
      "в кабине темно",
      "восстановление освещения",
    ],
    mustNotInvent: [
      "техническая неисправность лифта",
      "неисправность лифтового оборудования",
      "причина отсутствия освещения",
      "конкретный способ ремонта или замена оборудования",
    ],
    expectWarning: false,
    hardExpectations: [
      { kind: "warning_presence", expected: false },
      { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
      { kind: "selected_normative_module", expected: null },
    ],
    semanticExpectations: [
      "Не выбирать предмет лифта только из-за ошибочного confirmedProblemSubject.",
      "Не применять нормативный модуль лифта без предмета, подтверждённого пользовательским текстом.",
      "Не придумывать техническую причину неисправности лифта или освещения.",
    ],
  },
  {
    id: "unknown-remedy-lighting",
    category: "unknown_remedy",
    provenance: { issue: 202 },
    expectedOutcome: "generated",
    input: {
      description: "Освещение в помещении общего пользования не работает. Причина неизвестна.",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: [{ kind: "warning_presence", expected: false }],
    semanticExpectations: [
      "Не назначать конкретный способ ремонта при неизвестной причине.",
      "Сохранить неизвестность причины в descriptive prose.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить неизвестность причины и не придумать способ ремонта.",
        "Использовать один backend-owned generic request item.",
      ],
      qualityExpectations: ["Описать наблюдаемую проблему кратко и естественно."],
      acceptedBetaLimitations: ["Отдельные проверка причины и проверка результата не требуются."],
    },
  },
  {
    id: "unknown-remedy-functional-defect",
    category: "unknown_remedy",
    provenance: { issue: 202 },
    expectedOutcome: "generated",
    input: {
      description: "Вентиляция в помещении общего пользования не работает. Причина неизвестна.",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: [{ kind: "warning_presence", expected: false }],
    semanticExpectations: [
      "Не превращать неизвестную причину функционального дефекта в конкретный способ ремонта.",
      "Сохранить неизвестность причины в descriptive prose.",
    ],
  },
  {
    id: "impact-natural-lift-consequence",
    category: "impact_normalization",
    provenance: { issue: 219 },
    expectedOutcome: "generated",
    input: {
      description: "Лифт не работает.",
      location: "второй подъезд",
      consequences: "Приходится подниматься вручную.",
      desiredActions: "Нужно починить лифт.",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: [{ kind: "warning_presence", expected: false }],
    semanticExpectations: [
      "Сохранить смысл явно переданного последствия: из-за неработающего лифта приходится подниматься без его использования.",
      "Сформулировать последствие естественно для перемещения человека без требования дословно копировать пользовательскую лексику.",
      "Вывести последствие один раз в impact и не повторять его в circumstances или другой динамической роли без отдельного необходимого смысла.",
      "Не добавлять пользователей, жильцов, пассажиров или другую не указанную во входе группу людей.",
      "Не добавлять новые факты, обстоятельства или последствия.",
    ],
  },
  {
    id: "impact-natural-manual-door-operation",
    category: "impact_normalization",
    provenance: { issue: 219 },
    expectedOutcome: "generated",
    input: {
      description: "Автоматическая дверь в общем помещении не открывается автоматически.",
      location: "тамбур второго подъезда",
      consequences: "Дверь приходится открывать вручную.",
      desiredActions: "Нужно восстановить автоматическое открывание двери.",
    },
    mustPreserveFacts: [],
    mustNotInvent: [],
    expectWarning: false,
    hardExpectations: [{ kind: "warning_presence", expected: false }],
    semanticExpectations: [
      "Сохранить явно переданное последствие: дверь приходится открывать вручную.",
      "Считать ручное открывание двери естественным описанием этого действия и не заменять его механически.",
      "Вывести последствие один раз в impact и не повторять его в circumstances или другой динамической роли без отдельного необходимого смысла.",
      "Не добавлять пользователей, жильцов или другую не указанную во входе группу людей.",
      "Не добавлять новые факты, обстоятельства или последствия.",
    ],
  },
];

export const scenarios: TestScenario[] = [
  ...scenarioDefinitions.map(toTestScenario),
  ...regressionScenarios,
];
