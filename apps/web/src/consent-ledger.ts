import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, openSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  C1_CONSENT_VERSION,
  consentEvidenceExpiresAt,
  threeCalendarYearsAfter,
} from "./consent-policy.js";

const destructionDetails = {
  dataCategory: "Данные о согласии Ц1",
  informationSystem: "consent ledger Ц1",
  reason: "истечение операторского срока хранения",
} as const;
const destructionJournalVersion = 286;
const destructionEventSchema = z.strictObject({
  consentReceiptId: z.string().min(1),
  destroyedAt: z.iso.datetime(),
  dataCategory: z.string().min(1),
  informationSystem: z.string().min(1),
  reason: z.string().min(1),
});
export type ConsentDestructionEvent = z.infer<typeof destructionEventSchema>;

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
        PRAGMA main.journal_mode = DELETE;
        PRAGMA main.synchronous = EXTRA;
        PRAGMA main.secure_delete = ON;
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

      const version = this.#database.prepare("PRAGMA main.user_version").get()?.user_version;
      if (version !== 0 && version !== destructionJournalVersion)
        throw new Error("Неизвестная версия журнала уничтожения.");
      const destructionPath = `${path}.destruction.sqlite`;
      const destructionDescriptor = openSync(
        destructionPath,
        (version === 0 ? constants.O_CREAT : 0) | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600,
      );
      closeSync(destructionDescriptor);
      chmodSync(destructionPath, 0o600);
      this.#database.prepare("ATTACH DATABASE ? AS destruction").run(destructionPath);
      this.#database.exec(`
        PRAGMA destruction.journal_mode = DELETE;
        PRAGMA destruction.synchronous = EXTRA;
        PRAGMA destruction.secure_delete = ON;
      `);
      if (version === 0)
        this.#database.exec(`
        CREATE TABLE IF NOT EXISTS destruction.consent_destructions (
          consentReceiptId TEXT PRIMARY KEY NOT NULL,
          destroyedAt TEXT NOT NULL,
          dataCategory TEXT NOT NULL,
          informationSystem TEXT NOT NULL,
          reason TEXT NOT NULL
        ) STRICT;
      `);
      const destructionTables = this.#database
        .prepare("SELECT name FROM destruction.sqlite_master WHERE type = 'table'")
        .all();
      const destructionColumns = this.#database
        .prepare("PRAGMA destruction.table_info(consent_destructions)")
        .all();
      const destructionTable = this.#database
        .prepare(
          "SELECT strict FROM pragma_table_list WHERE name = 'consent_destructions' AND schema = 'destruction'",
        )
        .get();
      if (
        this.#database.prepare("PRAGMA main.journal_mode").get()?.journal_mode !== "delete" ||
        this.#database.prepare("PRAGMA destruction.journal_mode").get()?.journal_mode !==
          "delete" ||
        this.#database.prepare("PRAGMA main.synchronous").get()?.synchronous !== 3 ||
        this.#database.prepare("PRAGMA destruction.synchronous").get()?.synchronous !== 3 ||
        destructionTables.length !== 1 ||
        destructionTables[0]?.name !== "consent_destructions" ||
        destructionTable?.strict !== 1 ||
        destructionColumns.length !== 5 ||
        destructionColumns.some(
          (column, index) =>
            column.name !==
              ["consentReceiptId", "destroyedAt", "dataCategory", "informationSystem", "reason"][
                index
              ] || column.type !== "TEXT",
        )
      ) {
        throw new Error("Схема журнала уничтожения не соответствует утверждённому контракту.");
      }
      if (version === 0)
        this.#database.exec(`PRAGMA main.user_version = ${destructionJournalVersion}`);
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
      const record = this.#database.prepare(
        `INSERT INTO destruction.consent_destructions
        (consentReceiptId, destroyedAt, dataCategory, informationSystem, reason)
        VALUES (?, ?, ?, ?, ?)`,
      );
      const findEvent = this.#database.prepare(
        "SELECT * FROM destruction.consent_destructions WHERE consentReceiptId = ?",
      );
      for (const receipt of expired) {
        const deletion = remove.run(receipt.consentReceiptId);
        if (deletion.changes !== 1 || this.find(receipt.consentReceiptId))
          throw new Error("Уничтожение записи согласия не подтверждено.");
        const destroyedAt = this.#now().toISOString();
        const insertion = record.run(
          receipt.consentReceiptId,
          destroyedAt,
          destructionDetails.dataCategory,
          destructionDetails.informationSystem,
          destructionDetails.reason,
        );
        const stored = findEvent.get(receipt.consentReceiptId);
        const confirmed = stored ? destructionEventSchema.parse(stored) : undefined;
        if (
          insertion.changes !== 1 ||
          confirmed?.destroyedAt !== destroyedAt ||
          confirmed.dataCategory !== destructionDetails.dataCategory ||
          confirmed.informationSystem !== destructionDetails.informationSystem ||
          confirmed.reason !== destructionDetails.reason
        ) {
          throw new Error("Событие уничтожения не подтверждено.");
        }
      }
      return expired;
    });
  }

  destructionEvents(): ConsentDestructionEvent[] {
    return this.#database
      .prepare(
        "SELECT * FROM destruction.consent_destructions ORDER BY destroyedAt, consentReceiptId",
      )
      .all()
      .map((row) => destructionEventSchema.parse(row));
  }

  expiredDestructionEvents(protectedReceiptIds: readonly string[] = []): ConsentDestructionEvent[] {
    const protectedIds = new Set(protectedReceiptIds);
    const now = this.#now().toISOString();
    return this.destructionEvents().filter(
      (event) =>
        !protectedIds.has(event.consentReceiptId) &&
        threeCalendarYearsAfter(event.destroyedAt) <= now,
    );
  }

  purgeExpiredDestructionEvents(review: {
    holdsReviewed: boolean;
    documentsArchived: boolean;
    protectedReceiptIds: readonly string[];
  }): ConsentDestructionEvent[] {
    if (!review.holdsReviewed || !review.documentsArchived)
      throw new Error("Требуется проверка исключений и сохранности акта и выгрузки.");
    return this.#transaction(() => {
      const expired = this.expiredDestructionEvents(review.protectedReceiptIds);
      const remove = this.#database.prepare(
        "DELETE FROM destruction.consent_destructions WHERE consentReceiptId = ?",
      );
      const findEvent = this.#database.prepare(
        "SELECT 1 FROM destruction.consent_destructions WHERE consentReceiptId = ?",
      );
      for (const event of expired) {
        const deletion = remove.run(event.consentReceiptId);
        if (deletion.changes !== 1 || findEvent.get(event.consentReceiptId))
          throw new Error("Удаление записи журнала уничтожения не подтверждено.");
      }
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
