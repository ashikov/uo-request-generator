import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { C1_CONSENT_VERSION, consentEvidenceExpiresAt } from "./consent-policy.js";

const receiptFields = {
  consentReceiptId: z.string().min(1),
  requestId: z.string().min(1),
  consentVersion: z.string().min(1),
  serverTimestamp: z.iso.datetime(),
};
const receiptSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...receiptFields,
    status: z.literal("accepted"),
    revocationTimestamp: z.null(),
  }),
  z.strictObject({
    ...receiptFields,
    status: z.literal("revoked"),
    revocationTimestamp: z.iso.datetime(),
  }),
]);
export type ConsentReceipt = {
  consentReceiptId: string;
  requestId: string;
  consentVersion: string;
  serverTimestamp: string;
} & ({ status: "accepted" } | { status: "revoked"; revocationTimestamp: string });

type ConsentLedgerOptions = { now?: () => Date; generateReceiptId?: () => string };

function parseReceipt(value: unknown): ConsentReceipt {
  const receipt = receiptSchema.parse(value);
  if (receipt.status === "revoked") return receipt;
  const { revocationTimestamp: _, ...accepted } = receipt;
  return accepted;
}

export class ConsentLedger {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #generateReceiptId: () => string;
  #closed = false;

  constructor(path: string, options: ConsentLedgerOptions = {}) {
    if (!path || path === ":memory:") throw new Error("Требуется постоянный файл согласий.");
    const descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    closeSync(descriptor);
    chmodSync(path, 0o600);
    this.#database = new DatabaseSync(path);
    this.#now = options.now ?? (() => new Date());
    this.#generateReceiptId = options.generateReceiptId ?? randomUUID;
    try {
      this.#database.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = EXTRA;
        PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS consent_receipts (
          consentReceiptId TEXT PRIMARY KEY NOT NULL,
          requestId TEXT NOT NULL,
          consentVersion TEXT NOT NULL,
          serverTimestamp TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('accepted', 'revoked')),
          revocationTimestamp TEXT,
          CHECK((status = 'accepted' AND revocationTimestamp IS NULL)
            OR (status = 'revoked' AND revocationTimestamp IS NOT NULL))
        ) STRICT;
      `);
      const tables = this.#database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all();
      const columns = this.#database.prepare("PRAGMA table_info(consent_receipts)").all();
      const expectedColumns = [
        "consentReceiptId",
        "requestId",
        "consentVersion",
        "serverTimestamp",
        "status",
        "revocationTimestamp",
      ];
      const table = this.#database
        .prepare(
          "SELECT strict FROM pragma_table_list WHERE name = 'consent_receipts' AND schema = 'main'",
        )
        .get();
      if (
        tables.length !== 1 ||
        tables[0]?.name !== "consent_receipts" ||
        table?.strict !== 1 ||
        columns.length !== expectedColumns.length ||
        columns.some(
          (column, index) => column.name !== expectedColumns[index] || column.type !== "TEXT",
        )
      ) {
        throw new Error("Схема файла согласий не соответствует утверждённому контракту.");
      }
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  accept(requestId: string, consentVersion: string): ConsentReceipt {
    if (consentVersion !== C1_CONSENT_VERSION) throw new Error("Неизвестная версия согласия.");
    const receipt = parseReceipt({
      consentReceiptId: this.#generateReceiptId(),
      requestId,
      consentVersion,
      serverTimestamp: this.#now().toISOString(),
      status: "accepted",
      revocationTimestamp: null,
    });
    this.#transaction(() => {
      const insertion = this.#database
        .prepare(`INSERT INTO consent_receipts
        (consentReceiptId, requestId, consentVersion, serverTimestamp, status)
        VALUES (?, ?, ?, ?, 'accepted')`)
        .run(
          receipt.consentReceiptId,
          receipt.requestId,
          receipt.consentVersion,
          receipt.serverTimestamp,
        );
      const stored = this.find(receipt.consentReceiptId);
      if (
        insertion.changes !== 1 ||
        stored?.status !== "accepted" ||
        stored.requestId !== receipt.requestId ||
        stored.consentVersion !== receipt.consentVersion ||
        stored.serverTimestamp !== receipt.serverTimestamp
      ) {
        throw new Error("Запись согласия не подтверждена.");
      }
    });
    return receipt;
  }

  find(consentReceiptId: string): ConsentReceipt | undefined {
    const row = this.#database
      .prepare("SELECT * FROM consent_receipts WHERE consentReceiptId = ?")
      .get(consentReceiptId);
    return row ? parseReceipt(row) : undefined;
  }

  revoke(consentReceiptId: string): ConsentReceipt | undefined {
    return this.#transaction(() => {
      this.#database
        .prepare(
          "UPDATE consent_receipts SET status = 'revoked', revocationTimestamp = ? WHERE consentReceiptId = ? AND status = 'accepted'",
        )
        .run(this.#now().toISOString(), consentReceiptId);
      return this.find(consentReceiptId);
    });
  }

  expired(protectedReceiptIds: readonly string[] = []): ConsentReceipt[] {
    const protectedIds = new Set(protectedReceiptIds);
    const now = this.#now().toISOString();
    return this.#database
      .prepare("SELECT * FROM consent_receipts ORDER BY consentReceiptId")
      .all()
      .map(parseReceipt)
      .filter(
        (receipt) =>
          !protectedIds.has(receipt.consentReceiptId) && consentEvidenceExpiresAt(receipt) <= now,
      );
  }

  deleteExpired(review: {
    holdsReviewed: boolean;
    protectedReceiptIds: readonly string[];
  }): ConsentReceipt[] {
    if (review.holdsReviewed !== true)
      throw new Error("Требуется проверка оснований продолжения хранения.");
    return this.#transaction(() => {
      const expired = this.expired(review.protectedReceiptIds);
      const remove = this.#database.prepare(
        "DELETE FROM consent_receipts WHERE consentReceiptId = ?",
      );
      for (const receipt of expired) remove.run(receipt.consentReceiptId);
      return expired;
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
