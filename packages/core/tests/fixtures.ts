import type { GenerateRequestInput } from "../src/index.js";

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
  | "conflicting_location"
  | "compatible_location"
  | "impact_subject_preservation"
  | "unconfirmed_remedy"
  | "multiple_unrelated_issues";

type TestScenarioBase = {
  id: string;
  category: ScenarioCategory;
  input: GenerateRequestInput;
};

export type TestScenario =
  | (TestScenarioBase & {
      expectedOutcome: "generated";
      mustPreserveFacts: string[];
      mustNotInvent: string[];
      expectWarning: boolean;
    })
  | (TestScenarioBase & {
      expectedOutcome: "multiple_issues";
    });

const commonDoorConfirm: Partial<GenerateRequestInput> = {
  confirmedProblemSubject: "common_area_entrance_door",
};

export const scenarios: TestScenario[] = [
  {
    id: "only-description",
    category: "only_required_description",
    expectedOutcome: "generated",
    input: {
      description: "На лестничной площадке не работает освещение.",
    },
    mustPreserveFacts: [
      "на лестничной площадке не работает освещение",
      "отсутствие освещения затрудняет безопасное пользование лестничной площадкой",
      "проверка и восстановление работы освещения",
    ],
    mustNotInvent: [
      "перегоревшая лампа",
      "неисправность проводки или автомата",
      "факт падения",
      "факт травмы",
      "угроза жизни",
    ],
    expectWarning: false,
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
    mustPreserveFacts: [
      "дверь в помещении общего пользования не закрывается полностью",
      "риск несанкционированного доступа",
      "установление необходимой для ремонта причины",
      "устранение выявленной неисправности",
      "проверка нормального открывания и закрывания после работ",
    ],
    mustNotInvent: [
      "неисправность доводчика",
      "неисправность замка или петель",
      "уже произошедшая кража",
      "срок выполнения работ",
    ],
    expectWarning: false,
  },
  {
    id: "minimum-sufficient-requests",
    category: "minimum_sufficient_requests",
    expectedOutcome: "generated",
    input: {
      description: "С потолка в общем коридоре капает вода. Источник протечки неизвестен.",
    },
    mustPreserveFacts: [
      "с потолка в общем коридоре капает вода",
      "источник протечки неизвестен",
      "установление источника поступления воды",
      "устранение причины протечки",
      "проверка прекращения поступления воды после работ",
    ],
    mustNotInvent: [
      "крыша как источник протечки",
      "труба как источник протечки",
      "квартира как источник протечки",
      "повреждение или ремонт потолка",
      "плесень, короткое замыкание или разрушение конструкций",
    ],
    expectWarning: false,
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
      "минимальный и понятный план действий по устранению протечки",
      "место не повторяется механически в каждом пункте раздела «Прошу:»",
      "одно необходимое упоминание места допустимо, если оно различает действие или объект",
    ],
    mustNotInvent: [
      "крыша как источник протечки",
      "труба как источник протечки",
      "квартира как источник протечки",
      "другой конкретный источник протечки",
    ],
    expectWarning: false,
  },
  {
    id: "simple-defect",
    category: "simple_defect",
    expectedOutcome: "generated",
    input: {
      description: "На входной двери отсутствует ручка.",
    },
    mustPreserveFacts: ["на входной двери отсутствует ручка", "установка отсутствующей ручки"],
    mustNotInvent: [
      "причина отсутствия ручки",
      "неисправность доводчика",
      "обязательная диагностика причины",
      "искусственная цепочка диагностика → ремонт → проверка",
      "необоснованное практическое значение или риск",
      "дополнительные формальные требования",
    ],
    expectWarning: false,
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
    id: "conflicting-location",
    category: "conflicting_location",
    expectedOutcome: "generated",
    input: {
      description:
        "Дверь в помещении общего пользования во втором подъезде не закрывается полностью.",
      location: "подъезд 3, этаж 4",
      ...commonDoorConfirm,
    },
    mustPreserveFacts: [
      "дверь не закрывается полностью",
      "подъезд 3",
      "этаж 4",
      "предупреждение о необходимости проверить место",
    ],
    mustNotInvent: ["объединение второго и третьего подъездов", "фактически верное место"],
    expectWarning: true,
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
    mustPreserveFacts: [
      "восстановление освещения в кабине лифта",
      "установление причины отсутствия освещения только при необходимости",
    ],
    mustNotInvent: [
      "замена лампы",
      "замена проводки",
      "замена выключателя",
      "закрытый перечень предполагаемых причин",
    ],
    expectWarning: false,
  },
  {
    id: "unconfirmed-remedy-door",
    category: "unconfirmed_remedy",
    expectedOutcome: "generated",
    input: {
      description: "Входная дверь открывается с большим усилием.",
      desiredActions: "Восстановить нормальное открывание двери.",
    },
    mustPreserveFacts: [
      "восстановление нормального открывания двери",
      "установление причины затруднённого открывания только при необходимости",
    ],
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
