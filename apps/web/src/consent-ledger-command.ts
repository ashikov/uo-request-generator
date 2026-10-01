import { accessSync, constants } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConsentLedger, type ConsentDestructionTiming } from "./consent-ledger.js";

type BackupPlan = "rotation" | "manual-backup-delete";
const timestampSchema = z.iso.datetime().transform((value) => new Date(value).toISOString());

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) throw new Error("Запас времени должен быть целым числом секунд.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new Error("Запас времени должен быть безопасным целым числом секунд.");
  return parsed;
}

function parseTiming(values: {
  "trigger-at"?: string;
  "deadline-at"?: string;
  "backup-plan"?: string;
  "expected-rotation-at"?: string;
  "rotation-safety-margin-seconds"?: string;
}): ConsentDestructionTiming {
  const triggerAtValue = values["trigger-at"];
  const deadlineAtValue = values["deadline-at"];
  const backupPlan = values["backup-plan"];
  if (!triggerAtValue || !deadlineAtValue || !backupPlan)
    throw new Error("Требуются trigger, deadline и план выхода из backup lifecycle.");
  if (backupPlan !== "rotation" && backupPlan !== "manual-backup-delete")
    throw new Error("Неизвестный план выхода из backup lifecycle.");
  const triggerAt = timestampSchema.parse(triggerAtValue);
  const deadlineAt = timestampSchema.parse(deadlineAtValue);

  const expectedRotationAtValue = values["expected-rotation-at"];
  const rotationSafetyMarginSeconds = parsePositiveInteger(
    values["rotation-safety-margin-seconds"],
  );
  if (backupPlan === "rotation") {
    if (!expectedRotationAtValue || !rotationSafetyMarginSeconds)
      throw new Error("Для rotation требуются ожидаемое время и положительный запас времени.");
    return {
      triggerAt,
      deadlineAt,
      backupPlan,
      expectedRotationAt: timestampSchema.parse(expectedRotationAtValue),
      rotationSafetyMarginSeconds,
    };
  }
  if (expectedRotationAtValue !== undefined || rotationSafetyMarginSeconds !== undefined)
    throw new Error("Параметры ожидаемой rotation неприменимы к manual backup delete.");
  return { triggerAt, deadlineAt, backupPlan };
}

export function runConsentLedgerCommand(args: string[]): unknown {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      "request-verified": { type: "boolean" },
      "holds-reviewed": { type: "boolean" },
      "destruction-evidence-ready": { type: "boolean" },
      "documents-archived": { type: "boolean" },
      "backup-lifecycle-confirmed": { type: "boolean" },
      "legacy-reviewed": { type: "boolean" },
      "trigger-at": { type: "string" },
      "deadline-at": { type: "string" },
      "backup-plan": { type: "string" },
      "expected-rotation-at": { type: "string" },
      "rotation-safety-margin-seconds": { type: "string" },
      "completed-at": { type: "string" },
      "completion-method": { type: "string" },
      protect: { type: "string", multiple: true },
    },
  });
  const [command, path, receiptId] = positionals;
  const individual =
    command === "find" || command === "revoke" || command === "complete-destruction";
  if (
    !path ||
    ![
      "find",
      "revoke",
      "preview-expired",
      "delete-expired",
      "preview-pending-destructions",
      "complete-destruction",
      "export-destruction-events",
      "preview-expired-destruction-events",
      "purge-expired-destruction-events",
    ].includes(command ?? "") ||
    positionals.length !== (individual ? 3 : 2)
  ) {
    throw new Error(
      "Требуются команда, файл ledger и, для find/revoke/complete-destruction, consentReceiptId.",
    );
  }
  if ((command === "find" || command === "revoke") && values["request-verified"] !== true) {
    throw new Error("Сначала проверьте заявителя и запрос по процедуре #184.");
  }
  if (
    command === "delete-expired" &&
    (values["holds-reviewed"] !== true || values["destruction-evidence-ready"] !== true)
  ) {
    throw new Error("Сначала проверьте основания хранения и применимое подтверждение уничтожения.");
  }
  const timing =
    command === "delete-expired"
      ? parseTiming(values)
      : command === "complete-destruction" &&
          (values["trigger-at"] !== undefined ||
            values["deadline-at"] !== undefined ||
            values["backup-plan"] !== undefined ||
            values["expected-rotation-at"] !== undefined ||
            values["rotation-safety-margin-seconds"] !== undefined)
        ? parseTiming(values)
        : undefined;
  if (command === "complete-destruction") {
    if (
      values["backup-lifecycle-confirmed"] !== true ||
      !values["completed-at"] ||
      (values["completion-method"] !== "rotation" &&
        values["completion-method"] !== "manual-backup-delete")
    )
      throw new Error("Требуется явное подтверждение выхода записи из backup lifecycle.");
    if (timing && values["legacy-reviewed"] !== true)
      throw new Error("Timing при completion разрешён только после review legacy evidence.");
    if (values["legacy-reviewed"] === true && !timing)
      throw new Error("Для review legacy evidence требуется явный timing.");
  }
  const completedAt =
    command === "complete-destruction"
      ? timestampSchema.parse(values["completed-at"] as string)
      : undefined;
  if (
    command === "purge-expired-destruction-events" &&
    (values["holds-reviewed"] !== true || values["documents-archived"] !== true)
  ) {
    throw new Error("Сначала проверьте исключения и сохранность акта и выгрузки.");
  }
  // Команда обслуживания не создаёт новый файл при ошибке в указанном расположении.
  accessSync(path, constants.R_OK | constants.W_OK);
  const ledger = new ConsentLedger(path);
  try {
    if (command === "find" && receiptId) return ledger.find(receiptId) ?? null;
    if (command === "revoke" && receiptId) return ledger.revoke(receiptId) ?? null;
    if (command === "preview-expired") return ledger.expired(values.protect ?? []);
    if (command === "preview-pending-destructions") return ledger.pendingDestructions();
    if (command === "complete-destruction" && receiptId && completedAt)
      return ledger.completeDestruction(receiptId, {
        backupLifecycleConfirmed: values["backup-lifecycle-confirmed"] === true,
        completedAt,
        completionMethod: values["completion-method"] as BackupPlan,
        ...(values["legacy-reviewed"] === undefined
          ? {}
          : { legacyReviewed: values["legacy-reviewed"] }),
        ...(timing === undefined ? {} : { timing }),
      });
    if (command === "export-destruction-events") return ledger.destructionEvents();
    if (command === "preview-expired-destruction-events")
      return ledger.expiredDestructionEvents(values.protect ?? []);
    if (command === "purge-expired-destruction-events")
      return ledger.purgeExpiredDestructionEvents({
        holdsReviewed: values["holds-reviewed"] === true,
        documentsArchived: values["documents-archived"] === true,
        protectedReceiptIds: values.protect ?? [],
      });
    if (command === "delete-expired" && timing)
      return ledger.deleteExpired({
        holdsReviewed: values["holds-reviewed"] === true,
        protectedReceiptIds: values.protect ?? [],
        timing,
      });
    throw new Error("Команда ledger не поддерживается.");
  } finally {
    ledger.close();
  }
}

if (import.meta.main) {
  try {
    process.stdout.write(
      `${JSON.stringify(runConsentLedgerCommand(process.argv.slice(2)), null, 2)}\n`,
    );
  } catch {
    // Ошибка SQLite может содержать закрытое расположение файла или другие сведения.
    process.stderr.write(
      "Команда ledger не выполнена. Проверьте аргументы, доступ и условия операции.\n",
    );
    process.exitCode = 1;
  }
}
