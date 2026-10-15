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

export type IssueProvenance = { issue: 200 | 201 | 202 | 203 | 218 | 219 | 224 | 267 };

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
        "Сохранить смысл explicit desiredActions целиком в одном backend-owned request item.",
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
        "Сохранить смысл всех explicit desiredActions целиком в одном backend-owned request item.",
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
    mustPreserveFacts: ["лифт не работает третью неделю", "неудобства из-за неработающего лифта"],
    mustNotInvent: [
      "фамилии жильцов",
      "номер дома",
      "точная дата поломки лифта",
      "три полные недели простоя лифта",
      "причина неисправности лифта",
      "повреждение лифта или другого имущества",
      "уже выполненные работы",
      "конкретный способ ремонта",
      "новое событие или факт, не связанный с обобщением явно названных участников",
      "новые участники, не являющиеся обобщением явно названных участников",
      "требования сообщить сроки ремонта, предоставить ответ или отчитаться о работах",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить неисправность лифта и явно указанную длительность без ложной точности.",
        "Не придумывать причины, повреждения, выполненные работы, конкретный ремонт или новые события.",
      ],
      qualityExpectations: [
        "Сохранить смысл явно описанных неудобств без требования перечислить каждого участника.",
      ],
      acceptedBetaLimitations: [
        "В сложном эмоциональном description допускается обобщение явно названных участников.",
      ],
    },
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
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить оба места проявления и неизвестность источника.",
        "Не придумывать конкретный источник воды.",
      ],
      qualityExpectations: [],
      acceptedBetaLimitations: [
        "Допускается безопасное повторение места без semantic deduplication.",
        "Раздел требований содержит один generic request item.",
      ],
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
        "Сохранить целиком смысл explicit desiredActions о восстановлении освещения.",
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
    hardExpectations: [
      { kind: "forbidden_subject_kind", forbidden: "common_area_entrance_door" },
      { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
      { kind: "selected_normative_module", expected: null },
    ],
    semanticExpectations: [
      "Не выбирать технический предмет двери только из-за ошибочного backend-подтверждения.",
      "Не применять предметный нормативный модуль при ошибочном подтверждении.",
      "Сохранить весь смысл desiredActions одним request item без требования дословного совпадения: Очистить входную дверь от загрязнения.",
      "Не придумывать технический ремонт двери.",
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
    hardExpectations: [
      { kind: "forbidden_subject_kind", forbidden: "common_area_entrance_door" },
      { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
      { kind: "selected_normative_module", expected: null },
    ],
    semanticExpectations: [
      "Не выбирать технический предмет лифта только из-за ошибочного backend-подтверждения.",
      "Не применять предметный нормативный модуль при ошибочном подтверждении.",
      "Сохранить весь смысл desiredActions одним request item без требования дословного совпадения: Убрать загрязнение из кабины.",
      "Не придумывать технический ремонт лифта.",
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
      "Сохранить смысл explicit desiredActions целиком в одном backend-owned request item.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "Сохранить subject освещения и не выбрать технический subject лифта.",
        "Сохранить смысл explicit desiredActions целиком без неподтверждённого способа ремонта.",
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
  {
    id: "description-fact-preservation",
    category: "wording_normalization",
    provenance: { issue: 224 },
    expectedOutcome: "generated",
    input: {
      description: "Протекает люк на пятом этаже, он последний.",
      location: "первый подъезд, пятый этаж",
      consequences: "Затопило весь подъезд.",
      desiredActions: "Нужно устранить причину протечки.",
    },
    mustPreserveFacts: [
      "протечка люка на пятом этаже",
      "пятый этаж",
      "первый подъезд",
      "затопление всего подъезда",
      "устранение причины протечки",
    ],
    mustNotInvent: [
      "последний люк",
      "пятый этаж является верхним или последним",
      "техническая причина протечки, повреждённый элемент или источник воды",
      "соединения, примыкания, коммуникации или другой связанный компонент",
      "конкретный способ ремонта",
      "новые последствия, расширение группы затопления или желаемого действия",
    ],
    hardExpectations: [],
    semanticExpectations: [
      "В финальном копируемом body сохранить протечку люка и его связь с пятым этажом, сам пятый этаж, первый подъезд и факт затопления всего подъезда.",
      "Связь «он последний» существенно неоднозначна: не выбирать люк или этаж и не утверждать, что пятый этаж верхний или последний. Допустимо опустить только эту связь.",
      "В разделе «Прошу:» сохранить целиком смысл явного desiredActions об устранении причины протечки без изменения или расширения действия. Официальная переформулировка допустима, а при requestItem: null используется исходный текст после минимальной нормализации представления.",
      "Не добавлять техническую причину, повреждённый элемент, источник воды, соединения, примыкания, коммуникации, другой связанный компонент или конкретный способ ремонта.",
      "Не добавлять последствия и не расширять группу затопления. Сохранить статус фактов без превращения в предположения или риски.",
      "Безопасное предупреждение необязательно, не заменяет факты в body и не создаёт новый факт. Стиль, порядок и повтор без изменения смысла относятся только к качеству.",
    ],
  },
  {
    id: "description-explicit-referent-preservation",
    category: "wording_normalization",
    provenance: { issue: 224 },
    expectedOutcome: "generated",
    input: {
      description: "Протекает люк на пятом, верхнем этаже.",
      location: "первый подъезд, пятый этаж",
      consequences: "Затопило весь подъезд.",
      desiredActions: "Нужно устранить причину протечки.",
    },
    mustPreserveFacts: [
      "протечка люка на пятом этаже",
      "пятый этаж является верхним",
      "признак верхнего относится именно к пятому этажу",
      "первый подъезд",
      "затопление всего подъезда",
      "устранение причины протечки",
    ],
    mustNotInvent: [
      "неоднозначность явно указанной связи верхнего этажа с пятым",
      "техническая причина протечки, повреждённый элемент или источник воды",
      "соединения, примыкания, коммуникации или другой связанный компонент",
      "конкретный способ ремонта",
      "новые последствия, расширение группы затопления или желаемого действия",
    ],
    hardExpectations: [],
    semanticExpectations: [
      "В финальном копируемом body сохранить протечку люка и его связь с пятым этажом, первый подъезд и факт затопления всего подъезда.",
      "Обязательно сохранить однозначный факт, что именно пятый этаж является верхним. Не опускать его, не приписывать другому объекту и не превращать в предположение или возможность. Послабление для неоднозначного ввода неприменимо.",
      "В разделе «Прошу:» сохранить целиком смысл явного desiredActions об устранении причины протечки без изменения или расширения действия. Официальная переформулировка допустима, а при requestItem: null используется исходный текст после минимальной нормализации представления.",
      "Не добавлять техническую причину, повреждённый элемент, источник воды, соединения, примыкания, коммуникации, другой связанный компонент или конкретный способ ремонта.",
      "Не добавлять последствия и не расширять группу затопления. Сохранить статус фактов без превращения в предположения или риски.",
      "Безопасное предупреждение необязательно, не заменяет факты в body и не объявляет однозначный факт неоднозначным. Стиль, порядок и повтор без изменения смысла относятся только к качеству.",
    ],
  },
];

const requestItemNormalizationScenarios: TestScenario[] = [
  {
    id: "request-item-emotional",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "С потолка общего коридора капает вода.",
      desiredActions: "Прекратите потоп!",
    },
    mustPreserveFacts: ["прекращение затопления"],
    mustNotInvent: [
      "ремонт кровли, герметизация или замена элементов",
      "установленный источник воды",
    ],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: прекращение затопления.",
      "Не добавлять: ремонт кровли, герметизация или замена элементов.",
      "Не добавлять: установленный источник воды.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "прекращение затопления",
        "Не добавлять: ремонт кровли, герметизация или замена элементов",
        "Не добавлять: установленный источник воды",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-conditional-repair",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "С потолка общего коридора капает вода.",
      desiredActions: "Проверьте крышу и, если она течёт, устраните протечку.",
    },
    mustPreserveFacts: [
      "проверка крыши",
      "устранение протечки только при подтверждении, что крыша течёт",
    ],
    mustNotInvent: ["безусловный ремонт крыши", "крыша как уже установленный источник протечки"],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: проверка крыши.",
      "Сохранить: устранение протечки только при подтверждении, что крыша течёт.",
      "Не добавлять: безусловный ремонт крыши.",
      "Не добавлять: крыша как уже установленный источник протечки.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "проверка крыши",
        "устранение протечки только при подтверждении, что крыша течёт",
        "Не добавлять: безусловный ремонт крыши",
        "Не добавлять: крыша как уже установленный источник протечки",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-inspection-only",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "Входная дверь закрывается с усилием.",
      desiredActions: "Только осмотрите, ничего пока не ремонтируйте.",
    },
    mustPreserveFacts: ["только осмотр", "временный запрет любого ремонта: пока"],
    mustNotInvent: [
      "разрешение ремонта после осмотра без нового решения",
      "новая диагностика, замена или регулировка",
    ],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: только осмотр.",
      "Сохранить: временный запрет любого ремонта: пока.",
      "Не добавлять: разрешение ремонта после осмотра без нового решения.",
      "Не добавлять: новая диагностика, замена или регулировка.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "только осмотр",
        "временный запрет любого ремонта: пока",
        "Не добавлять: разрешение ремонта после осмотра без нового решения",
        "Не добавлять: новая диагностика, замена или регулировка",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-no-replacement",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "Входная дверь закрывается с усилием.",
      desiredActions: "Не меняйте дверь, нужно только отрегулировать доводчик.",
    },
    mustPreserveFacts: ["запрет замены двери", "только регулировка доводчика"],
    mustNotInvent: ["замена доводчика или двери", "доводчик как доказанная причина неисправности"],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: запрет замены двери.",
      "Сохранить: только регулировка доводчика.",
      "Не добавлять: замена доводчика или двери.",
      "Не добавлять: доводчик как доказанная причина неисправности.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "запрет замены двери",
        "только регулировка доводчика",
        "Не добавлять: замена доводчика или двери",
        "Не добавлять: доводчик как доказанная причина неисправности",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-cleaning-working-door",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "Исправная входная дверь загрязнена.",
      desiredActions: "Уберите грязь, дверь исправна, ремонтировать её не надо.",
    },
    mustPreserveFacts: ["уборка загрязнения", "дверь исправна", "ремонт двери не требуется"],
    mustNotInvent: ["технический дефект двери", "ремонт, замена или регулировка двери"],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: уборка загрязнения.",
      "Сохранить: дверь исправна.",
      "Сохранить: ремонт двери не требуется.",
      "Не добавлять: технический дефект двери.",
      "Не добавлять: ремонт, замена или регулировка двери.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "уборка загрязнения",
        "дверь исправна",
        "ремонт двери не требуется",
        "Не добавлять: технический дефект двери",
        "Не добавлять: ремонт, замена или регулировка двери",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-generic",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "С потолка общего коридора капает вода.",
      desiredActions: "Сделайте уже хоть что-нибудь.",
    },
    mustPreserveFacts: ["общая просьба принять меры без выбранного способа"],
    mustNotInvent: [
      "проверка крыши, осмотр или диагностика как новое действие",
      "конкретный узел, причина или способ ремонта",
    ],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: общая просьба принять меры без выбранного способа.",
      "Не добавлять: проверка крыши, осмотр или диагностика как новое действие.",
      "Не добавлять: конкретный узел, причина или способ ремонта.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "общая просьба принять меры без выбранного способа",
        "Не добавлять: проверка крыши, осмотр или диагностика как новое действие",
        "Не добавлять: конкретный узел, причина или способ ремонта",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-diagnosis-only",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "Лифт не работает.",
      desiredActions: "Проверьте, почему не работает лифт.",
    },
    mustPreserveFacts: ["выяснение причины неработающего лифта"],
    mustNotInvent: ["ремонт или замена лифта и его узлов", "установленная техническая причина"],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: выяснение причины неработающего лифта.",
      "Не добавлять: ремонт или замена лифта и его узлов.",
      "Не добавлять: установленная техническая причина.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "выяснение причины неработающего лифта",
        "Не добавлять: ремонт или замена лифта и его узлов",
        "Не добавлять: установленная техническая причина",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-explicit-component",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "Лифт не работает.",
      desiredActions: "Почините мотор лифта.",
    },
    mustPreserveFacts: ["ремонт именно мотора лифта как требование пользователя"],
    mustNotInvent: [
      "мотор как доказанная причина неисправности в problem, impact или subject",
      "замена, перемотка, марка мотора или выбранный исполнитель",
    ],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: ремонт именно мотора лифта как требование пользователя.",
      "Не добавлять: мотор как доказанная причина неисправности в problem, impact или subject.",
      "Не добавлять: замена, перемотка, марка мотора или выбранный исполнитель.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "ремонт именно мотора лифта как требование пользователя",
        "Не добавлять: мотор как доказанная причина неисправности в problem, impact или subject",
        "Не добавлять: замена, перемотка, марка мотора или выбранный исполнитель",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-compound-constraints",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "Входная дверь закрывается с усилием.",
      desiredActions:
        "Сначала только осмотрите дверь, пока ничего не меняйте. Если доводчик действительно нуждается в регулировке, после осмотра при необходимости отрегулируйте только его, без замены двери. Возможно, этого будет достаточно; проверку результата сейчас не прошу.",
    },
    mustPreserveFacts: [
      "сначала только осмотр двери",
      "пока ничего не менять",
      "регулировка только доводчика после осмотра, если она действительно нужна и при необходимости",
      "запрет замены двери",
      "предположительность достаточности регулировки",
      "отсутствие просьбы о проверке результата сейчас",
    ],
    mustNotInvent: [
      "безусловная регулировка",
      "ремонт или замена других узлов",
      "обязательная проверка результата",
      "утверждение, что регулировка гарантированно решит проблему",
    ],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: сначала только осмотр двери.",
      "Сохранить: пока ничего не менять.",
      "Сохранить: регулировка только доводчика после осмотра, если она действительно нужна и при необходимости.",
      "Сохранить: запрет замены двери.",
      "Сохранить: предположительность достаточности регулировки.",
      "Сохранить: отсутствие просьбы о проверке результата сейчас.",
      "Не добавлять: безусловная регулировка.",
      "Не добавлять: ремонт или замена других узлов.",
      "Не добавлять: обязательная проверка результата.",
      "Не добавлять: утверждение, что регулировка гарантированно решит проблему.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "сначала только осмотр двери",
        "пока ничего не менять",
        "регулировка только доводчика после осмотра, если она действительно нужна и при необходимости",
        "запрет замены двери",
        "предположительность достаточности регулировки",
        "отсутствие просьбы о проверке результата сейчас",
        "Не добавлять: безусловная регулировка",
        "Не добавлять: ремонт или замена других узлов",
        "Не добавлять: обязательная проверка результата",
        "Не добавлять: утверждение, что регулировка гарантированно решит проблему",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
  {
    id: "request-item-contradictory",
    category: "desired_actions",
    provenance: {
      issue: 267,
    },
    expectedOutcome: "generated",
    input: {
      description: "Входная дверь закрывается с усилием.",
      desiredActions: "Не ремонтируйте дверь. Отремонтируйте дверь сейчас.",
    },
    mustPreserveFacts: [
      "одновременно заданные запрет ремонта и просьба ремонта сейчас без самостоятельного разрешения противоречия",
    ],
    mustNotInvent: [
      "отбрасывание запрета или просьбы",
      "выдуманное условие, последовательность или приоритет требований",
      "multiple_issues только из-за противоречия требований об одной проблеме",
    ],
    hardExpectations: [],
    semanticExpectations: [
      "Сохранить: одновременно заданные запрет ремонта и просьба ремонта сейчас без самостоятельного разрешения противоречия.",
      "Не добавлять: отбрасывание запрета или просьбы.",
      "Не добавлять: выдуманное условие, последовательность или приоритет требований.",
      "Не добавлять: multiple_issues только из-за противоречия требований об одной проблеме.",
      "Оценивать целиком requestItem, problem, impact, subject, warnings и outcome, а также title, circumstances и итоговый body. Новая задача не разрешает регрессии соседних полей и legal gate.",
      "requestItem: null допустим как отказ от переформулировки с сохранением всего исходного desiredActions в одном пункте после минимальной нормализации представления. Это не свидетельство качества нормализации.",
      "При строке сохранить весь смысл desiredActions в единственном пункте, не брать новые действия из description, consequences, location или сгенерированных полей.",
      "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
    ],
    expectationClassification: {
      blockerProductInvariants: [
        "одновременно заданные запрет ремонта и просьба ремонта сейчас без самостоятельного разрешения противоречия",
        "Не добавлять: отбрасывание запрета или просьбы",
        "Не добавлять: выдуманное условие, последовательность или приоритет требований",
        "Не добавлять: multiple_issues только из-за противоречия требований об одной проблеме",
      ],
      qualityExpectations: [
        "Допустимы разные естественные официальные формулировки без изменения смысла. Литературный вариант не является единственным PASS.",
      ],
      acceptedBetaLimitations: [
        "Разрешён requestItem: null с fallback к целому исходному desiredActions. Составное требование не сегментируется в массив.",
      ],
    },
  },
];

export const scenarios: TestScenario[] = [
  ...scenarioDefinitions.map(toTestScenario),
  ...regressionScenarios,
  ...requestItemNormalizationScenarios,
];
