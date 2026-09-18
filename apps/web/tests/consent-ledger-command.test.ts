import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ConsentLedger } from "../src/consent-ledger.js";
import { runConsentLedgerCommand } from "../src/consent-ledger-command.js";
import { C1_CONSENT_VERSION } from "../src/consent-policy.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
it("requires explicit verified-request acknowledgement before revocation", () => {
  const directory = mkdtempSync(join(tmpdir(), "consent-command-"));
  directories.push(directory);
  const path = join(directory, "ledger.sqlite");
  const ledger = new ConsentLedger(path);
  const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
  ledger.close();
  expect(() => runConsentLedgerCommand(["revoke", path, receipt.consentReceiptId])).toThrow();
  expect(() => runConsentLedgerCommand(["find", path, receipt.consentReceiptId])).toThrow();
  expect(
    runConsentLedgerCommand(["revoke", path, receipt.consentReceiptId, "--request-verified"]),
  ).toMatchObject({ status: "revoked" });
});
it("requires retention and destruction review and preserves explicit holds", () => {
  const directory = mkdtempSync(join(tmpdir(), "consent-command-"));
  directories.push(directory);
  const path = join(directory, "ledger.sqlite");
  const ledger = new ConsentLedger(path, { now: () => new Date("2020-01-01T00:00:00.000Z") });
  const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
  ledger.close();
  expect(runConsentLedgerCommand(["preview-expired", path])).toEqual([receipt]);
  expect(() => runConsentLedgerCommand(["delete-expired", path, "--holds-reviewed"])).toThrow();
  expect(
    runConsentLedgerCommand([
      "delete-expired",
      path,
      "--holds-reviewed",
      "--destruction-evidence-ready",
      "--protect",
      receipt.consentReceiptId,
    ]),
  ).toEqual([]);
  expect(
    runConsentLedgerCommand(["find", path, receipt.consentReceiptId, "--request-verified"]),
  ).toEqual(receipt);
  expect(
    runConsentLedgerCommand([
      "delete-expired",
      path,
      "--holds-reviewed",
      "--destruction-evidence-ready",
    ]),
  ).toEqual([receipt]);
  expect(
    runConsentLedgerCommand(["find", path, receipt.consentReceiptId, "--request-verified"]),
  ).toBeNull();
  expect(runConsentLedgerCommand(["export-destruction-events", path])).toEqual([
    expect.objectContaining({ consentReceiptId: receipt.consentReceiptId }),
  ]);
  expect(() => runConsentLedgerCommand(["purge-expired-destruction-events", path])).toThrow();
  expect(() =>
    runConsentLedgerCommand(["find", path, receipt.consentReceiptId, "--unknown"]),
  ).toThrow();
});
