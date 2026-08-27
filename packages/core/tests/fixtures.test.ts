import { describe, expect, it } from "vitest";
import { generateRequestInputSchema } from "../src/index.js";
import { type ScenarioCategory, scenarios } from "./fixtures.js";

const REQUIRED_CATEGORIES: ScenarioCategory[] = [
  "only_required_description",
  "description_with_location",
  "known_consequences",
  "desired_actions",
  "all_fields",
  "emotional_description",
  "wording_normalization",
  "description_normalization",
  "minimum_sufficient_requests",
  "location_action_deduplication",
  "simple_defect",
  "location_preservation",
  "conflicting_location",
  "compatible_location",
  "impact_subject_preservation",
  "impact_normalization",
  "unconfirmed_remedy",
  "multiple_unrelated_issues",
];

describe("test scenario fixtures", () => {
  it("все id уникальны", () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("покрыты все обязательные категории", () => {
    const categories = new Set(scenarios.map((s) => s.category));

    for (const cat of REQUIRED_CATEGORIES) {
      expect(categories.has(cat)).toBe(true);
    }
  });

  it("каждый input проходит Zod-схему", () => {
    for (const scenario of scenarios) {
      const result = generateRequestInputSchema.safeParse(scenario.input);
      expect(result.success).toBe(true);
    }
  });

  it("каждый сценарий имеет поддерживаемый expectedOutcome", () => {
    for (const scenario of scenarios) {
      expect(["generated", "multiple_issues"]).toContain(scenario.expectedOutcome);
    }
  });

  it("generated-сценарии содержат hard и semantic expectations", () => {
    const generatedScenarios = scenarios.filter(
      (scenario) => scenario.expectedOutcome === "generated",
    );

    expect(generatedScenarios.length).toBeGreaterThan(0);
    for (const scenario of generatedScenarios) {
      expect(scenario.hardExpectations.length).toBeGreaterThan(0);
      expect(scenario.semanticExpectations.length).toBeGreaterThan(0);
    }
  });

  it("multiple_issues-сценарии не содержат инварианты готового текста", () => {
    const rejectedScenarios = scenarios.filter(
      (scenario) => scenario.expectedOutcome === "multiple_issues",
    );

    expect(rejectedScenarios.length).toBeGreaterThan(0);
    for (const scenario of rejectedScenarios) {
      expect("mustPreserveFacts" in scenario).toBe(false);
      expect("mustNotInvent" in scenario).toBe(false);
      expect("expectWarning" in scenario).toBe(false);
    }
  });

  it("multiple_unrelated_issues ожидает multiple_issues", () => {
    const multiIssues = scenarios.filter(
      (scenario) => scenario.category === "multiple_unrelated_issues",
    );

    expect(multiIssues.length).toBeGreaterThan(0);
    for (const scenario of multiIssues) {
      expect(scenario.expectedOutcome).toBe("multiple_issues");
    }
  });

  it("сохраняет generated для связанных сложных проблем", () => {
    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

    for (const scenarioId of [
      "consequences",
      "all-fields",
      "minimum-sufficient-requests",
      "unknown-remedy-functional-defect",
    ]) {
      expect(byId.get(scenarioId)?.expectedOutcome).toBe("generated");
    }
  });

  it("сохраняет synthetic regression cases из #200, #201, #202, #203, #218 и #231 с typed expectations", () => {
    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

    expect(byId.get("cleaning-elevator-cabin")).toMatchObject({
      provenance: { issue: 200 },
      hardExpectations: expect.arrayContaining([
        { kind: "subject_kind", expected: "common_area_premises_cleaning" },
        { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
        { kind: "selected_normative_module", expected: "common-area-cleaning" },
      ]),
    });
    expect(byId.get("cleaning-entrance-door")).toMatchObject({ provenance: { issue: 231 } });
    expect(byId.get("cleaning-common-area-wall")).toMatchObject({ provenance: { issue: 200 } });
    expect(byId.get("consequences")).toMatchObject({
      input: {
        confirmedProblemSubject: "common_area_entrance_door",
      },
      hardExpectations: expect.arrayContaining([
        { kind: "subject_kind", expected: "common_area_entrance_door" },
        { kind: "forbidden_subject_kind", forbidden: "common_area_premises_cleaning" },
        { kind: "selected_normative_module", expected: "common-area-entrance-door" },
      ]),
    });
    for (const scenarioId of [
      "cleaning-entrance-door-mistaken-door-confirmation",
      "cleaning-elevator-cabin-mistaken-elevator-confirmation",
    ]) {
      expect(byId.get(scenarioId)).toMatchObject({
        provenance:
          scenarioId === "cleaning-entrance-door-mistaken-door-confirmation"
            ? { issue: 231 }
            : { issue: 200 },
        hardExpectations: expect.arrayContaining([
          { kind: "subject_kind", expected: null },
          { kind: "forbidden_subject_kind", forbidden: "common_area_entrance_door" },
          { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
          { kind: "selected_normative_module", expected: null },
        ]),
      });
    }
    expect(byId.get("lighting-elevator-cabin")).toMatchObject({
      provenance: { issue: 201 },
      input: {
        description: "В кабине лифта не работает освещение.",
        location: "второй подъезд",
        consequences: "В кабине темно.",
        desiredActions: "Восстановить освещение.",
        confirmedProblemSubject: "common_area_premises_lighting",
      },
      hardExpectations: expect.arrayContaining([
        { kind: "subject_kind", expected: "common_area_premises_lighting" },
        { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
        { kind: "selected_normative_module", expected: "common-area-lighting" },
      ]),
    });
    expect(byId.get("elevator-position-indicator")).toMatchObject({
      category: "elevator",
      provenance: { issue: 218 },
      input: {
        description: "На первом этаже не работает индикатор положения лифта.",
        location: "второй подъезд",
        consequences: "Из-за этого не видно, на каком этаже находится лифт.",
        desiredActions: "Восстановить работу индикатора.",
        confirmedProblemSubject: "common_area_elevator",
      },
      hardExpectations: expect.arrayContaining([
        { kind: "subject_kind", expected: "common_area_elevator" },
        { kind: "selected_normative_module", expected: "common-area-elevator" },
      ]),
    });
    expect(byId.get("elevator-subject-false-positive-lighting")).toMatchObject({
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
      hardExpectations: expect.arrayContaining([
        { kind: "subject_kind", expected: null },
        { kind: "forbidden_subject_kind", forbidden: "common_area_elevator" },
        { kind: "selected_normative_module", expected: null },
      ]),
    });
    expect(byId.get("unknown-remedy-lighting")).toMatchObject({ provenance: { issue: 202 } });
    expect(byId.get("unknown-remedy-functional-defect")).toMatchObject({
      provenance: { issue: 202 },
    });
    expect(byId.get("confirmed-remedy-door-handle")).toMatchObject({
      provenance: { issue: 202 },
      hardExpectations: expect.arrayContaining([
        { kind: "procedural_plan", preliminaryCheck: "absent", remedyActions: "present" },
      ]),
    });
    expect(
      scenarios
        .filter((scenario) => scenario.provenance?.issue === 203)
        .map((scenario) => scenario.id),
    ).toEqual([
      "impact-subject-subjective",
      "impact-subject-objective",
      "impact-subject-explicit-group",
    ]);
  });

  it("сохраняет synthetic regression cases из #219 без хрупких текстовых hard checks", () => {
    const issue219Scenarios = scenarios.filter((scenario) => scenario.provenance?.issue === 219);
    const byId = new Map(issue219Scenarios.map((scenario) => [scenario.id, scenario]));
    const liftConsequence = byId.get("impact-natural-lift-consequence");
    const manualDoorOperation = byId.get("impact-natural-manual-door-operation");

    expect(issue219Scenarios.map((scenario) => scenario.id)).toEqual([
      "impact-natural-lift-consequence",
      "impact-natural-manual-door-operation",
    ]);
    expect(liftConsequence).toMatchObject({
      category: "impact_normalization",
      provenance: { issue: 219 },
      expectedOutcome: "generated",
      input: {
        description: "Лифт не работает.",
        location: "второй подъезд",
        consequences: "Приходится подниматься вручную.",
        desiredActions: "Нужно починить лифт.",
      },
      hardExpectations: [{ kind: "warning_presence", expected: false }],
    });
    expect(manualDoorOperation).toMatchObject({
      category: "impact_normalization",
      provenance: { issue: 219 },
      expectedOutcome: "generated",
      input: {
        description: "Автоматическая дверь в общем помещении не открывается автоматически.",
        location: "тамбур второго подъезда",
        consequences: "Дверь приходится открывать вручную.",
        desiredActions: "Нужно восстановить автоматическое открывание двери.",
      },
      hardExpectations: [{ kind: "warning_presence", expected: false }],
    });

    for (const scenario of issue219Scenarios) {
      expect(scenario.semanticExpectations).toHaveLength(5);
      expect(scenario.hardExpectations).toEqual([{ kind: "warning_presence", expected: false }]);
    }
  });

  it("различает неоднозначный и однозначный synthetic regression cases из #224", () => {
    const byId = new Map(
      scenarios
        .filter((scenario) => scenario.provenance?.issue === 224)
        .map((scenario) => [scenario.id, scenario]),
    );
    const ambiguous = byId.get("description-fact-preservation");
    const explicit = byId.get("description-explicit-referent-preservation");

    expect([...byId.keys()]).toEqual([
      "description-fact-preservation",
      "description-explicit-referent-preservation",
    ]);
    expect(ambiguous).toMatchObject({
      category: "description_normalization",
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
      hardExpectations: [{ kind: "procedural_plan", remedyActions: "present" }],
    });
    expect(ambiguous).not.toHaveProperty("expectWarning");
    expect(ambiguous?.semanticExpectations).toEqual([
      "Не утверждать, что слово «последний» относится именно к люку.",
      "Не утверждать без дополнительного evidence, что слово «последний» относится именно к этажу.",
      "Допускать безопасное опущение именно неоднозначной связи без признания этого потерей explicit fact.",
      "Сохранить однозначные сведения о протечке, пятом этаже, первом подъезде, затоплении всего подъезда и требовании устранить причину.",
      "Естественно нормализовать описание проблемы без обязательной эталонной формулировки.",
      "Не размножать механически исходную бытовую конструкцию по смысловым ролям заявки.",
      "Не добавлять техническую причину протечки, которой нет во входе.",
      "Не добавлять неподтверждённый повреждённый элемент.",
      "Не добавлять соединения, примыкания, коммуникации или другие связанные элементы без evidence.",
      "Не назначать конкретный способ ремонта без пользовательского evidence.",
      "Не расширять смысл явно переданного последствия о затоплении всего подъезда.",
      "Не расширять смысл желаемого устранения причины протечки.",
    ]);

    expect(explicit).toMatchObject({
      category: "description_normalization",
      provenance: { issue: 224 },
      expectedOutcome: "generated",
      input: {
        description: "Протекает люк на пятом, верхнем этаже.",
        location: "первый подъезд, пятый этаж",
        consequences: "Затопило весь подъезд.",
        desiredActions: "Нужно устранить причину протечки.",
      },
      mustPreserveFacts: [
        "пятый этаж является верхним",
        "протечка люка на пятом этаже",
        "первый подъезд",
        "затопление всего подъезда",
        "устранение причины протечки",
      ],
      hardExpectations: [{ kind: "warning_presence", expected: false }],
    });
    expect(explicit?.semanticExpectations).toContain(
      "Сохранить явно переданный факт, что указанный пятый этаж является верхним.",
    );
  });

  it("покрывает безопасное смысловое и процедурное обогащение", () => {
    expect(scenarios).toHaveLength(34);

    const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
    const lighting = byId.get("only-description");
    const door = byId.get("wording-normalization");
    const explicitRisk = byId.get("consequences");
    const procedural = byId.get("minimum-sufficient-requests");
    const simpleDefect = byId.get("simple-defect");
    const subjectiveImpact = byId.get("impact-subject-subjective");
    const objectiveImpact = byId.get("impact-subject-objective");
    const explicitGroupImpact = byId.get("impact-subject-explicit-group");
    const unconfirmedLightingRemedy = byId.get("unconfirmed-remedy-lighting");
    const unconfirmedDoorRemedy = byId.get("unconfirmed-remedy-door");
    const confirmedDoorHandleRemedy = byId.get("confirmed-remedy-door-handle");

    for (const scenario of [
      lighting,
      door,
      explicitRisk,
      procedural,
      simpleDefect,
      subjectiveImpact,
      objectiveImpact,
      explicitGroupImpact,
      unconfirmedLightingRemedy,
      unconfirmedDoorRemedy,
      confirmedDoorHandleRemedy,
    ]) {
      expect(scenario?.expectedOutcome).toBe("generated");
    }

    if (
      lighting?.expectedOutcome !== "generated" ||
      door?.expectedOutcome !== "generated" ||
      explicitRisk?.expectedOutcome !== "generated" ||
      procedural?.expectedOutcome !== "generated" ||
      simpleDefect?.expectedOutcome !== "generated" ||
      subjectiveImpact?.expectedOutcome !== "generated" ||
      objectiveImpact?.expectedOutcome !== "generated" ||
      explicitGroupImpact?.expectedOutcome !== "generated" ||
      unconfirmedLightingRemedy?.expectedOutcome !== "generated" ||
      unconfirmedDoorRemedy?.expectedOutcome !== "generated" ||
      confirmedDoorHandleRemedy?.expectedOutcome !== "generated"
    ) {
      throw new Error("Ожидались generated-сценарии смыслового обогащения");
    }

    expect(lighting.mustPreserveFacts).toContain(
      "отсутствие освещения затрудняет безопасное пользование лестничной площадкой",
    );
    expect(lighting.mustNotInvent).toEqual(
      expect.arrayContaining(["факт падения", "факт травмы", "угроза жизни"]),
    );

    expect(door.mustPreserveFacts).toEqual(
      expect.arrayContaining([
        "риск несанкционированного доступа",
        "установление необходимой для ремонта причины",
        "проверка нормального открывания и закрывания после работ",
      ]),
    );
    expect(door.mustNotInvent).toEqual(
      expect.arrayContaining(["неисправность доводчика", "уже произошедшая кража"]),
    );

    expect(explicitRisk.mustPreserveFacts).toContain("явно переданный риск утраты имущества");
    expect(explicitRisk.mustNotInvent).toContain("утверждение, что имущество уже утрачено");

    expect(procedural.mustPreserveFacts).toEqual(
      expect.arrayContaining([
        "установление источника поступления воды",
        "устранение причины протечки",
        "проверка прекращения поступления воды после работ",
      ]),
    );
    expect(procedural.mustNotInvent).toEqual(
      expect.arrayContaining(["крыша как источник протечки", "труба как источник протечки"]),
    );

    expect(simpleDefect.input).toEqual({
      description: "На входной двери отсутствует ручка.",
    });
    expect(simpleDefect.mustPreserveFacts).toContain("установка отсутствующей ручки");
    expect(simpleDefect.mustNotInvent).toEqual(
      expect.arrayContaining([
        "обязательная диагностика причины",
        "искусственная цепочка диагностика → ремонт → проверка",
        "необоснованное практическое значение или риск",
      ]),
    );

    expect(subjectiveImpact.mustNotInvent).toEqual(
      expect.arrayContaining(["страх пассажиров", "страх жильцов", "массовое чувство страха"]),
    );
    expect(objectiveImpact.mustPreserveFacts).toContain(
      "нейтральная профессиональная формулировка ограниченной видимости без новой группы людей",
    );
    expect(objectiveImpact.mustNotInvent).toEqual(
      expect.arrayContaining(["затруднение прохода жильцов", "массовое неудобство"]),
    );
    expect(explicitGroupImpact.mustPreserveFacts).toContain("пожилым жильцам трудно открыть дверь");
    expect(explicitGroupImpact.mustNotInvent).toEqual(
      expect.arrayContaining(["всем жителям трудно открыть дверь", "большому числу жильцов"]),
    );
    expect(unconfirmedLightingRemedy.mustPreserveFacts).toContain(
      "восстановление освещения в кабине лифта",
    );
    expect(unconfirmedLightingRemedy.mustNotInvent).toEqual(
      expect.arrayContaining(["замена лампы", "замена проводки", "замена выключателя"]),
    );
    expect(unconfirmedDoorRemedy.mustPreserveFacts).toContain(
      "восстановление нормального открывания двери",
    );
    expect(unconfirmedDoorRemedy.mustNotInvent).toEqual(
      expect.arrayContaining(["регулировка петель", "замена доводчика", "ремонт замка"]),
    );
    expect(confirmedDoorHandleRemedy.mustPreserveFacts).toContain(
      "установка ручки на входную дверь",
    );
    expect(confirmedDoorHandleRemedy.mustNotInvent).toContain("обязательная диагностика двери");
  });

  it("фиксирует смысловой контракт места без механического повтора в действиях", () => {
    const scenario = scenarios.find(({ id }) => id === "location-action-deduplication");

    expect(scenario?.input.description).toBe(
      "С потолка в общем коридоре капает вода. Источник протечки неизвестен.",
    );
    expect(scenario?.input.location).toBe("подъезд 2, этаж 5");
    expect(scenario?.input.confirmedProblemSubject).toBeUndefined();
    expect(scenario?.expectedOutcome).toBe("generated");

    if (scenario?.expectedOutcome !== "generated") {
      throw new Error("Ожидался generated-сценарий устранения повтора места");
    }

    expect(scenario.expectWarning).toBe(false);
    expect(scenario.mustPreserveFacts).toEqual(
      expect.arrayContaining([
        "с потолка в общем коридоре капает вода",
        "источник протечки неизвестен",
        "место проблемы: подъезд 2, этаж 5",
        "минимальный и понятный план действий по устранению протечки",
        "место не повторяется механически в каждом пункте раздела «Прошу:»",
        "одно необходимое упоминание места допустимо, если оно различает действие или объект",
      ]),
    );
    expect(scenario.mustNotInvent).toEqual(
      expect.arrayContaining([
        "крыша как источник протечки",
        "труба как источник протечки",
        "квартира как источник протечки",
        "другой конкретный источник протечки",
      ]),
    );
  });
});

const FIELD_MAP: Record<ScenarioCategory, { present: string[]; absent: string[] }> = {
  only_required_description: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  description_with_location: {
    present: ["description", "location"],
    absent: ["consequences", "desiredActions", "confirmedProblemSubject"],
  },
  known_consequences: {
    present: ["description", "consequences", "confirmedProblemSubject"],
    absent: ["location", "desiredActions"],
  },
  desired_actions: {
    present: ["description", "desiredActions"],
    absent: ["location", "consequences", "confirmedProblemSubject"],
  },
  all_fields: {
    present: ["description", "location", "consequences", "desiredActions"],
    absent: ["confirmedProblemSubject"],
  },
  emotional_description: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  wording_normalization: {
    present: ["description", "confirmedProblemSubject"],
    absent: ["location", "consequences", "desiredActions"],
  },
  description_normalization: {
    present: ["description", "location", "consequences", "desiredActions"],
    absent: ["confirmedProblemSubject"],
  },
  minimum_sufficient_requests: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  location_action_deduplication: {
    present: ["description", "location"],
    absent: ["consequences", "desiredActions", "confirmedProblemSubject"],
  },
  simple_defect: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  location_preservation: {
    present: ["description", "location", "confirmedProblemSubject"],
    absent: ["consequences", "desiredActions"],
  },
  conflicting_location: {
    present: ["description", "location", "confirmedProblemSubject"],
    absent: ["consequences", "desiredActions"],
  },
  compatible_location: {
    present: ["description", "location", "confirmedProblemSubject"],
    absent: ["consequences", "desiredActions"],
  },
  impact_subject_preservation: {
    present: ["description", "consequences"],
    absent: ["location", "desiredActions", "confirmedProblemSubject"],
  },
  impact_normalization: {
    present: ["description", "location", "consequences", "desiredActions"],
    absent: ["confirmedProblemSubject"],
  },
  unconfirmed_remedy: {
    present: ["description", "desiredActions"],
    absent: ["location", "consequences", "confirmedProblemSubject"],
  },
  multiple_unrelated_issues: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  cleaning: {
    present: ["description", "location", "desiredActions", "confirmedProblemSubject"],
    absent: ["consequences"],
  },
  lighting: {
    present: [
      "description",
      "location",
      "consequences",
      "desiredActions",
      "confirmedProblemSubject",
    ],
    absent: [],
  },
  elevator: {
    present: [
      "description",
      "location",
      "consequences",
      "desiredActions",
      "confirmedProblemSubject",
    ],
    absent: [],
  },
  unknown_remedy: {
    present: ["description"],
    absent: ["location", "consequences", "desiredActions", "confirmedProblemSubject"],
  },
  explicit_remedy: {
    present: ["description", "desiredActions"],
    absent: ["location", "consequences", "confirmedProblemSubject"],
  },
};

describe("scenario input field structure", () => {
  for (const scenario of scenarios) {
    it(`"${scenario.id}" (${scenario.category}) имеет корректный набор полей`, () => {
      const expected = FIELD_MAP[scenario.category];

      for (const field of expected.present) {
        expect(scenario.input[field as keyof typeof scenario.input]).toBeDefined();
      }

      for (const field of expected.absent) {
        expect(scenario.input[field as keyof typeof scenario.input]).toBeUndefined();
      }
    });
  }
});
