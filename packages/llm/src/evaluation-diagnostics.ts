import type { RequestDraft } from "@uo-request-generator/core";
import { providerRequestDraftResponseSchema } from "./provider-request-draft-schema.js";
import { validateProviderRequestDraft } from "./request-draft.js";

export const EVALUATION_DIAGNOSTIC_STAGES = [
  "network",
  "http",
  "provider_envelope",
  "provider_status",
  "output_extraction",
  "json_parse",
  "provider_wire_validation",
  "canonical_validation",
  "materialization",
  "subject_legal_selection",
  "renderer",
  "hard_expectations",
] as const;

export type EvaluationDiagnosticStage = (typeof EVALUATION_DIAGNOSTIC_STAGES)[number];

export type EvaluationDiagnosticUsage =
  | { status: "available"; inputTokens: number; outputTokens: number; totalTokens: number }
  | { status: "missing" | "invalid" };

export type SafeJsonType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "unknown";
export type KnownProviderOutcome = "generated" | "multiple_issues";
export type ProviderErrorCode =
  | "server_error"
  | "rate_limit_exceeded"
  | "invalid_prompt"
  | "vector_store_timeout"
  | "invalid_image"
  | "invalid_image_format"
  | "invalid_base64_image"
  | "invalid_image_url"
  | "image_too_large"
  | "image_too_small"
  | "image_parse_error"
  | "image_content_policy_violation"
  | "invalid_image_mode"
  | "image_file_too_large"
  | "unsupported_image_media_type"
  | "empty_image_file"
  | "failed_to_download_image"
  | "image_file_not_found";
export type ProviderErrorCodeDiagnostic =
  | {
      readonly providerErrorCodeStatus: "known";
      readonly providerErrorCode: ProviderErrorCode;
    }
  | {
      readonly providerErrorCodeStatus: "unknown" | "missing";
      readonly providerErrorCode?: never;
    };
export type ProviderErrorCodeStatus = ProviderErrorCodeDiagnostic["providerErrorCodeStatus"];

const KNOWN_DRAFT_FIELDS = [
  "outcome",
  "title",
  "problem",
  "circumstances",
  "impact",
  "subject",
  "warnings",
] as const;

export type KnownProviderDraftField = (typeof KNOWN_DRAFT_FIELDS)[number];

export type ProviderStructuralProbe = {
  rootType: SafeJsonType;
  draftPresence: "present" | "missing";
  draftType?: SafeJsonType;
  knownKeysPresent: readonly KnownProviderDraftField[];
  unknownKeyCount: number;
  outcome?: KnownProviderOutcome;
};

const SAFE_ISSUE_CODES = [
  "custom",
  "invalid_element",
  "invalid_format",
  "invalid_key",
  "invalid_type",
  "invalid_union",
  "invalid_value",
  "not_multiple_of",
  "too_big",
  "too_small",
  "unrecognized_keys",
] as const;

export type SafeValidationIssueCode = (typeof SAFE_ISSUE_CODES)[number] | "unknown";

export type SafeValidationIssue = {
  code: SafeValidationIssueCode;
  path: string;
  expected?: "array" | "boolean" | "null" | "number" | "object" | "string";
};

type BasicStageResult<Stage extends EvaluationDiagnosticStage> = {
  stage: Stage;
  status: "pass" | "fail";
};

export type EvaluationDiagnosticStageResult =
  | (BasicStageResult<"network"> & { reason?: "network_error" | "timeout" })
  | (BasicStageResult<"http"> & { httpStatus?: number })
  | (BasicStageResult<"provider_envelope"> & {
      protocol?: "chat-completions" | "responses";
    })
  | (BasicStageResult<"provider_status"> & {
      responsesStatus?:
        | "completed"
        | "failed"
        | "in_progress"
        | "cancelled"
        | "queued"
        | "incomplete";
      incompleteReason?: "max_output_tokens" | "content_filter";
    } & (
        | ProviderErrorCodeDiagnostic
        | {
            readonly providerErrorCodeStatus?: never;
            readonly providerErrorCode?: never;
          }
      ))
  | (BasicStageResult<"output_extraction"> & { output: "present" | "missing" })
  | BasicStageResult<"json_parse">
  | (BasicStageResult<"provider_wire_validation"> & {
      structuralProbe: ProviderStructuralProbe;
      issueCount?: number;
      issues?: readonly SafeValidationIssue[];
    })
  | (BasicStageResult<"canonical_validation"> & {
      issueCount?: number;
      issues?: readonly SafeValidationIssue[];
    })
  | BasicStageResult<"materialization">
  | BasicStageResult<"subject_legal_selection">
  | BasicStageResult<"renderer">
  | BasicStageResult<"hard_expectations">;

export type EvaluationDiagnosticTrace =
  | {
      status: "completed";
      stages: readonly EvaluationDiagnosticStageResult[];
      usage: EvaluationDiagnosticUsage;
    }
  | {
      status: "failed";
      firstFailureStage: EvaluationDiagnosticStage;
      stages: readonly EvaluationDiagnosticStageResult[];
      usage: EvaluationDiagnosticUsage;
    };

const KNOWN_PROVIDER_FIELDS = new Set([
  "draft",
  "outcome",
  "title",
  "problem",
  "circumstances",
  "impact",
  "subject",
  "warnings",
  "quote",
  "kind",
  "evidence",
  "sourceField",
]);

const SAFE_ISSUE_CODE_SET = new Set<string>(SAFE_ISSUE_CODES);
const SAFE_EXPECTED_TYPES = new Set(["array", "boolean", "null", "number", "object", "string"]);

function jsonType(value: unknown): SafeJsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object":
      return "object";
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "unknown";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function probeProviderResponse(value: unknown): ProviderStructuralProbe {
  const rootType = jsonType(value);
  if (!isRecord(value)) {
    return {
      rootType,
      draftPresence: "missing",
      knownKeysPresent: [],
      unknownKeyCount: 0,
    };
  }

  const draftPresent = Object.hasOwn(value, "draft");
  const draft = draftPresent ? value.draft : undefined;
  const draftRecord = isRecord(draft) ? draft : undefined;
  const draftKeys = draftRecord === undefined ? [] : Object.keys(draftRecord);
  const knownKeysPresent = KNOWN_DRAFT_FIELDS.filter((key) => draftKeys.includes(key));
  const outcome =
    draftRecord !== undefined && Object.hasOwn(draftRecord, "outcome")
      ? draftRecord.outcome
      : undefined;

  return {
    rootType,
    draftPresence: draftPresent ? "present" : "missing",
    ...(draftPresent ? { draftType: jsonType(draft) } : {}),
    knownKeysPresent,
    unknownKeyCount: countUnknownKeys(value),
    ...(outcome === "generated" || outcome === "multiple_issues" ? { outcome } : {}),
  };
}

function countUnknownKeys(value: unknown): number {
  const pending = [value];
  let count = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    if (!isRecord(current)) continue;

    for (const [key, nestedValue] of Object.entries(current)) {
      count += Number(!KNOWN_PROVIDER_FIELDS.has(key));
      pending.push(nestedValue);
    }
  }

  return count;
}

type UnsafeValidationIssue = {
  code?: unknown;
  path?: readonly unknown[];
  expected?: unknown;
  message?: unknown;
  input?: unknown;
};

export function sanitizeValidationIssues(
  issues: readonly UnsafeValidationIssue[],
): readonly SafeValidationIssue[] {
  return issues.map((issue) => {
    const code: SafeValidationIssueCode =
      typeof issue.code === "string" && SAFE_ISSUE_CODE_SET.has(issue.code)
        ? (issue.code as SafeValidationIssueCode)
        : "unknown";
    const path =
      (issue.path ?? [])
        .map((segment) => {
          if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) {
            return String(segment);
          }
          return typeof segment === "string" && KNOWN_PROVIDER_FIELDS.has(segment)
            ? segment
            : "<unknown>";
        })
        .join(".") || "<unknown>";
    const expected =
      typeof issue.expected === "string" && SAFE_EXPECTED_TYPES.has(issue.expected)
        ? (issue.expected as SafeValidationIssue["expected"])
        : undefined;
    return {
      code,
      path,
      ...(expected === undefined ? {} : { expected }),
    };
  });
}

export type EvaluationRequestDraftParsingResult =
  | {
      status: "success";
      draft: RequestDraft;
      structuralProbe: ProviderStructuralProbe;
      stages: readonly EvaluationDiagnosticStageResult[];
    }
  | {
      status: "failure";
      firstFailureStage: "json_parse" | "provider_wire_validation" | "canonical_validation";
      structuralProbe?: ProviderStructuralProbe;
      stages: readonly EvaluationDiagnosticStageResult[];
    };

export function parseRequestDraftForEvaluation(
  responseText: string,
): EvaluationRequestDraftParsingResult {
  let parsedResponse: unknown;
  try {
    parsedResponse = JSON.parse(responseText);
  } catch {
    return {
      status: "failure",
      firstFailureStage: "json_parse",
      stages: [{ stage: "json_parse", status: "fail" }],
    };
  }

  const structuralProbe = probeProviderResponse(parsedResponse);
  const stages: EvaluationDiagnosticStageResult[] = [{ stage: "json_parse", status: "pass" }];
  const providerResult = providerRequestDraftResponseSchema.safeParse(parsedResponse);
  if (!providerResult.success) {
    stages.push({
      stage: "provider_wire_validation",
      status: "fail",
      structuralProbe,
      issueCount: providerResult.error.issues.length,
      issues: sanitizeValidationIssues(providerResult.error.issues),
    });
    return {
      status: "failure",
      firstFailureStage: "provider_wire_validation",
      structuralProbe,
      stages,
    };
  }

  stages.push({ stage: "provider_wire_validation", status: "pass", structuralProbe });
  const draftResult = validateProviderRequestDraft(providerResult.data.draft);
  if (!draftResult.success) {
    stages.push({
      stage: "canonical_validation",
      status: "fail",
      issueCount: draftResult.error.issues.length,
      issues: sanitizeValidationIssues(draftResult.error.issues),
    });
    return {
      status: "failure",
      firstFailureStage: "canonical_validation",
      structuralProbe,
      stages,
    };
  }

  stages.push({ stage: "canonical_validation", status: "pass" });
  return { status: "success", draft: draftResult.draft, structuralProbe, stages };
}
