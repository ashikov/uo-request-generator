import { z } from "zod";
import type { GenerateRequestInput } from "./contracts.js";

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

export const PRIMARY_REQUEST_SUBJECT_KINDS = ["common_area_entrance_door"] as const;
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
      kind: z.literal(PRIMARY_REQUEST_SUBJECT_KINDS[0]),
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
    subject: "common_area_entrance_door",
    requiresVerifiedInputEvidence: true,
    limitation:
      "Только входная дверь многоквартирного дома или дверь помещения общего пользования, обслуживающая более одного жилого и (или) нежилого помещения.",
  },
  paragraphs: [
    "Входная дверь многоквартирного дома или дверь помещения общего пользования, обслуживающая более одного жилого и (или) нежилого помещения, относится к общему имуществу. Её содержание должно включать проверку целостности, плотности притворов, механической прочности и работоспособности фурнитуры, а при выявлении нарушений — необходимые восстановительные работы.",
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
    {
      id: "ru-government-decree-290-minimum-work-list",
      title: "Постановление Правительства Российской Федерации от 03.04.2013 № 290",
      officialUrl: "https://government.ru/docs/all/86860/",
      provisions: ["пункт 13 Минимального перечня"],
      edition: "с изменениями от 07.03.2025 № 293",
      validThrough: "2029-09-01",
    },
  ],
  verifiedAt: "2026-08-15",
} as const satisfies LegalBasisModule;

const MAXIMUM_LEGAL_BASIS_BLOCK = [
  COMMON_LEGAL_BASIS_BLOCK,
  ...COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs,
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
    subject.kind !== COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.applicability.subject ||
    !inputEvidenceMatches(input, subject)
  ) {
    return [];
  }

  return COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs;
}
