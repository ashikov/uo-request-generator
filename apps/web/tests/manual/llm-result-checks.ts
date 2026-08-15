import {
  COMMON_AREA_DOOR_LEGAL_BASIS_MODULE,
  type GenerateRequestResult,
  primaryRequestDraftLimits,
} from "@uo-request-generator/core";
import { COMMON_LEGAL_BASIS_BLOCK } from "@uo-request-generator/llm";

const MAX_REQUESTS = primaryRequestDraftLimits.actionPlan.itemsMax;
const DOOR_LEGAL_BASIS_PARAGRAPH = COMMON_AREA_DOOR_LEGAL_BASIS_MODULE.paragraphs[0];

export function findGeneratedResultError(result: GenerateRequestResult): string | undefined {
  if (result.title.trim().length === 0 || result.body.trim().length === 0) {
    return "результат не соответствует публичному контракту";
  }

  if (result.warnings.some((warning) => result.body.includes(warning))) {
    return "предупреждения смешаны с текстом заявки";
  }

  if (
    result.body.includes("http://") ||
    result.body.includes("https://") ||
    result.body.includes("Общие нормативные основания:")
  ) {
    return "нарушен формат нормативных оснований";
  }

  const legalBasisPosition = result.body.indexOf(COMMON_LEGAL_BASIS_BLOCK);
  const requestPosition = result.body.indexOf("Прошу:\n");
  const doorLegalBasisPosition = result.body.indexOf(DOOR_LEGAL_BASIS_PARAGRAPH);

  if (
    legalBasisPosition === -1 ||
    legalBasisPosition !== result.body.lastIndexOf(COMMON_LEGAL_BASIS_BLOCK)
  ) {
    return "нарушен формат нормативных оснований";
  }

  if (requestPosition === -1) {
    return "нарушен формат раздела «Прошу:»";
  }

  if (requestPosition < legalBasisPosition + COMMON_LEGAL_BASIS_BLOCK.length) {
    return "нарушен формат нормативных оснований";
  }

  if (
    doorLegalBasisPosition !== -1 &&
    (doorLegalBasisPosition !== result.body.lastIndexOf(DOOR_LEGAL_BASIS_PARAGRAPH) ||
      doorLegalBasisPosition < legalBasisPosition + COMMON_LEGAL_BASIS_BLOCK.length ||
      doorLegalBasisPosition > requestPosition)
  ) {
    return "нарушен формат нормативных оснований";
  }

  const beforeLegal = result.body.slice(0, legalBasisPosition);
  const afterLegal = result.body.slice(legalBasisPosition + COMMON_LEGAL_BASIS_BLOCK.length);
  const requestBlock = result.body.slice(requestPosition);
  const expectedAfterLegal =
    doorLegalBasisPosition === -1
      ? `\n\n${requestBlock}`
      : `\n\n${DOOR_LEGAL_BASIS_PARAGRAPH}\n\n${requestBlock}`;

  if (!beforeLegal.endsWith("\n\n") || afterLegal !== expectedAfterLegal) {
    return "нарушен формат нормативных оснований";
  }

  const introPart = beforeLegal.slice(0, -"\n\n".length);
  const introBlocks = introPart.split("\n\n");

  if (introBlocks.length === 0 || introBlocks.some((block) => block.trim().length === 0)) {
    return "нарушен формат раздела «Прошу:»";
  }

  const requestLines = requestBlock.split("\n").slice(1);

  if (requestLines.length < 1 || requestLines.length > MAX_REQUESTS) {
    return "нарушен формат раздела «Прошу:»";
  }

  for (const [index, request] of requestLines.entries()) {
    if (!request.startsWith(`${String(index + 1)}. `) || request.slice(3).trim().length === 0) {
      return "нарушен формат раздела «Прошу:»";
    }
  }

  return undefined;
}
