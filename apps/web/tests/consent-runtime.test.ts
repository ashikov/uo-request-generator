import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openConsentLedger } from "../src/consent-runtime.js";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Конфигурация долговечного ledger", () => {
  it("не допускает подключённый LLM без постоянного файла", () => {
    expect(() => openConsentLedger({}, { allowMissing: false })).toThrow("CONSENT_LEDGER_FILE");
  });
  it("не создаёт ephemeral fallback для локального режима без LLM", () => {
    expect(openConsentLedger({}, { allowMissing: true })).toBeUndefined();
  });
  it("создаёт закрытую область и сохраняет запись после повторного открытия", () => {
    const directory = mkdtempSync(join(tmpdir(), "consent-runtime-test-"));
    directories.push(directory);
    const environment = { CONSENT_LEDGER_FILE: join(directory, "closed", "ledger.sqlite") };
    const ledger = openConsentLedger(environment, { allowMissing: false });
    if (!ledger) throw new Error("Expected durable ledger");
    const receipt = ledger.accept("synthetic-request", "c1-2026-09-15-r1");
    ledger.close();
    const reopened = openConsentLedger(environment, { allowMissing: false });
    try {
      expect(reopened?.find(receipt.consentReceiptId)).toEqual(receipt);
    } finally {
      reopened?.close();
    }
  });
});
