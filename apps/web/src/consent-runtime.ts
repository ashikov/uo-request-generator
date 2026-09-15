import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ConsentLedger } from "./consent-ledger.js";

export function openConsentLedger(
  environment: { CONSENT_LEDGER_FILE?: string },
  options: { allowMissing: boolean },
): ConsentLedger | undefined {
  const path = environment.CONSENT_LEDGER_FILE;
  if (path === undefined && options.allowMissing) return undefined;
  if (path === undefined || path.trim() === "") {
    throw new Error("CONSENT_LEDGER_FILE is required");
  }
  if (path === ":memory:") throw new Error("CONSENT_LEDGER_FILE must be persistent");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return new ConsentLedger(path);
}
