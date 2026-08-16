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
export const PRIMARY_REQUEST_SUBJECT_KINDS = [
  COMMON_AREA_DOOR_CONFIRMED_SUBJECT,
  COMMON_AREA_LIGHTING_CONFIRMED_SUBJECT,
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
  z.null(),
]);

export type PrimaryRequestSubject = z.infer<typeof primaryRequestSubjectSchema>;

type LegalSource = {
  id: string;
  title: string;
  officialUrl: `https://${string}`;
  provisions: readonly string[];
  edition: string;
  validThrough: `${number}-${number}-${number}`;
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
      "Только осветительные установки внутри помещений общего пользования многоквартирного дома. Не применяется к освещению внутри квартиры, придомовой территории, улицы или фасада.",
  },
  paragraphs: [
    "Согласно пунктам 7 и 11 Правил содержания общего имущества в многоквартирном доме, утверждённых постановлением Правительства РФ от 13.08.2006 № 491, осветительные установки помещений общего пользования входят в состав внутридомовой системы электроснабжения, а содержание общего имущества включает обеспечение готовности такого электрооборудования.",
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
  verifiedAt: "2026-08-16",
} as const satisfies LegalBasisModule;

const MAXIMUM_SPECIFIC_LEGAL_BASIS_PARAGRAPHS =
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs.join(LEGAL_BASIS_PARAGRAPH_SEPARATOR).length >=
  COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs.join(LEGAL_BASIS_PARAGRAPH_SEPARATOR).length
    ? COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs
    : COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs;

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

export function selectSpecificLegalBasisParagraphs(
  subject: PrimaryRequestSubject,
  input: GenerateRequestInput | undefined,
): readonly string[] {
  if (
    input === undefined ||
    subject === null ||
    input.confirmedProblemSubject !== subject.kind ||
    !inputEvidenceMatches(input, subject)
  ) {
    return [];
  }

  switch (subject.kind) {
    case COMMON_AREA_DOOR_CONFIRMED_SUBJECT:
      return COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs;
    case COMMON_AREA_LIGHTING_CONFIRMED_SUBJECT:
      return COMMON_AREA_LIGHTING_LEGAL_BASIS_MODULE.paragraphs;
  }

  return [];
}
