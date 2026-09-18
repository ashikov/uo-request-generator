import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ConsentLedger } from "../src/consent-ledger.js";
import { C1_CONSENT_VERSION, consentEvidenceExpiresAt } from "../src/consent-policy.js";

const directories: string[] = [];
const ledgers: ConsentLedger[] = [];
function fixture(now = "2026-09-15T12:00:00.000Z") {
  const directory = mkdtempSync(join(tmpdir(), "consent-test-"));
  directories.push(directory);
  const path = join(directory, "ledger.sqlite");
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
    const { ledger, path } = fixture();
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
      { name: "consent_destructions" },
    ]);
    db.close();
  });
  it("adds the destruction journal to an existing receipt ledger without changing receipts", () => {
    const { ledger, path } = fixture();
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    ledger.close();
    const oldDatabase = new DatabaseSync(path);
    oldDatabase.exec("DROP TABLE consent_destructions");
    oldDatabase.close();
    const reopened = new ConsentLedger(path);
    ledgers.push(reopened);
    expect(reopened.find(receipt.consentReceiptId)).toEqual(receipt);
    expect(reopened.destructionEvents()).toEqual([]);
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
    expect(() => ledger.deleteExpired({ holdsReviewed: false, protectedReceiptIds: [] })).toThrow();
    expect(
      ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [held.consentReceiptId] }),
    ).toEqual([expired]);
    expect(ledger.find(expired.consentReceiptId)).toBeUndefined();
    expect(ledger.find(held.consentReceiptId)).toEqual(held);
    expect(ledger.find(revoked.consentReceiptId)?.status).toBe("revoked");
    expect(readFileSync(path).includes(Buffer.from("synthetic-expired"))).toBe(false);
  });
  it("keeps a minimal destruction event after deleting an expired receipt and does not duplicate it", () => {
    const { ledger, path, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const expired = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    const held = ledger.accept("synthetic-held", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    expect(
      ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [held.consentReceiptId] }),
    ).toEqual([expired]);
    expect(ledger.find(expired.consentReceiptId)).toBeUndefined();
    expect(ledger.find(held.consentReceiptId)).toEqual(held);
    expect(ledger.destructionEvents()).toEqual([
      {
        consentReceiptId: expired.consentReceiptId,
        destroyedAt: "2023-01-01T00:00:00.000Z",
        dataCategory: "Данные о согласии Ц1",
        informationSystem: "consent ledger Ц1",
        reason: "истечение операторского срока хранения",
      },
    ]);
    expect(ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [] })).toEqual([held]);
    expect(ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [] })).toEqual([]);
    ledger.close();
    const reopened = new ConsentLedger(path);
    ledgers.push(reopened);
    expect(reopened.destructionEvents().map((event) => event.consentReceiptId)).toEqual([
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
    expect(
      db
        .prepare("PRAGMA table_info(consent_destructions)")
        .all()
        .map((column) => column.name),
    ).toEqual(["consentReceiptId", "destroyedAt", "dataCategory", "informationSystem", "reason"]);
    db.close();
  });
  it("retains destruction events for three calendar years and requires archive review before removal", () => {
    const { ledger, setTime } = fixture("2021-02-28T10:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2024-02-29T10:00:00.000Z");
    ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [] });
    setTime("2027-02-28T09:59:59.999Z");
    expect(ledger.expiredDestructionEvents()).toEqual([]);
    expect(() =>
      ledger.purgeExpiredDestructionEvents({
        documentsArchived: false,
        holdsReviewed: true,
        protectedReceiptIds: [],
      }),
    ).toThrow();
    setTime("2027-02-28T10:00:00.000Z");
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
    "CREATE TRIGGER ignore_delete BEFORE DELETE ON consent_receipts BEGIN SELECT RAISE(IGNORE); END",
    "CREATE TRIGGER restore_delete AFTER DELETE ON consent_receipts BEGIN INSERT INTO consent_receipts VALUES (OLD.consentReceiptId, OLD.requestId, OLD.consentVersion, OLD.serverTimestamp, OLD.status, OLD.revocationTimestamp); END",
    "CREATE TRIGGER reject_event BEFORE INSERT ON consent_destructions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    "CREATE TRIGGER ignore_event BEFORE INSERT ON consent_destructions BEGIN SELECT RAISE(IGNORE); END",
  ])("rolls back deletion without a false event when destruction cannot complete: %s", (trigger) => {
    const { ledger, path, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    const db = new DatabaseSync(path);
    try {
      db.exec(trigger);
      expect(() =>
        ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [] }),
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
    const db = new DatabaseSync(path);
    try {
      db.exec(
        "CREATE TRIGGER reject_second_event BEFORE INSERT ON consent_destructions WHEN NEW.consentReceiptId = 'synthetic-receipt-2' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
      );
      expect(() =>
        ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [] }),
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
    ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [] });
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
    "CREATE TRIGGER ignore_event_delete BEFORE DELETE ON consent_destructions BEGIN SELECT RAISE(IGNORE); END",
    "CREATE TRIGGER restore_event_delete AFTER DELETE ON consent_destructions BEGIN INSERT INTO consent_destructions VALUES (OLD.consentReceiptId, OLD.destroyedAt, OLD.dataCategory, OLD.informationSystem, OLD.reason); END",
  ])("does not report journal removal when the event remains: %s", (trigger) => {
    const { ledger, path, setTime } = fixture("2020-01-01T00:00:00.000Z");
    const receipt = ledger.accept("synthetic-request", C1_CONSENT_VERSION);
    setTime("2023-01-01T00:00:00.000Z");
    ledger.deleteExpired({ holdsReviewed: true, protectedReceiptIds: [] });
    setTime("2026-01-01T00:00:00.000Z");
    const db = new DatabaseSync(path);
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
