import type { PrimaryRequestDraft } from "../src";

export const detailedEntranceDoorDraft = {
  title: "Отсутствует ручка входной двери",
  problem: "У входной двери подъезда полностью отсутствует дверная ручка.",
  circumstances: "Из-за отсутствия ручки дверь оставляют открытой и фиксируют ограничителем.",
  impact:
    "Такой способ эксплуатации создаёт дополнительную нагрузку на доводчик и крепления двери.",
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck:
      "Проверить состояние доводчика, ограничителя, креплений двери и связанных элементов",
    remedyActions: ["Установить и закрепить ручку на входной двери"],
    resultCheck: "После работ проверить нормальное открывание и закрывание двери",
  },
  warnings: [],
} satisfies PrimaryRequestDraft;

export const minimalEntranceDoorDraft = {
  title: "Отсутствует ручка входной двери",
  problem: "У входной двери подъезда отсутствует дверная ручка.",
  circumstances: null,
  impact: null,
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck: null,
    remedyActions: ["Установить ручку на входную дверь"],
    resultCheck: null,
  },
  warnings: [],
} satisfies PrimaryRequestDraft;

export const assumedCauseDraft = {
  title: "Не закрывается входная дверь",
  problem: "Входная дверь подъезда не закрывается полностью.",
  circumstances: null,
  impact: null,
  verification: "Предполагаемая неисправность доводчика не установлена.",
  subject: null,
  actionPlan: {
    preliminaryCheck: null,
    remedyActions: ["Устранить неисправность двери и восстановить её полное закрывание"],
    resultCheck: "После работ проверить полное закрывание двери",
  },
  warnings: [],
} satisfies PrimaryRequestDraft;

export const leakingCeilingDraft = {
  title: "Протечка в общем коридоре",
  problem: "С потолка в общем коридоре капает вода. Источник поступления воды не установлен.",
  circumstances: null,
  impact: null,
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck: "Установить источник поступления воды",
    remedyActions: ["Устранить причину протечки"],
    resultCheck: "После работ проверить прекращение поступления воды",
  },
  warnings: [],
} satisfies PrimaryRequestDraft;

export const functionalDoorDraft = {
  title: "Дверь не закрывается полностью",
  problem: "Дверь в помещении общего пользования не закрывается полностью.",
  circumstances: null,
  impact: null,
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck: null,
    remedyActions: ["Устранить неисправность двери и восстановить её полное закрывание"],
    resultCheck: "После работ проверить полное закрывание двери",
  },
  warnings: [],
} satisfies PrimaryRequestDraft;

export const explicitPreliminaryCheckDraft = {
  title: "Не работает освещение в коридоре",
  problem: "В общем коридоре не работает освещение.",
  circumstances: null,
  impact: null,
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck: "Проверить наличие напряжения в светильнике",
    remedyActions: ["Восстановить освещение в общем коридоре"],
    resultCheck: null,
  },
  warnings: [],
} satisfies PrimaryRequestDraft;

export const explicitResultCheckDraft = {
  title: "Не закреплена крышка почтового ящика",
  problem: "Крышка почтового ящика не закреплена.",
  circumstances: null,
  impact: null,
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck: null,
    remedyActions: ["Закрепить крышку почтового ящика"],
    resultCheck: "После работ проверить надёжность крепления крышки",
  },
  warnings: [],
} satisfies PrimaryRequestDraft;

export const diagnosticActionSeparatedFromRemedyDraft = {
  title: "Не работает освещение на лестничной площадке",
  problem: "На лестничной площадке не работает освещение.",
  circumstances: null,
  impact: null,
  verification: null,
  subject: null,
  actionPlan: {
    preliminaryCheck: "Установить причину отсутствия освещения",
    remedyActions: ["Восстановить освещение на лестничной площадке"],
    resultCheck: null,
  },
  warnings: [],
} satisfies PrimaryRequestDraft;
