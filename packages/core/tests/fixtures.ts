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
  | "simple_defect"
  | "location_preservation"
  | "conflicting_location"
  | "compatible_location"
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
      "плесень, короткое замыкание или разрушение конструкций",
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
    mustPreserveFacts: ["на входной двери отсутствует ручка", "восстановление дверной ручки"],
    mustNotInvent: [
      "причина отсутствия ручки",
      "неисправность доводчика",
      "дополнительная диагностика",
      "необоснованное практическое значение или риск",
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
    },
    mustPreserveFacts: ["дверь не закрывается полностью", "подъезд 3", "этаж 4"],
    mustNotInvent: ["конфликт места", "другой подъезд", "причина неисправности"],
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
