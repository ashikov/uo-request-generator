import { z } from "zod";
import type { ConfirmedProblemSubject, GenerateRequestInput } from "./contracts.js";

const LEGAL_BASIS_PARAGRAPH_SEPARATOR = "\n\n";

export const COMMON_LEGAL_BASIS_BLOCK = [
  "В соответствии с частями 1 и 2.3 статьи 161 Жилищного кодекса РФ управление многоквартирным домом должно обеспечивать благоприятные и безопасные условия проживания граждан, а управляющая организация несёт ответственность за надлежащее содержание общего имущества.",
  "Подпункт «з» пункта 4 Правил осуществления деятельности по управлению многоквартирными домами, утверждённых постановлением Правительства РФ от 15.05.2013 № 416, предусматривает приём и рассмотрение заявок, предложений и обращений собственников и пользователей помещений.",
].join(LEGAL_BASIS_PARAGRAPH_SEPARATOR);

export const primaryRequestSubjectLimits = {
  evidence: {
    min: 1,
    max: 2,
  },
  quote: {
    min: 10,
    max: 300,
  },
} as const;

export const COMMON_AREA_DOOR_CONFIRMED_SUBJECT: ConfirmedProblemSubject =
  "common_area_entrance_door";
export const COMMON_AREA_LIGHTING_CONFIRMED_SUBJECT: ConfirmedProblemSubject =
  "common_area_premises_lighting";
export const COMMON_AREA_CLEANING_CONFIRMED_SUBJECT: ConfirmedProblemSubject =
  "common_area_premises_cleaning";
export const COMMON_AREA_ROOF_CONFIRMED_SUBJECT: ConfirmedProblemSubject = "common_area_roof";
export const COMMON_AREA_VENTILATION_CONFIRMED_SUBJECT: ConfirmedProblemSubject =
  "common_area_ventilation";
export const COMMON_AREA_ELEVATOR_CONFIRMED_SUBJECT: ConfirmedProblemSubject =
  "common_area_elevator";
export const PRIMARY_REQUEST_SUBJECT_KINDS = [
  COMMON_AREA_DOOR_CONFIRMED_SUBJECT,
  COMMON_AREA_LIGHTING_CONFIRMED_SUBJECT,
  COMMON_AREA_CLEANING_CONFIRMED_SUBJECT,
  COMMON_AREA_ROOF_CONFIRMED_SUBJECT,
  COMMON_AREA_VENTILATION_CONFIRMED_SUBJECT,
  COMMON_AREA_ELEVATOR_CONFIRMED_SUBJECT,
] as const;
export const PRIMARY_REQUEST_SUBJECT_EVIDENCE_SOURCE_FIELDS = [
  "description",
  "location",
  "consequences",
  "desiredActions",
] as const;

const evidenceQuoteSchema = z
  .string()
  .regex(/^[^\r\n]*$/u)
  .trim()
  .min(primaryRequestSubjectLimits.quote.min)
  .max(primaryRequestSubjectLimits.quote.max);

const primaryRequestSubjectEvidenceSchema = z
  .object({
    sourceField: z.enum(PRIMARY_REQUEST_SUBJECT_EVIDENCE_SOURCE_FIELDS),
    quote: evidenceQuoteSchema,
  })
  .strict();

export const primaryRequestSubjectSchema = z.union([
  z
    .object({
      kind: z.literal(COMMON_AREA_DOOR_CONFIRMED_SUBJECT),
      evidence: z
        .array(primaryRequestSubjectEvidenceSchema)
        .min(primaryRequestSubjectLimits.evidence.min)
        .max(primaryRequestSubjectLimits.evidence.max),
    })
    .strict(),
  z
    .object({
      kind: z.literal(COMMON_AREA_LIGHTING_CONFIRMED_SUBJECT),
      evidence: z
        .array(primaryRequestSubjectEvidenceSchema)
        .min(primaryRequestSubjectLimits.evidence.min)
        .max(primaryRequestSubjectLimits.evidence.max),
    })
    .strict(),
  z
    .object({
      kind: z.literal(COMMON_AREA_CLEANING_CONFIRMED_SUBJECT),
      evidence: z
        .array(primaryRequestSubjectEvidenceSchema)
        .min(primaryRequestSubjectLimits.evidence.min)
        .max(primaryRequestSubjectLimits.evidence.max),
    })
    .strict(),
  z
    .object({
      kind: z.literal(COMMON_AREA_ROOF_CONFIRMED_SUBJECT),
      evidence: z
        .array(primaryRequestSubjectEvidenceSchema)
        .min(primaryRequestSubjectLimits.evidence.min)
        .max(primaryRequestSubjectLimits.evidence.max),
    })
    .strict(),
  z
    .object({
      kind: z.literal(COMMON_AREA_VENTILATION_CONFIRMED_SUBJECT),
      evidence: z
        .array(primaryRequestSubjectEvidenceSchema)
        .min(primaryRequestSubjectLimits.evidence.min)
        .max(primaryRequestSubjectLimits.evidence.max),
    })
    .strict(),
  z
    .object({
      kind: z.literal(COMMON_AREA_ELEVATOR_CONFIRMED_SUBJECT),
      evidence: z
        .array(primaryRequestSubjectEvidenceSchema)
        .min(primaryRequestSubjectLimits.evidence.min)
        .max(primaryRequestSubjectLimits.evidence.max),
    })
    .strict(),
  z.null(),
]);

export type PrimaryRequestSubject = z.infer<typeof primaryRequestSubjectSchema>;

type LegalSource = {
  id: string;
  title: string;
  officialUrl: `https://${string}`;
  provisions: readonly string[];
  edition: string;
  validThrough: `${number}-${number}-${number}` | null;
};

type LegalBasisModule = {
  id: string;
  applicability: {
    subject: Exclude<PrimaryRequestSubject, null>["kind"];
    requiresExplicitUserConfirmation: true;
    requiresVerifiedInputEvidence: true;
    limitation: string;
  };
  paragraphs: readonly [string, ...string[]];
  sources: readonly [LegalSource, ...LegalSource[]];
  verifiedAt: `${number}-${number}-${number}`;
};

export const COMMON_AREA_DOOR_LEGAL_BASIS_MODULE = {
  id: "common-area-door",
  applicability: {
    subject: COMMON_AREA_DOOR_CONFIRMED_SUBJECT,
    requiresExplicitUserConfirmation: true,
    requiresVerifiedInputEvidence: true,
    limitation:
      "Только входная дверь многоквартирного дома или дверь помещения общего пользования, обслуживающая более одного жилого и (или) нежилого помещения.",
  },
  paragraphs: [
    "Входная дверь многоквартирного дома и дверь помещения общего пользования, обслуживающие более одного помещения, относятся к общему имуществу. По постановлению Правительства РФ от 13.08.2006 № 491 общее имущество должно содержаться в состоянии, обеспечивающем надёжность и безопасность дома и доступность пользования помещениями общего пользования.",
  ],
  sources: [
    {
      id: "ru-government-decree-491-common-property-rules",
      title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
      officialUrl: "https://government.ru/docs/all/57158/",
      provisions: ["подпункт «г» пункта 2", "пункт 10"],
      edition: "с изменениями от 07.03.2025 № 293",
      validThrough: "2027-12-31",
    },
  ],
  verifiedAt: "2026-08-15",
} as const satisfies LegalBasisModule;

export const COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE = {
  id: "common-area-lighting",
  applicability: {
    subject: COMMON_AREA_LIGHTING_CONFIRMED_SUBJECT,
    requiresExplicitUserConfirmation: true,
    requiresVerifiedInputEvidence: true,
    limitation:
      "Только осветительные установки внутри помещений общего пользования многоквартирного дома, включая освещение в кабине лифта. Не применяется к освещению внутри квартиры, придомовой территории, улицы или фасада. Не подтверждает неисправность лифта или конкретную техническую причину отсутствия света.",
  },
  paragraphs: [
    "Согласно подпункту «а» пункта 2 и пунктам 7 и 11 Правил содержания общего имущества в многоквартирном доме, утверждённых постановлением Правительства РФ от 13.08.2006 № 491, к помещениям общего пользования отнесены в том числе лифты, осветительные установки таких помещений входят в состав внутридомовой системы электроснабжения, а содержание общего имущества включает обеспечение готовности такого электрооборудования.",
  ],
  sources: [
    {
      id: "ru-government-decree-491-common-property-rules",
      title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
      officialUrl: "https://government.ru/docs/all/57158/",
      provisions: ["подпункт «а» пункта 2", "пункт 7", "подпункт «б» пункта 11"],
      edition: "с изменениями от 07.03.2025 № 293",
      validThrough: "2027-12-31",
    },
  ],
  verifiedAt: "2026-08-23",
} as const satisfies LegalBasisModule;

export const COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE = {
  id: "common-area-cleaning",
  applicability: {
    subject: COMMON_AREA_CLEANING_CONFIRMED_SUBJECT,
    requiresExplicitUserConfirmation: true,
    requiresVerifiedInputEvidence: true,
    limitation:
      "Только уборка помещений общего пользования многоквартирного дома. Для отдельных объектов охватывает только уборку кабины лифта, протирку дверных коробок, полотен, доводчиков и ручек входной двери общего пользования и уборку стены в подъезде или на лестничной клетке. Постановление № 290 не применяется в случаях, урегулированных постановлением № 360; модуль не определяет территориальный режим. Правила № 170 не устанавливают немедленный срок удаления каждого загрязнения, а пункт 3.2.7 прямо упоминает обметание стен только при использовании централизованных вакуумных систем. Не применяется к другим поверхностям и элементам только по факту их расположения в общем помещении, к уборке внутри квартиры, придомовой территории, контейнерной площадки или вывозу твёрдых коммунальных отходов.",
  },
  paragraphs: [
    "Подпункт «г» пункта 11 Правил, утверждённых постановлением Правительства РФ от 13.08.2006 № 491, относит уборку и санитарно-гигиеническую очистку помещений общего пользования к содержанию общего имущества. Пункт 23 Минимального перечня, утверждённого постановлением Правительства РФ от 03.04.2013 № 290, кроме случаев применения особенностей постановления № 360, прямо перечисляет уборку лифтовых кабин и влажную протирку дверных коробок, полотен, доводчиков и ручек, а пункт 3.2.2 Правил, утверждённых постановлением Госстроя РФ от 27.09.2003 № 170, требует санитарного состояния лестничных клеток; пункт 3.2.7 называет обметание стен только при использовании централизованных вакуумных систем.",
  ],
  sources: [
    {
      id: "ru-government-decree-491-common-property-rules",
      title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
      officialUrl: "https://government.ru/docs/all/57158/",
      provisions: [
        "подпункт «а» пункта 2",
        "подпункт «в» пункта 2",
        "подпункт «г» пункта 2",
        "подпункт «г» пункта 11",
      ],
      edition: "с изменениями от 07.03.2025 № 293",
      validThrough: "2027-12-31",
    },
    {
      id: "ru-government-decree-290-minimum-works",
      title: "Постановление Правительства Российской Федерации от 03.04.2013 № 290",
      officialUrl: "https://government.ru/docs/all/86860/",
      provisions: ["пункт 23"],
      edition: "с изменениями от 07.03.2025 № 293",
      validThrough: "2029-09-01",
    },
    {
      id: "ru-gosstroy-decree-170-housing-operation-rules",
      title: "Постановление Госстроя Российской Федерации от 27.09.2003 № 170",
      officialUrl: "https://mintrud.gov.ru/docs/government/postan/111",
      provisions: ["пункт 3.2.2", "пункт 3.2.7"],
      edition: "с учётом решения Верховного Суда РФ от 22.06.2022 № АКПИ22-375",
      validThrough: null,
    },
    {
      id: "ru-government-decree-360-new-territories-housing-rules",
      title: "Постановление Правительства Российской Федерации от 07.03.2023 № 360",
      officialUrl: "https://publication.pravo.gov.ru/document/0001202303100025",
      provisions: ["пункт 1", "подпункт «в» пункта 2"],
      edition: "с изменениями от 15.02.2025 № 167",
      validThrough: "2028-01-01",
    },
  ],
  verifiedAt: "2026-08-24",
} as const satisfies LegalBasisModule;

export const COMMON_AREA_ROOF_LEGAL_BASIS_MODULE = {
  id: "common-area-roof",
  applicability: {
    subject: COMMON_AREA_ROOF_CONFIRMED_SUBJECT,
    requiresExplicitUserConfirmation: true,
    requiresVerifiedInputEvidence: true,
    limitation:
      "Только явно подтверждённая проблема крыши или кровли многоквартирного дома. Протечка, мокрый потолок, пятно или сырость без установленного пользователем источника воды не подтверждают применимость модуля.",
  },
  paragraphs: [
    "Крыша многоквартирного дома относится к общему имуществу. По постановлению Правительства РФ от 13.08.2006 № 491 общее имущество должно содержаться в состоянии, обеспечивающем соблюдение характеристик надёжности и безопасности многоквартирного дома и безопасность для жизни и здоровья граждан.",
  ],
  sources: [
    {
      id: "ru-government-decree-491-common-property-rules",
      title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
      officialUrl: "https://government.ru/docs/all/57158/",
      provisions: ["подпункт «б» пункта 2", "подпункты «а» и «б» пункта 10"],
      edition: "с изменениями от 07.03.2025 № 293",
      validThrough: "2027-12-31",
    },
  ],
  verifiedAt: "2026-08-17",
} as const satisfies LegalBasisModule;

export const COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE = {
  id: "common-area-ventilation",
  applicability: {
    subject: COMMON_AREA_VENTILATION_CONFIRMED_SUBJECT,
    requiresExplicitUserConfirmation: true,
    requiresVerifiedInputEvidence: true,
    limitation:
      "Только система вентиляции или её элементы, входящие в состав общего имущества многоквартирного дома и обслуживающие более одного помещения. Не применяется к вентиляции внутри одной квартиры, дымовым каналам, газовому оборудованию и симптомам без прямо подтверждённой связи с вентиляцией.",
  },
  paragraphs: [
    "Оборудование системы вентиляции, находящееся в многоквартирном доме и обслуживающее более одного помещения, относится к общему имуществу. По постановлению Правительства РФ от 13.08.2006 № 491 такое общее имущество должно содержаться в состоянии, обеспечивающем соблюдение характеристик надёжности и безопасности дома, а его содержание включает осмотр для своевременного выявления несоответствий установленным требованиям.",
  ],
  sources: [
    {
      id: "ru-government-decree-491-common-property-rules",
      title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
      officialUrl: "https://government.ru/docs/all/57158/",
      provisions: ["подпункт «д» пункта 2", "подпункт «а» пункта 10", "подпункт «а» пункта 11"],
      edition: "с изменениями от 07.03.2025 № 293",
      validThrough: "2027-12-31",
    },
  ],
  verifiedAt: "2026-08-17",
} as const satisfies LegalBasisModule;

export const COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE = {
  id: "common-area-elevator",
  applicability: {
    subject: COMMON_AREA_ELEVATOR_CONFIRMED_SUBJECT,
    requiresExplicitUserConfirmation: true,
    requiresVerifiedInputEvidence: true,
    limitation:
      "Только явно подтверждённая пользователем проблема лифта, лифтовой шахты или лифтового оборудования, относящегося к общему имуществу МКД. Не устанавливает техническую причину, неисправность, аварийность, необходимость работ или их исполнителя.",
  },
  paragraphs: [
    "Лифты и лифтовые шахты входят в состав общего имущества многоквартирного дома. Такое имущество должно содержаться в состоянии, обеспечивающем надёжность и безопасность дома и безопасность для жизни и здоровья граждан.",
  ],
  sources: [
    {
      id: "ru-government-decree-491-common-property-rules",
      title: "Постановление Правительства Российской Федерации от 13.08.2006 № 491",
      officialUrl: "https://government.ru/docs/all/57158/",
      provisions: ["подпункт «а» пункта 2", "подпункты «а» и «б» пункта 10"],
      edition: "с изменениями от 07.03.2025 № 293",
      validThrough: "2027-12-31",
    },
  ],
  verifiedAt: "2026-08-17",
} as const satisfies LegalBasisModule;

const MAXIMUM_SPECIFIC_LEGAL_BASIS_PARAGRAPHS = [
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE,
  COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE,
  COMMON_AREA_ROOF_LEGAL_BASIS_MODULE,
  COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE,
  COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE,
].reduce<readonly string[]>((maximumParagraphs, module) => {
  const maximumLength = maximumParagraphs.join(LEGAL_BASIS_PARAGRAPH_SEPARATOR).length;
  const moduleLength = module.paragraphs.join(LEGAL_BASIS_PARAGRAPH_SEPARATOR).length;

  return moduleLength > maximumLength ? module.paragraphs : maximumParagraphs;
}, []);

const MAXIMUM_LEGAL_BASIS_BLOCK = [
  COMMON_LEGAL_BASIS_BLOCK,
  ...MAXIMUM_SPECIFIC_LEGAL_BASIS_PARAGRAPHS,
].join(LEGAL_BASIS_PARAGRAPH_SEPARATOR);

export const primaryRequestLegalBasisLimits = {
  maximumBlockLength: MAXIMUM_LEGAL_BASIS_BLOCK.length,
} as const;

function inputEvidenceMatches(
  input: GenerateRequestInput,
  subject: Exclude<PrimaryRequestSubject, null>,
): boolean {
  return subject.evidence.every(({ sourceField, quote }) => {
    const sourceText = input[sourceField]?.trim();

    return sourceText?.includes(quote) ?? false;
  });
}

export const SPECIFIC_LEGAL_BASIS_SELECTION_STATUSES = [
  "applied",
  "input_unavailable",
  "confirmation_absent",
  "subject_absent",
  "subject_kind_mismatch",
  "evidence_unverifiable",
] as const;

export type SpecificLegalBasisSelectionStatus =
  (typeof SPECIFIC_LEGAL_BASIS_SELECTION_STATUSES)[number];

export type SpecificLegalBasisSelection =
  | { status: "applied"; module: LegalBasisModule }
  | { status: Exclude<SpecificLegalBasisSelectionStatus, "applied"> };

export function evaluateSpecificLegalBasisSelection(
  subject: PrimaryRequestSubject,
  input: GenerateRequestInput | undefined,
): SpecificLegalBasisSelection {
  if (input === undefined) {
    return { status: "input_unavailable" };
  }
  if (input.confirmedProblemSubject === undefined) {
    return { status: "confirmation_absent" };
  }
  if (subject === null) {
    return { status: "subject_absent" };
  }
  if (input.confirmedProblemSubject !== subject.kind) {
    return { status: "subject_kind_mismatch" };
  }
  if (!inputEvidenceMatches(input, subject)) {
    return { status: "evidence_unverifiable" };
  }

  switch (subject.kind) {
    case COMMON_AREA_DOOR_CONFIRMED_SUBJECT:
      return { status: "applied", module: COMMON_AREA_DOOR_LEGAL_BASIS_MODULE };
    case COMMON_AREA_LIGHTING_CONFIRMED_SUBJECT:
      return { status: "applied", module: COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE };
    case COMMON_AREA_CLEANING_CONFIRMED_SUBJECT:
      return { status: "applied", module: COMMON_AREA_CLEANING_LEGAL_BASIS_MODULE };
    case COMMON_AREA_ROOF_CONFIRMED_SUBJECT:
      return { status: "applied", module: COMMON_AREA_ROOF_LEGAL_BASIS_MODULE };
    case COMMON_AREA_VENTILATION_CONFIRMED_SUBJECT:
      return { status: "applied", module: COMMON_AREA_VENTILATION_LEGAL_BASIS_MODULE };
    case COMMON_AREA_ELEVATOR_CONFIRMED_SUBJECT:
      return { status: "applied", module: COMMON_AREA_ELEVATOR_LEGAL_BASIS_MODULE };
  }

  throw new Error("Неподдерживаемый предмет проблемы");
}

export function selectSpecificLegalBasisModule(
  subject: PrimaryRequestSubject,
  input: GenerateRequestInput | undefined,
): LegalBasisModule | undefined {
  const selection = evaluateSpecificLegalBasisSelection(subject, input);

  return selection.status === "applied" ? selection.module : undefined;
}

export function selectSpecificLegalBasisParagraphs(
  subject: PrimaryRequestSubject,
  input: GenerateRequestInput | undefined,
): readonly string[] {
  return selectSpecificLegalBasisModule(subject, input)?.paragraphs ?? [];
}
