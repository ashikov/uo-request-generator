import type { PrimaryRequestDraft } from "../src";

export const detailedEntranceDoorDraft = {
  title: "Отсутствует ручка входной двери",
  problem: "У входной двери подъезда полностью отсутствует дверная ручка.",
  circumstances: "Из-за отсутствия ручки дверь оставляют открытой и фиксируют ограничителем.",
  impact:
    "Такой способ эксплуатации создаёт дополнительную нагрузку на доводчик и крепления двери.",
  verification:
    "Необходимо проверить состояние доводчика, ограничителя, креплений двери и других связанных элементов.",
  requests: [
    "Восстановить дверную ручку и обеспечить её надёжное крепление",
    "Проверить доводчик, ограничитель, крепления двери и другие связанные элементы",
    "Устранить повреждения, выявленные при проверке",
    "После ремонта проверить нормальное открывание и закрывание двери",
  ],
  warnings: [],
} satisfies PrimaryRequestDraft;

export const minimalEntranceDoorDraft = {
  title: "Отсутствует ручка входной двери",
  problem: "У входной двери подъезда отсутствует дверная ручка.",
  circumstances: null,
  impact: null,
  verification: null,
  requests: ["Восстановить дверную ручку"],
  warnings: [],
} satisfies PrimaryRequestDraft;

export const assumedCauseDraft = {
  title: "Не закрывается входная дверь",
  problem: "Входная дверь подъезда не закрывается полностью.",
  circumstances: null,
  impact: null,
  verification: "Предполагаемую неисправность доводчика необходимо проверить при осмотре двери.",
  requests: ["Проверить причину неисправности и восстановить нормальное закрывание двери"],
  warnings: [],
} satisfies PrimaryRequestDraft;
