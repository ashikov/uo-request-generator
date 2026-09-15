import { accessSync, constants } from "node:fs";
import { parseArgs } from "node:util";
import { ConsentLedger } from "./consent-ledger.js";

export function runConsentLedgerCommand(args: string[]): unknown {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      "request-verified": { type: "boolean" },
      "holds-reviewed": { type: "boolean" },
      "destruction-evidence-ready": { type: "boolean" },
      protect: { type: "string", multiple: true },
    },
  });
  const [command, path, receiptId] = positionals;
  const individual = command === "find" || command === "revoke";
  if (
    !path ||
    !["find", "revoke", "preview-expired", "delete-expired"].includes(command ?? "") ||
    positionals.length !== (individual ? 3 : 2)
  ) {
    throw new Error("Требуются команда, файл ledger и, для find/revoke, consentReceiptId.");
  }
  if (individual && values["request-verified"] !== true) {
    throw new Error("Сначала проверьте заявителя и запрос по процедуре #184.");
  }
  if (
    command === "delete-expired" &&
    (values["holds-reviewed"] !== true || values["destruction-evidence-ready"] !== true)
  ) {
    throw new Error("Сначала проверьте основания хранения и применимое подтверждение уничтожения.");
  }
  // Команда обслуживания не создаёт новый файл при ошибке в указанном расположении.
  accessSync(path, constants.R_OK | constants.W_OK);
  const ledger = new ConsentLedger(path);
  try {
    if (command === "find" && receiptId) return ledger.find(receiptId) ?? null;
    if (command === "revoke" && receiptId) return ledger.revoke(receiptId) ?? null;
    if (command === "preview-expired") return ledger.expired(values.protect ?? []);
    return ledger.deleteExpired({
      holdsReviewed: values["holds-reviewed"] === true,
      protectedReceiptIds: values.protect ?? [],
    });
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
