import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ConsentLedger } from "../src/consent-ledger.js";
import { C1_CONSENT_VERSION, consentEvidenceExpiresAt } from "../src/consent-policy.js";

const directories: string[] = [];
const ledgers: ConsentLedger[] = [];
const timing = {
  triggerAt: "2020-01-01T00:00:00.000Z",
  deadlineAt: "2030-01-01T00:00:00.000Z",
  backupPlan: "manual-backup-delete" as const,
};
function fixture(now = "2026-09-15T12:00:00.000Z") {
  const directory = mkdtempSync(join(tmpdir(), "consent-test-"));
  directories.push(directory);
  const path = join(directory, "ledger.sqlite");
  const destructionPath = join(directory, "ledger.sqlite.destruction.sqlite");
  let clock = new Date(now);
  let sequence = 0;
  const ledger = new ConsentLedger(path, {
    now: () => clock,
    generateReceiptId: () => `synthetic-receipt-${++sequence}`,
  });
  ledgers.push(ledger);
  return {
    ledger,
    path,
    destructionPath,
    setTime: (timestamp: string) => {
      clock = new Date(timestamp);
    },
  };
}
afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("consent ledger", () => {
  it("persists only the agreed fields across reopen and restricts file permissions", () => {
    const { ledger, path, destructionPath } = fixture();
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    expect(receipt).toEqual({
      consentReceiptId: "synthetic-receipt-1",
      requestId: "synthetic-request",
      consentVersion: "c1-2026-09-15-r1",
      serverTimestamp: "2026-09-15T12:00:00.000Z",
      status: "accepted",
    });
    ledger.close();
    const reopened = new ConsentLedger(path);
    ledgers.push(reopened);
    expect(reopened.find(receipt.consentReceiptId)).toEqual(receipt);
    expect(reopened.find("missing")).toBeUndefined();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(destructionPath).mode & 0o777).toBe(0o600);
    const db = new DatabaseSync(path);
    expect(
      db
        .prepare("PRAGMA table_info(consent_receipts)")
        .all()
        .map((column) => column.name),
    ).toEqual([
      "consentReceiptId",
      "requestId",
      "consentVersion",
      "serverTimestamp",
      "status",
      "revocationTimestamp",
    ]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: "consent_receipts" },
    ]);
    db.close();
    const evidenceDb = new DatabaseSync(destructionPath, { readOnly: true });
    expect(evidenceDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: "consent_destructions" },
    ]);
    evidenceDb.close();
  });
  it("keeps the previous image ledger schema after destruction and reopens separate evidence", () => {
    const { ledger, path, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const expired = ledger.accept("synthetic-expired", C1_CONSENT_VERSION);
    const retained = ledger.accept("synthetic-retained", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    ledger.deleteExpired({
      holdsReviewed: true,
      protectedReceiptIds: [retained.consentReceiptId],
      timing,
    });
    ledger.close();

    // Точная форма таблиц, которую проверяет опубликованный image до #287.
    const previousImageDatabase = new DatabaseSync(path, { readOnly: true });
    try {
      expect(
        previousImageDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
      ).toEqual([{ name: "consent_receipts" }]);
      expect(
        previousImageDatabase
          .prepare("PRAGMA table_info(consent_receipts)")
          .all()
          .map((column) => [column.name, column.type]),
      ).toEqual([
        ["consentReceiptId", "TEXT"],
        ["requestId", "TEXT"],
        ["consentVersion", "TEXT"],
        ["serverTimestamp", "TEXT"],
        ["status", "TEXT"],
        ["revocationTimestamp", "TEXT"],
      ]);
      expect(
        previousImageDatabase
          .prepare(
            "SELECT strict FROM pragma_table_list WHERE name = 'consent_receipts' AND schema = 'main'",
          )
          .get(),
      ).toEqual({ strict: 1 });
      expect(
        previousImageDatabase
          .prepare("SELECT * FROM consent_receipts WHERE consentReceiptId = ?")
          .get(retained.consentReceiptId),
      ).toMatchObject({ requestId: retained.requestId });
    } finally {
      previousImageDatabase.close();
    }
    const reopened = new ConsentLedger(path);
    ledgers.push(reopened);
    expect(reopened.find(retained.consentReceiptId)).toEqual(retained);
    expect(reopened.pendingDestructions().map((event) => event.consentReceiptId)).toEqual([
      expired.consentReceiptId,
    ]);
  });
  it("fails closed when an initialized destruction journal is missing", () => {
    const { ledger, path, destructionPath, setTime } = fixture("2020-01-01T00:00:00.000Z");
    ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing });
    ledger.close();
    rmSync(destructionPath);
    expect(() => new ConsentLedger(path)).toThrow();
    expect(() => statSync(destructionPath)).toThrow();
    const db = new DatabaseSync(path, { readOnly: true });
    expect(db.prepare("SELECT count(*) AS count FROM consent_receipts").get()).toEqual({
      count: 0,
    });
    db.close();
  });
  it("initializes a separate journal for a pre-286 ledger without losing receipts", () => {
    const { ledger, path, destructionPath } = fixture();
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    ledger.close();
    rmSync(destructionPath);
    rmSync(`${path}.destruction-state.sqlite`);
    const oldDatabase = new DatabaseSync(path);
    oldDatabase.exec("PRAGMA user_version = 0");
    oldDatabase.close();
    const migrated = new ConsentLedger(path);
    ledgers.push(migrated);
    expect(migrated.find(receipt.consentReceiptId)).toEqual(receipt);
    expect(migrated.destructionEvents()).toEqual([]);
    expect(statSync(destructionPath).mode & 0o777).toBe(0o600);
  });
  it("does not replace an initialized journal with an empty SQLite file", () => {
    const { ledger, path, destructionPath } = fixture();
    ledger.close();
    writeFileSync(destructionPath, "");
    expect(() => new ConsentLedger(path)).toThrow();
  });
  it("records revocation once and retains it after reopen", () => {
    const { ledger, path, setTime } = fixture();
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2027-01-01T00:00:00.000Z");
    const revoked = ledger.revoke(receipt.consentReceiptId);
    expect(revoked).toEqual({
      ...receipt,
      status: "revoked",
      revocationTimestamp: "2027-01-01T00:00:00.000Z",
    });
    setTime("2028-01-01T00:00:00.000Z");
    expect(ledger.revoke(receipt.consentReceiptId)).toEqual(revoked);
    expect(ledger.revoke("missing")).toBeUndefined();
    ledger.close();
    const reopened = new ConsentLedger(path);
    ledgers.push(reopened);
    expect(reopened.find(receipt.consentReceiptId)).toEqual(revoked);
  });
  it("fails closed for invalid version, corrupt storage and an interrupted write", () => {
    const { ledger, path } = fixture();
    expect(() => ledger.accept("synthetic-request", "unknown")).toThrow();
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TRIGGER reject_insert BEFORE INSERT ON consent_receipts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    expect(() => ledger.accept("synthetic-request", C1_CONSENT_VERSION)).toThrow();
    expect(db.prepare("SELECT count(*) AS count FROM consent_receipts").get()).toEqual({
      count: 0,
    });
    db.close();
    ledger.close();
    writeFileSync(path, "invalid sqlite");
    expect(() => new ConsentLedger(path)).toThrow();
    expect(() => new ConsentLedger(join(path, "missing.sqlite"))).toThrow();
  });
  it.each([
    "CREATE TRIGGER ignore_insert BEFORE INSERT ON consent_receipts BEGIN SELECT RAISE(IGNORE); END",
    "CREATE TRIGGER delete_insert AFTER INSERT ON consent_receipts BEGIN DELETE FROM consent_receipts WHERE consentReceiptId = NEW.consentReceiptId; END",
    "CREATE TRIGGER alter_insert AFTER INSERT ON consent_receipts BEGIN UPDATE consent_receipts SET requestId = 'synthetic-altered' WHERE consentReceiptId = NEW.consentReceiptId; END",
  ])("does not confirm a missing or changed receipt: %s", (trigger) => {
    const { ledger, path } = fixture();
    const db = new DatabaseSync(path);
    try {
      db.exec(trigger);
      expect(() => ledger.accept("synthetic-request", C1_CONSENT_VERSION)).toThrow();
      expect(db.prepare("SELECT count(*) AS count FROM consent_receipts").get()).toEqual({
        count: 0,
      });
    } finally {
      db.close();
    }
  });
  it.each([
    "ALTER TABLE consent_receipts ADD COLUMN payload TEXT",
    "CREATE TABLE unrelated (value TEXT)",
  ])("rejects storage with an expanded schema: %s", (mutation) => {
    const { ledger, path } = fixture();
    ledger.close();
    const db = new DatabaseSync(path);
    db.exec(mutation);
    db.close();
    expect(() => new ConsentLedger(path)).toThrow();
  });
  it("enforces revocation timestamp invariants in SQLite", () => {
    const { ledger, path } = fixture();
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    const db = new DatabaseSync(path);
    try {
      expect(() =>
        db
          .prepare("UPDATE consent_receipts SET revocationTimestamp = ? WHERE consentReceiptId = ?")
          .run("2027-01-01T00:00:00.000Z", receipt.consentReceiptId),
      ).toThrow();
      expect(() =>
        db
          .prepare("UPDATE consent_receipts SET status = 'revoked' WHERE consentReceiptId = ?")
          .run(receipt.consentReceiptId),
      ).toThrow();
      expect(ledger.find(receipt.consentReceiptId)).toEqual(receipt);
    } finally {
      db.close();
    }
  });
  it("uses three calendar years, clamping leap day to the last February day", () => {
    expect(
      consentEvidenceExpiresAt({ status: "accepted", serverTimestamp: "2024-02-29T10:11:12.000Z" }),
    ).toBe("2027-02-28T10:11:12.000Z");
    expect(
      consentEvidenceExpiresAt({
        status: "revoked",
        serverTimestamp: "2024-02-29T10:11:12.000Z",
        revocationTimestamp: "2025-03-01T00:00:00.000Z",
      }),
    ).toBe("2028-03-01T00:00:00.000Z");
  });
  it("deletes expired records only after explicit review, preserving holds and recent revocations", () => {
    const { ledger, setTime, path } = fixture("2024-01-01T00:00:00.000Z");
    const expired = ledger.accept("synthetic-expired", C1_CONSENT_VERSION);
    const held = ledger.accept("synthetic-held", C1_CONSENT_VERSION);
    const revoked = ledger.accept("synthetic-revoked", C1_CONSENT_VERSION);
    setTime("2026-01-01T00:00:00.000Z");
    ledger.revoke(revoked.consentReceiptId);
    setTime("2027-01-01T00:00:00.000Z");
    expect(ledger.expired([held.consentReceiptId])).toEqual([expired]);
    expect(ledger.find(expired.consentReceiptId)).toEqual(expired);
    expect(() =>
      ledger.deleteExpired({ holdsReviewed: false, protectedReceiptIds: [], timing }),
    ).toThrow();
    expect(
      ledger.deleteExpired({
        holdsReviewed: true,
        protectedReceiptIds: [held.consentReceiptId],
        timing,
      }),
    ).toEqual([expired]);
    expect(ledger.find(expired.consentReceiptId)).toBeUndefined();
    expect(ledger.find(held.consentReceiptId)).toEqual(held);
    expect(ledger.find(revoked.consentReceiptId)?.status).toBe("revoked");
    expect(readFileSync(path).includes(Buffer.from("synthetic-expired"))).toBe(false);
  });
  it("keeps pending local deletion evidence without exporting final destruction", () => {
    const { ledger, path, destructionPath, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const expired = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    const held = ledger.accept("synthetic-held", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    expect(
      ledger.deleteExpired({
        holdsReviewed: true,
        protectedReceiptIds: [held.consentReceiptId],
        timing,
      }),
    ).toEqual([expired]);
    expect(ledger.find(expired.consentReceiptId)).toBeUndefined();
    expect(ledger.find(held.consentReceiptId)).toEqual(held);
    expect(ledger.destructionEvents()).toEqual([]);
    expect(ledger.pendingDestructions()).toEqual([
      {
        consentReceiptId: expired.consentReceiptId,
        status: "pending",
        localDeletedAt: "2023-01-01T00:00:00.000Z",
        legacyReviewRequired: false,
        timing,
        dataCategory: "Данные о согласии Ц1",
        informationSystem: "consent ledger Ц1",
        reason: "истечение операторского срока хранения",
      },
    ]);
    expect(ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing })).toEqual([
      held,
    ]);
    expect(ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing })).toEqual(
      [],
    );
    ledger.close();
    const reopened = new ConsentLedger(path);
    ledgers.push(reopened);
    expect(reopened.pendingDestructions().map((event) => event.consentReceiptId)).toEqual([
      expired.consentReceiptId,
      held.consentReceiptId,
    ]);
    const db = new DatabaseSync(path);
    expect(
      db
        .prepare("PRAGMA table_info(consent_receipts)")
        .all()
        .map((column) => column.name),
    ).toEqual([
      "consentReceiptId",
      "requestId",
      "consentVersion",
      "serverTimestamp",
      "status",
      "revocationTimestamp",
    ]);
    db.close();
    const evidenceDb = new DatabaseSync(destructionPath, { readOnly: true });
    expect(
      evidenceDb
        .prepare("PRAGMA table_info(consent_destructions)")
        .all()
        .map((column) => column.name),
    ).toEqual(["consentReceiptId", "destroyedAt", "dataCategory", "informationSystem", "reason"]);
    evidenceDb.close();
  });
  it("retains destruction events for three calendar years and requires archive review before removal", () => {
    const { ledger, setTime } = fixture("2021-02-28T10:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2024-02-29T10:00:00.000Z");
    ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing });
    setTime("2024-03-01T10:00:00.000Z");
    ledger.completeDestruction(receipt.consentReceiptId, {
      backupLifecycleConfirmed: true,
      completedAt: "2024-03-01T10:00:00.000Z",
      completionMethod: "manual-backup-delete",
    });
    setTime("2027-02-28T09:59:59.999Z");
    expect(ledger.expiredDestructionEvents()).toEqual([]);
    expect(() =>
      ledger.purgeExpiredDestructionEvents({
        documentsArchived: false,
        holdsReviewed: true,
        protectedReceiptIds: [],
      }),
    ).toThrow();
    setTime("2027-03-01T10:00:00.000Z");
    expect(ledger.expiredDestructionEvents().map((event) => event.consentReceiptId)).toEqual([
      receipt.consentReceiptId,
    ]);
    expect(
      ledger.purgeExpiredDestructionEvents({
        documentsArchived: true,
        holdsReviewed: true,
        protectedReceiptIds: [],
      }),
    ).toHaveLength(1);
    expect(ledger.destructionEvents()).toEqual([]);
    expect(
      ledger.purgeExpiredDestructionEvents({
        documentsArchived: true,
        holdsReviewed: true,
        protectedReceiptIds: [],
      }),
    ).toEqual([]);
  });
  it.each([
    [
      "consent",
      "CREATE TRIGGER ignore_delete BEFORE DELETE ON consent_receipts BEGIN SELECT RAISE(IGNORE); END",
    ],
    [
      "consent",
      "CREATE TRIGGER restore_delete AFTER DELETE ON consent_receipts BEGIN INSERT INTO consent_receipts VALUES (OLD.consentReceiptId, OLD.requestId, OLD.consentVersion, OLD.serverTimestamp, OLD.status, OLD.revocationTimestamp); END",
    ],
    [
      "state",
      "CREATE TRIGGER reject_event BEFORE INSERT ON consent_destruction_state BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    ],
    [
      "state",
      "CREATE TRIGGER ignore_event BEFORE INSERT ON consent_destruction_state BEGIN SELECT RAISE(IGNORE); END",
    ],
  ])("rolls back deletion without a false event when destruction cannot complete: %s %s", (database, trigger) => {
    const { ledger, path, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    const db = new DatabaseSync(database === "state" ? `${path}.destruction-state.sqlite` : path);
    try {
      db.exec(trigger);
      expect(() =>
        ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing }),
      ).toThrow();
      expect(ledger.find(receipt.consentReceiptId)).toEqual(receipt);
      expect(ledger.destructionEvents()).toEqual([]);
    } finally {
      db.close();
    }
  });
  it("rolls back the whole batch when a later destruction event cannot be stored", () => {
    const { ledger, path, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const first = ledger.accept("synthetic-first", C1_CONSENT_VERSION);
    const second = ledger.accept("synthetic-second", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    const db = new DatabaseSync(`${path}.destruction-state.sqlite`);
    try {
      db.exec(
        "CREATE TRIGGER reject_second_event BEFORE INSERT ON consent_destruction_state WHEN NEW.consentReceiptId = 'synthetic-receipt-2' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
      );
      expect(() =>
        ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing }),
      ).toThrow();
      expect(ledger.find(first.consentReceiptId)).toEqual(first);
      expect(ledger.find(second.consentReceiptId)).toEqual(second);
      expect(ledger.destructionEvents()).toEqual([]);
    } finally {
      db.close();
    }
  });
  it("keeps protected destruction events when purging the older journal", () => {
    const { ledger, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const protectedReceipt = ledger.accept("synthetic-protected", C1_CONSENT_VERSION);
    const removableReceipt = ledger.accept("synthetic-removable", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing });
    for (const receipt of [protectedReceipt, removableReceipt])
      ledger.completeDestruction(receipt.consentReceiptId, {
        backupLifecycleConfirmed: true,
        completedAt: "2023-01-01T00:00:00.000Z",
        completionMethod: "manual-backup-delete",
      });
    setTime("2026-01-01T00:00:00.000Z");
    expect(
      ledger
        .purgeExpiredDestructionEvents({
          holdsReviewed: true,
          documentsArchived: true,
          protectedReceiptIds: [protectedReceipt.consentReceiptId],
        })
        .map((event) => event.consentReceiptId),
    ).toEqual([removableReceipt.consentReceiptId]);
    expect(ledger.destructionEvents().map((event) => event.consentReceiptId)).toEqual([
      protectedReceipt.consentReceiptId,
    ]);
  });
  it.each([
    "CREATE TRIGGER ignore_event_delete BEFORE DELETE ON consent_destruction_state BEGIN SELECT RAISE(IGNORE); END",
    "CREATE TRIGGER restore_event_delete AFTER DELETE ON consent_destruction_state BEGIN INSERT INTO consent_destruction_state VALUES (OLD.consentReceiptId, OLD.localDeletedAt, OLD.origin, OLD.timing, OLD.completedAt, OLD.completionMethod); END",
  ])("does not report journal removal when the event remains: %s", (trigger) => {
    const { ledger, path, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing });
    ledger.completeDestruction(receipt.consentReceiptId, {
      backupLifecycleConfirmed: true,
      completedAt: "2023-01-01T00:00:00.000Z",
      completionMethod: "manual-backup-delete",
    });
    setTime("2026-01-01T00:00:00.000Z");
    const db = new DatabaseSync(`${path}.destruction-state.sqlite`);
    try {
      db.exec(trigger);
      expect(() =>
        ledger.purgeExpiredDestructionEvents({
          holdsReviewed: true,
          documentsArchived: true,
          protectedReceiptIds: [],
        }),
      ).toThrow();
      expect(ledger.destructionEvents().map((event) => event.consentReceiptId)).toEqual([
        receipt.consentReceiptId,
      ]);
    } finally {
      db.close();
    }
  });
});

describe("backup lifecycle destruction completion", () => {
  const deadlineAt = "2023-01-10T00:00:00.000Z";
  const rotationTiming = {
    triggerAt: "2022-12-31T00:00:00.000Z",
    deadlineAt,
    backupPlan: "rotation" as const,
    expectedRotationAt: "2023-01-08T00:00:00.000Z",
    rotationSafetyMarginSeconds: 86400,
  };
  function pending() {
    const setup = fixture("2020-01-01T00:00:00.000Z");
    const receipt = setup.ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setup.setTime("2023-01-01T00:00:00.000Z");
    setup.ledger.deleteExpired({
      holdsReviewed: true,
      protectedReceiptIds: [],
      timing: rotationTiming,
    });
    return { ...setup, receipt };
  }
  const confirmation = {
    backupLifecycleConfirmed: true,
    completedAt: "2023-01-08T00:00:00.000Z",
    completionMethod: "rotation" as const,
  };

  it.each([
    "rotation",
    "manual-backup-delete",
  ] as const)("exports actual %s completion, once, after reopen", (completionMethod) => {
    const { ledger, receipt, path, setTime } = pending();
    setTime(confirmation.completedAt);
    const completed = ledger.completeDestruction(receipt.consentReceiptId, {
      ...confirmation,
      completionMethod,
    });
    expect(completed).toMatchObject({
      status: "completed",
      localDeletedAt: "2023-01-01T00:00:00.000Z",
      completedAt: confirmation.completedAt,
      completionMethod,
      timely: true,
      timing: rotationTiming,
    });
    expect(completed).not.toHaveProperty("destroyedAt");
    expect(ledger.pendingDestructions()).toEqual([]);
    expect(() =>
      ledger.completeDestruction(receipt.consentReceiptId, { ...confirmation, completionMethod }),
    ).toThrow();
    ledger.close();
    const reopened = new ConsentLedger(path);
    ledgers.push(reopened);
    expect(reopened.destructionEvents()).toEqual([completed]);
  });
  it.each([
    { ...confirmation, backupLifecycleConfirmed: false },
    { ...confirmation, completedAt: "2022-12-31T23:59:59.999Z" },
    { ...confirmation, completedAt: "2023-01-01T00:00:00.000Z" },
    { ...confirmation, completedAt: "2023-01-09T00:00:00.000Z" },
  ])("rejects missing evidence, early or future completion: %j", (declaration) => {
    const { ledger, receipt, setTime } = pending();
    setTime(confirmation.completedAt);
    expect(() => ledger.completeDestruction(receipt.consentReceiptId, declaration)).toThrow();
    expect(ledger.destructionEvents()).toEqual([]);
    expect(ledger.pendingDestructions()).toHaveLength(1);
  });
  it("retains late actual completion with timely false and the original deadline", () => {
    const { ledger, receipt, setTime } = pending();
    setTime("2023-01-11T00:00:00.000Z");
    expect(
      ledger.completeDestruction(receipt.consentReceiptId, {
        ...confirmation,
        completedAt: "2023-01-11T00:00:00.000Z",
      }),
    ).toMatchObject({ timely: false, timing: { deadlineAt } });
    expect(ledger.destructionEvents()).toMatchObject([{ timely: false }]);
  });
  it("does not purge pending flows even after three years", () => {
    const { ledger, setTime } = pending();
    setTime("2040-01-01T00:00:00.000Z");
    expect(ledger.expiredDestructionEvents()).toEqual([]);
    expect(
      ledger.purgeExpiredDestructionEvents({
        holdsReviewed: true,
        documentsArchived: true,
        protectedReceiptIds: [],
      }),
    ).toEqual([]);
    expect(ledger.pendingDestructions()).toHaveLength(1);
  });
  it.each([
    { ...rotationTiming, deadlineAt: "2023-01-08T12:00:00.000Z" },
    { ...rotationTiming, rotationSafetyMarginSeconds: 0 },
    { ...rotationTiming, triggerAt: "2023-01-02T00:00:00.000Z" },
    { ...rotationTiming, deadlineAt: "2022-12-30T00:00:00.000Z" },
  ])("rejects unsafe timing without local deletion: %j", (unsafeTiming) => {
    const { ledger, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    expect(() =>
      ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing: unsafeTiming }),
    ).toThrow();
    expect(ledger.find(receipt.consentReceiptId)).toEqual(receipt);
    expect(ledger.pendingDestructions()).toEqual([]);
  });
  it("requires manual completion when rotation cannot meet the declared deadline", () => {
    const { ledger, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    ledger.deleteExpired({
      holdsReviewed: true,
      protectedReceiptIds: [],
      timing: {
        triggerAt: rotationTiming.triggerAt,
        deadlineAt: "2023-01-02T00:00:00.000Z",
        backupPlan: "manual-backup-delete",
      },
    });
    setTime("2023-01-02T00:00:00.000Z");
    expect(() =>
      ledger.completeDestruction(receipt.consentReceiptId, {
        ...confirmation,
        completedAt: "2023-01-02T00:00:00.000Z",
      }),
    ).toThrow();
    expect(
      ledger.completeDestruction(receipt.consentReceiptId, {
        ...confirmation,
        completedAt: "2023-01-02T00:00:00.000Z",
        completionMethod: "manual-backup-delete",
      }),
    ).toMatchObject({ timely: true });
  });
  it("rolls back pending evidence and local deletion if state insertion fails", () => {
    const { ledger, path, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    const db = new DatabaseSync(`${path}.destruction-state.sqlite`);
    try {
      db.exec(
        "CREATE TRIGGER reject_state BEFORE INSERT ON consent_destruction_state BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
      );
      expect(() =>
        ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing }),
      ).toThrow();
      expect(ledger.find(receipt.consentReceiptId)).toEqual(receipt);
      expect(ledger.pendingDestructions()).toEqual([]);
    } finally {
      db.close();
    }
  });
  it.each([
    "CREATE TRIGGER reject_completion BEFORE UPDATE ON consent_destruction_state BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    "CREATE TRIGGER ignore_completion BEFORE UPDATE ON consent_destruction_state BEGIN SELECT RAISE(IGNORE); END",
    "CREATE TRIGGER alter_completion AFTER UPDATE ON consent_destruction_state BEGIN UPDATE consent_destruction_state SET completedAt = '2023-01-07T00:00:00.000Z' WHERE consentReceiptId = NEW.consentReceiptId; END",
  ])("does not report completion when durable confirmation fails: %s", (trigger) => {
    const { ledger, receipt, path, setTime } = pending();
    setTime(confirmation.completedAt);
    const db = new DatabaseSync(`${path}.destruction-state.sqlite`);
    try {
      db.exec(trigger);
      expect(() => ledger.completeDestruction(receipt.consentReceiptId, confirmation)).toThrow();
      expect(ledger.destructionEvents()).toEqual([]);
      expect(ledger.pendingDestructions()).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe("legacy journal migration and rollback schema", () => {
  function legacyJournal() {
    const setup = fixture();
    setup.ledger.close();
    rmSync(`${setup.path}.destruction-state.sqlite`);
    const db = new DatabaseSync(setup.destructionPath);
    db.exec("PRAGMA user_version = 0");
    db.prepare("INSERT INTO consent_destructions VALUES (?, ?, ?, ?, ?)").run(
      "synthetic-legacy",
      "2023-01-01T00:00:00.000Z",
      "Данные о согласии Ц1",
      "consent ledger Ц1",
      "истечение операторского срока хранения",
    );
    db.close();
    return setup;
  }
  function reopen(path: string) {
    const ledger = new ConsentLedger(path, { now: () => new Date("2026-01-01T00:00:00.000Z") });
    ledgers.push(ledger);
    return ledger;
  }
  it("preserves legacy deletion as pending through repeat migration and explicit operator review", () => {
    const { path, destructionPath } = legacyJournal();
    const ledger = reopen(path);
    expect(ledger.destructionEvents()).toEqual([]);
    expect(ledger.pendingDestructions()).toMatchObject([
      {
        consentReceiptId: "synthetic-legacy",
        localDeletedAt: "2023-01-01T00:00:00.000Z",
        legacyReviewRequired: true,
      },
    ]);
    expect(ledger.pendingDestructions()[0]).not.toHaveProperty("timing");
    const declaration = {
      backupLifecycleConfirmed: true,
      completedAt: "2023-01-02T00:00:00.000Z",
      completionMethod: "manual-backup-delete" as const,
    };
    expect(() => ledger.completeDestruction("synthetic-legacy", declaration)).toThrow();
    expect(() =>
      ledger.completeDestruction("synthetic-legacy", { ...declaration, legacyReviewed: true }),
    ).toThrow();
    ledger.close();
    const migratedAgain = reopen(path);
    expect(migratedAgain.pendingDestructions()).toHaveLength(1);
    expect(
      migratedAgain.completeDestruction("synthetic-legacy", {
        ...declaration,
        legacyReviewed: true,
        timing,
      }),
    ).toMatchObject({ timely: true, completedAt: declaration.completedAt });
    const db = new DatabaseSync(destructionPath, { readOnly: true });
    expect(db.prepare("SELECT destroyedAt FROM consent_destructions").all()).toEqual([
      { destroyedAt: "2023-01-01T00:00:00.000Z" },
    ]);
    db.close();
  });
  it("rolls back failed migration without losing legacy rows and safely retries", () => {
    const { path, destructionPath } = legacyJournal();
    const db = new DatabaseSync(destructionPath);
    try {
      db.prepare("INSERT INTO consent_destructions VALUES (?, ?, ?, ?, ?)").run(
        "synthetic-invalid",
        "invalid-timestamp",
        "Данные о согласии Ц1",
        "consent ledger Ц1",
        "истечение операторского срока хранения",
      );
      expect(() => reopen(path)).toThrow();
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
      expect(db.prepare("SELECT count(*) AS count FROM consent_destructions").get()).toEqual({
        count: 2,
      });
      const stateDb = new DatabaseSync(`${path}.destruction-state.sqlite`);
      expect(stateDb.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);
      expect(stateDb.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
      stateDb.close();
      db.prepare("UPDATE consent_destructions SET destroyedAt = ? WHERE consentReceiptId = ?").run(
        "2023-01-01T00:00:00.000Z",
        "synthetic-invalid",
      );
    } finally {
      db.close();
    }
    expect(reopen(path).pendingDestructions()).toHaveLength(2);
  });
  it.each([
    "PRAGMA user_version = 999",
    `CREATE TABLE weakened (
      consentReceiptId TEXT, localDeletedAt TEXT, origin TEXT,
      timing TEXT, completedAt TEXT, completionMethod TEXT
    ) STRICT;
    INSERT INTO weakened SELECT * FROM consent_destruction_state;
    DROP TABLE consent_destruction_state;
    ALTER TABLE weakened RENAME TO consent_destruction_state;`,
    "ALTER TABLE consent_destruction_state ADD COLUMN payload TEXT",
    "CREATE TABLE unrelated (value TEXT)",
    "UPDATE consent_destruction_state SET timing = 'invalid-json'",
    "DELETE FROM consent_destruction_state",
    "UPDATE consent_destruction_state SET localDeletedAt = '2024-01-01T00:00:00.000Z'",
  ])("fails closed for unknown or corrupt migrated state: %s", (mutation) => {
    const { path } = legacyJournal();
    reopen(path).close();
    const db = new DatabaseSync(`${path}.destruction-state.sqlite`);
    db.exec(mutation);
    db.close();
    expect(() => reopen(path)).toThrow();
  });
  it("does not recreate a missing or empty mandatory state file", () => {
    const { ledger, path } = fixture();
    ledger.close();
    rmSync(`${path}.destruction-state.sqlite`);
    expect(() => reopen(path)).toThrow();
    expect(() => statSync(`${path}.destruction-state.sqlite`)).toThrow();
    writeFileSync(`${path}.destruction-state.sqlite`, "");
    expect(() => reopen(path)).toThrow();
  });
  it("rejects unknown legacy markers and unmarked nonempty migration files", () => {
    const { path, destructionPath } = legacyJournal();
    const db = new DatabaseSync(destructionPath);
    db.exec("PRAGMA user_version = 999");
    expect(() => reopen(path)).toThrow();
    expect(() => statSync(`${path}.destruction-state.sqlite`)).toThrow();
    db.exec("PRAGMA user_version = 0");
    db.close();
    const stateDb = new DatabaseSync(`${path}.destruction-state.sqlite`);
    stateDb.exec("CREATE TABLE unrelated (value TEXT)");
    stateDb.close();
    expect(() => reopen(path)).toThrow();
  });
  it("keeps the exact #286 schemas and main version after new deletes and completion", () => {
    const { ledger, path, destructionPath, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [], timing });
    ledger.completeDestruction(receipt.consentReceiptId, {
      backupLifecycleConfirmed: true,
      completedAt: "2023-01-01T00:00:00.000Z",
      completionMethod: "manual-backup-delete",
    });
    ledger.close();
    const db = new DatabaseSync(path, { readOnly: true });
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 286 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: "consent_receipts" },
    ]);
    db.close();
    const journal = new DatabaseSync(destructionPath, { readOnly: true });
    expect(journal.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([
      { name: "consent_destructions" },
    ]);
    expect(
      journal
        .prepare("PRAGMA table_info(consent_destructions)")
        .all()
        .map((column) => [column.name, column.type]),
    ).toEqual([
      ["consentReceiptId", "TEXT"],
      ["destroyedAt", "TEXT"],
      ["dataCategory", "TEXT"],
      ["informationSystem", "TEXT"],
      ["reason", "TEXT"],
    ]);
    expect(journal.prepare("SELECT * FROM consent_destructions").all()).toEqual([]);
    journal.close();
    expect(statSync(`${path}.destruction-state.sqlite`).mode & 0o777).toBe(0o600);
  });
  it("purges legacy evidence only three years after completion, atomically with state", () => {
    const { path, destructionPath } = legacyJournal();
    let now = new Date("2024-02-29T10:00:00.000Z");
    const ledger = new ConsentLedger(path, { now: () => now });
    ledgers.push(ledger);
    ledger.completeDestruction("synthetic-legacy", {
      backupLifecycleConfirmed: true,
      completedAt: now.toISOString(),
      completionMethod: "manual-backup-delete",
      legacyReviewed: true,
      timing,
    });
    now = new Date("2027-02-28T09:59:59.999Z");
    expect(ledger.expiredDestructionEvents()).toEqual([]);
    now = new Date("2027-02-28T10:00:00.000Z");
    const stateDb = new DatabaseSync(`${path}.destruction-state.sqlite`);
    stateDb.exec(
      "CREATE TRIGGER reject_purge BEFORE DELETE ON consent_destruction_state BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    expect(() =>
      ledger.purgeExpiredDestructionEvents({
        holdsReviewed: true,
        documentsArchived: true,
        protectedReceiptIds: [],
      }),
    ).toThrow();
    expect(ledger.destructionEvents()).toHaveLength(1);
    stateDb.exec("DROP TRIGGER reject_purge");
    stateDb.close();
    expect(
      ledger.purgeExpiredDestructionEvents({
        holdsReviewed: true,
        documentsArchived: true,
        protectedReceiptIds: [],
      }),
    ).toHaveLength(1);
    const db = new DatabaseSync(destructionPath, { readOnly: true });
    expect(db.prepare("SELECT * FROM consent_destructions").all()).toEqual([]);
    db.close();
    ledger.close();
    expect(reopen(path).pendingDestructions()).toEqual([]);
  });
});
