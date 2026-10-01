import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ConsentLedger } from "../src/consent-ledger.js";
import { runConsentLedgerCommand } from "../src/consent-ledger-command.js";
import { C1_CONSENT_VERSION } from "../src/consent-policy.js";

const directories: string[] = [];
const timingArgs = [
  "--trigger-at",
  "2022-12-31T00:00:00.000Z",
  "--deadline-at",
  "2023-01-10T00:00:00.000Z",
  "--backup-plan",
  "rotation",
  "--expected-rotation-at",
  "2023-01-08T00:00:00.000Z",
  "--rotation-safety-margin-seconds",
  "86400",
] as const;

function createExpiredReceipt() {
  const directory = mkdtempSync(join(tmpdir(), "consent-command-"));
  directories.push(directory);
  const path = join(directory, "ledger.sqlite");
  const ledger = new ConsentLedger(path, { now: () => new Date("2020-01-01T00:00:00.000Z") });
  const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
  ledger.close();
  return { path, receipt };
}

function createLegacyDestruction() {
  const directory = mkdtempSync(join(tmpdir(), "consent-command-legacy-"));
  directories.push(directory);
  const path = join(directory, "ledger.sqlite");
  const consentReceiptId = "synthetic-legacy-receipt";
  const ledgerDatabase = new DatabaseSync(path);
  ledgerDatabase.exec(`
    CREATE TABLE consent_receipts (
      consentReceiptId TEXT PRIMARY KEY NOT NULL,
      requestId TEXT NOT NULL,
      consentVersion TEXT NOT NULL,
      serverTimestamp TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('accepted', 'revoked')),
      revocationTimestamp TEXT,
      CHECK((status = 'accepted' AND revocationTimestamp IS NULL)
        OR (status = 'revoked' AND revocationTimestamp IS NOT NULL))
    ) STRICT;
    PRAGMA user_version = 286;
  `);
  ledgerDatabase.close();
  const destructionDatabase = new DatabaseSync(`${path}.destruction.sqlite`);
  destructionDatabase.exec(`
    CREATE TABLE consent_destructions (
      consentReceiptId TEXT PRIMARY KEY NOT NULL,
      destroyedAt TEXT NOT NULL,
      dataCategory TEXT NOT NULL,
      informationSystem TEXT NOT NULL,
      reason TEXT NOT NULL
    ) STRICT;
    INSERT INTO consent_destructions VALUES (
      '${consentReceiptId}',
      '2023-01-01T00:00:00.000Z',
      'Данные о согласии Ц1',
      'consent ledger Ц1',
      'истечение операторского срока хранения'
    );
  `);
  destructionDatabase.close();
  return { path, consentReceiptId };
}

afterEach(() => {
  vi.useRealTimers();
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
  const { path, receipt } = createExpiredReceipt();
  vi.useFakeTimers({ now: new Date("2023-01-01T00:00:00.000Z") });
  expect(runConsentLedgerCommand(["preview-expired", path])).toEqual([receipt]);
  expect(() => runConsentLedgerCommand(["delete-expired", path, "--holds-reviewed"])).toThrow();
  expect(
    runConsentLedgerCommand([
      "delete-expired",
      path,
      "--holds-reviewed",
      "--destruction-evidence-ready",
      ...timingArgs,
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
      ...timingArgs,
    ]),
  ).toEqual([receipt]);
  expect(
    runConsentLedgerCommand(["find", path, receipt.consentReceiptId, "--request-verified"]),
  ).toBeNull();
  expect(runConsentLedgerCommand(["export-destruction-events", path])).toEqual([]);
  expect(runConsentLedgerCommand(["preview-pending-destructions", path])).toEqual([
    expect.objectContaining({ consentReceiptId: receipt.consentReceiptId }),
  ]);
  expect(() => runConsentLedgerCommand(["purge-expired-destruction-events", path])).toThrow();
  expect(() =>
    runConsentLedgerCommand(["find", path, receipt.consentReceiptId, "--unknown"]),
  ).toThrow();
});

it("rejects incomplete or malformed timing before deleting an expired receipt", () => {
  const { path, receipt } = createExpiredReceipt();
  vi.useFakeTimers({ now: new Date("2023-01-01T00:00:00.000Z") });
  const reviewArgs = ["--holds-reviewed", "--destruction-evidence-ready"];

  expect(() => runConsentLedgerCommand(["delete-expired", path, ...reviewArgs])).toThrow();
  expect(() =>
    runConsentLedgerCommand([
      "delete-expired",
      path,
      ...reviewArgs,
      ...timingArgs.slice(0, 1),
      "not-a-timestamp",
      ...timingArgs.slice(2),
    ]),
  ).toThrow();
  for (const invalidMargin of ["0", "-1", "1.5", "9007199254740992"])
    expect(() =>
      runConsentLedgerCommand([
        "delete-expired",
        path,
        ...reviewArgs,
        ...timingArgs.slice(0, -2),
        "--rotation-safety-margin-seconds",
        invalidMargin,
      ]),
    ).toThrow();
  expect(() =>
    runConsentLedgerCommand([
      "delete-expired",
      path,
      ...reviewArgs,
      ...timingArgs.slice(0, 5),
      "unknown-plan",
      ...timingArgs.slice(6),
    ]),
  ).toThrow();

  expect(
    runConsentLedgerCommand(["find", path, receipt.consentReceiptId, "--request-verified"]),
  ).toEqual(receipt);
});

it("remediates an overdue destruction without replacing its deadline or waiting for rotation", () => {
  const { path, receipt } = createExpiredReceipt();
  const overdueTiming = [
    "--trigger-at",
    "2022-12-31T00:00:00.000Z",
    "--deadline-at",
    "2023-01-10T00:00:00.000Z",
  ] as const;
  const reviewArgs = ["--holds-reviewed", "--destruction-evidence-ready"];
  vi.useFakeTimers({ now: new Date("2023-01-11T00:00:00.000Z") });

  expect(() =>
    runConsentLedgerCommand([
      "delete-expired",
      path,
      ...reviewArgs,
      ...overdueTiming,
      "--backup-plan",
      "rotation",
      "--expected-rotation-at",
      "2023-01-12T00:00:00.000Z",
      "--rotation-safety-margin-seconds",
      "1",
    ]),
  ).toThrow();
  expect(
    runConsentLedgerCommand(["find", path, receipt.consentReceiptId, "--request-verified"]),
  ).toEqual(receipt);

  expect(
    runConsentLedgerCommand([
      "delete-expired",
      path,
      ...reviewArgs,
      ...overdueTiming,
      "--backup-plan",
      "manual-backup-delete",
    ]),
  ).toEqual([receipt]);
  expect(
    runConsentLedgerCommand(["find", path, receipt.consentReceiptId, "--request-verified"]),
  ).toBeNull();
  expect(runConsentLedgerCommand(["preview-pending-destructions", path])).toEqual([
    expect.objectContaining({
      consentReceiptId: receipt.consentReceiptId,
      localDeletedAt: "2023-01-11T00:00:00.000Z",
      timing: {
        triggerAt: "2022-12-31T00:00:00.000Z",
        deadlineAt: "2023-01-10T00:00:00.000Z",
        backupPlan: "manual-backup-delete",
      },
    }),
  ]);

  vi.setSystemTime(new Date("2023-01-12T00:00:00.000Z"));
  const completed = runConsentLedgerCommand([
    "complete-destruction",
    path,
    receipt.consentReceiptId,
    "--backup-lifecycle-confirmed",
    "--completed-at",
    "2023-01-12T00:00:00.000Z",
    "--completion-method",
    "manual-backup-delete",
  ]);

  expect(completed).toMatchObject({
    completedAt: "2023-01-12T00:00:00.000Z",
    timely: false,
    timing: { deadlineAt: "2023-01-10T00:00:00.000Z" },
  });
  expect(runConsentLedgerCommand(["export-destruction-events", path])).toEqual([completed]);
});

it.each([
  "rotation",
  "manual-backup-delete",
] as const)("requires separate operator evidence and completes pending destruction by %s", (completionMethod) => {
  const { path, receipt } = createExpiredReceipt();
  vi.useFakeTimers({ now: new Date("2023-01-01T00:00:00.000Z") });
  runConsentLedgerCommand([
    "delete-expired",
    path,
    "--holds-reviewed",
    "--destruction-evidence-ready",
    ...timingArgs,
  ]);

  expect(() =>
    runConsentLedgerCommand([
      "complete-destruction",
      path,
      receipt.consentReceiptId,
      "--completed-at",
      "2090-01-02T00:00:00.000Z",
      "--completion-method",
      completionMethod,
    ]),
  ).toThrow();
  expect(() =>
    runConsentLedgerCommand([
      "complete-destruction",
      path,
      receipt.consentReceiptId,
      "--backup-lifecycle-confirmed",
      "--completed-at",
      "not-a-timestamp",
      "--completion-method",
      completionMethod,
    ]),
  ).toThrow();
  expect(runConsentLedgerCommand(["export-destruction-events", path])).toEqual([]);

  vi.setSystemTime(new Date("2023-01-08T00:00:00.000Z"));
  const completed = runConsentLedgerCommand([
    "complete-destruction",
    path,
    receipt.consentReceiptId,
    "--backup-lifecycle-confirmed",
    "--completed-at",
    "2023-01-08T00:00:00.000Z",
    "--completion-method",
    completionMethod,
  ]);

  expect(completed).toMatchObject({
    consentReceiptId: receipt.consentReceiptId,
    completedAt: "2023-01-08T00:00:00.000Z",
    timely: true,
  });
  expect(runConsentLedgerCommand(["preview-pending-destructions", path])).toEqual([]);
  expect(runConsentLedgerCommand(["export-destruction-events", path])).toEqual([completed]);
  expect(() =>
    runConsentLedgerCommand([
      "complete-destruction",
      path,
      receipt.consentReceiptId,
      "--backup-lifecycle-confirmed",
      "--completed-at",
      "2023-01-09T00:00:00.000Z",
      "--completion-method",
      completionMethod,
    ]),
  ).toThrow();
  expect(runConsentLedgerCommand(["export-destruction-events", path])).toEqual([completed]);
});

it("passes legacy review timing explicitly and reports late completion", () => {
  const { path, consentReceiptId } = createLegacyDestruction();
  vi.useFakeTimers({ now: new Date("2023-01-11T00:00:00.000Z") });
  expect(runConsentLedgerCommand(["preview-pending-destructions", path])).toEqual([
    expect.objectContaining({ consentReceiptId, legacyReviewRequired: true }),
  ]);

  expect(() =>
    runConsentLedgerCommand([
      "complete-destruction",
      path,
      consentReceiptId,
      "--backup-lifecycle-confirmed",
      "--legacy-reviewed",
      "--completed-at",
      "2023-01-11T00:00:00.000Z",
      "--completion-method",
      "rotation",
      "--trigger-at",
      "2022-12-31T00:00:00.000Z",
    ]),
  ).toThrow();

  const completed = runConsentLedgerCommand([
    "complete-destruction",
    path,
    consentReceiptId,
    "--backup-lifecycle-confirmed",
    "--legacy-reviewed",
    "--completed-at",
    "2023-01-11T00:00:00.000Z",
    "--completion-method",
    "manual-backup-delete",
    "--trigger-at",
    "2022-12-31T00:00:00.000Z",
    "--deadline-at",
    "2023-01-10T00:00:00.000Z",
    "--backup-plan",
    "manual-backup-delete",
  ]);

  expect(completed).toMatchObject({ timely: false });
});
