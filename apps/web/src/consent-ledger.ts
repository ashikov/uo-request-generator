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
const destructionStateVersion = 302;
const destructionStateTableSql = `CREATE TABLE consent_destruction_state (
  consentReceiptId TEXT PRIMARY KEY NOT NULL,
  localDeletedAt TEXT NOT NULL,
  origin TEXT NOT NULL CHECK(origin IN ('local', 'legacy')),
  timing TEXT,
  completedAt TEXT,
  completionMethod TEXT CHECK(completionMethod IN ('rotation', 'manual-backup-delete')),
  CHECK((completedAt IS NULL AND completionMethod IS NULL) OR
    (completedAt IS NOT NULL AND completionMethod IS NOT NULL AND timing IS NOT NULL))
) STRICT`;
const timestampSchema = z.iso.datetime().transform((value) => new Date(value).toISOString());
const destructionEventSchema = z.strictObject({
  consentReceiptId: z.string().min(1),
  destroyedAt: z.iso.datetime(),
  dataCategory: z.string().min(1),
  informationSystem: z.string().min(1),
  reason: z.string().min(1),
});
const destructionTimingSchema = z.discriminatedUnion("backupPlan", [
  z.strictObject({
    triggerAt: timestampSchema,
    deadlineAt: timestampSchema,
    backupPlan: z.literal("rotation"),
    expectedRotationAt: timestampSchema,
    rotationSafetyMarginSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    triggerAt: timestampSchema,
    deadlineAt: timestampSchema,
    backupPlan: z.literal("manual-backup-delete"),
  }),
]);
export type ConsentDestructionTiming = z.infer<typeof destructionTimingSchema>;
const destructionStateSchema = z.strictObject({
  consentReceiptId: z.string().min(1),
  localDeletedAt: timestampSchema,
  origin: z.enum(["local", "legacy"]),
  timing: z.string().nullable(),
  completedAt: timestampSchema.nullable(),
  completionMethod: z.enum(["rotation", "manual-backup-delete"]).nullable(),
});
type DestructionFlowDetails = {
  consentReceiptId: string;
  localDeletedAt: string;
  dataCategory: string;
  informationSystem: string;
  reason: string;
};
export type PendingConsentDestruction = DestructionFlowDetails & {
  status: "pending";
  legacyReviewRequired: boolean;
  timing?: ConsentDestructionTiming;
};
export type ConsentDestructionEvent = DestructionFlowDetails & {
  status: "completed";
  legacyReviewRequired: false;
  timing: ConsentDestructionTiming;
  completedAt: string;
  completionMethod: "rotation" | "manual-backup-delete";
  timely: boolean;
};

function validateDestructionTiming(timing: ConsentDestructionTiming, localDeletedAt: string): void {
  if (timing.triggerAt > localDeletedAt || timing.deadlineAt <= timing.triggerAt)
    throw new Error("Trigger и deadline должны относиться к основанию уничтожения.");
  if (timing.backupPlan === "rotation") {
    const rotationWithMargin =
      Date.parse(timing.expectedRotationAt) + timing.rotationSafetyMarginSeconds * 1000;
    if (
      timing.expectedRotationAt <= localDeletedAt ||
      rotationWithMargin > Date.parse(timing.deadlineAt)
    )
      throw new Error(
        "Rotation не укладывается в deadline с запасом: требуется manual backup delete.",
      );
  }
}

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
      this.#initializeDestructionState(path);
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
    timing: ConsentDestructionTiming;
  }): ConsentReceipt[] {
    if (review.holdsReviewed !== true)
      throw new Error("Требуется проверка оснований продолжения хранения.");
    return this.#transaction(() => {
      const timing = destructionTimingSchema.parse(review.timing);
      const localDeletedAt = this.#now().toISOString();
      validateDestructionTiming(timing, localDeletedAt);
      this.#destructionFlows();
      const expired = this.expired(review.protectedReceiptIds);
      const remove = this.#database.prepare(
        "DELETE FROM consent_receipts WHERE consentReceiptId = ?",
      );
      for (const receipt of expired) {
        const deletion = remove.run(receipt.consentReceiptId);
        if (deletion.changes !== 1 || this.find(receipt.consentReceiptId))
          throw new Error("Уничтожение записи согласия не подтверждено.");
        const stateInsertion = this.#database
          .prepare(`INSERT INTO destruction_state.consent_destruction_state
          (consentReceiptId, localDeletedAt, origin, timing) VALUES (?, ?, 'local', ?)`)
          .run(receipt.consentReceiptId, localDeletedAt, JSON.stringify(timing));
        const pending = this.pendingDestructions().find(
          (flow) => flow.consentReceiptId === receipt.consentReceiptId,
        );
        if (
          stateInsertion.changes !== 1 ||
          pending?.localDeletedAt !== localDeletedAt ||
          JSON.stringify(pending.timing) !== JSON.stringify(timing) ||
          pending.legacyReviewRequired
        )
          throw new Error("Pending evidence локального удаления не подтверждено.");
      }
      return expired;
    });
  }

  destructionEvents(): ConsentDestructionEvent[] {
    return this.#destructionFlows()
      .filter((flow): flow is ConsentDestructionEvent => flow.status === "completed")
      .sort(
        (left, right) =>
          left.completedAt.localeCompare(right.completedAt) ||
          left.consentReceiptId.localeCompare(right.consentReceiptId),
      );
  }

  pendingDestructions(): PendingConsentDestruction[] {
    return this.#destructionFlows().filter(
      (flow): flow is PendingConsentDestruction => flow.status === "pending",
    );
  }

  completeDestruction(
    consentReceiptId: string,
    confirmation: {
      backupLifecycleConfirmed: boolean;
      completedAt: string;
      completionMethod: "rotation" | "manual-backup-delete";
      legacyReviewed?: boolean;
      timing?: ConsentDestructionTiming;
    },
  ): ConsentDestructionEvent {
    const declaration = z
      .strictObject({
        backupLifecycleConfirmed: z.literal(true),
        completedAt: timestampSchema,
        completionMethod: z.enum(["rotation", "manual-backup-delete"]),
        legacyReviewed: z.boolean().optional(),
        timing: destructionTimingSchema.optional(),
      })
      .parse(confirmation);
    return this.#transaction(() => {
      const flow = this.pendingDestructions().find(
        (candidate) => candidate.consentReceiptId === consentReceiptId,
      );
      if (!flow) throw new Error("Pending flow отсутствует или уже завершён.");
      if (
        flow.legacyReviewRequired !== (declaration.legacyReviewed === true) ||
        flow.legacyReviewRequired !== (declaration.timing !== undefined)
      )
        throw new Error("Legacy evidence требует отдельного review и исходных timing inputs.");
      const timing = flow.timing ?? declaration.timing;
      if (!timing) throw new Error("Не определён исходный deadline уничтожения.");
      validateDestructionTiming(timing, flow.localDeletedAt);
      if (
        declaration.completedAt < flow.localDeletedAt ||
        declaration.completedAt > this.#now().toISOString() ||
        (declaration.completionMethod === "rotation" &&
          (declaration.completedAt === flow.localDeletedAt || timing.backupPlan !== "rotation"))
      )
        throw new Error("Недопустимая дата или способ completion.");
      const expected: ConsentDestructionEvent = {
        ...flow,
        status: "completed",
        legacyReviewRequired: false,
        timing,
        completedAt: declaration.completedAt,
        completionMethod: declaration.completionMethod,
        timely: declaration.completedAt <= timing.deadlineAt,
      };
      const update = this.#database
        .prepare(`UPDATE destruction_state.consent_destruction_state
        SET timing = ?, completedAt = ?, completionMethod = ? WHERE consentReceiptId = ? AND completedAt IS NULL`)
        .run(
          JSON.stringify(timing),
          declaration.completedAt,
          declaration.completionMethod,
          consentReceiptId,
        );
      const stored = this.destructionEvents().find(
        (event) => event.consentReceiptId === consentReceiptId,
      );
      if (update.changes !== 1 || JSON.stringify(stored) !== JSON.stringify(expected))
        throw new Error("Completion не подтверждён долговечным состоянием.");
      return expected;
    });
  }

  expiredDestructionEvents(protectedReceiptIds: readonly string[] = []): ConsentDestructionEvent[] {
    const protectedIds = new Set(protectedReceiptIds);
    const now = this.#now().toISOString();
    return this.destructionEvents().filter(
      (event) =>
        !protectedIds.has(event.consentReceiptId) &&
        threeCalendarYearsAfter(event.completedAt) <= now,
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
        // Только migrated legacy flow имеет строку в старом журнале.
        if (findEvent.get(event.consentReceiptId)) {
          const deletion = remove.run(event.consentReceiptId);
          if (deletion.changes !== 1 || findEvent.get(event.consentReceiptId))
            throw new Error("Удаление записи legacy журнала не подтверждено.");
        }
        const stateDeletion = this.#database
          .prepare(
            "DELETE FROM destruction_state.consent_destruction_state WHERE consentReceiptId = ?",
          )
          .run(event.consentReceiptId);
        if (
          stateDeletion.changes !== 1 ||
          this.#database
            .prepare(
              "SELECT 1 FROM destruction_state.consent_destruction_state WHERE consentReceiptId = ?",
            )
            .get(event.consentReceiptId)
        )
          throw new Error("Удаление completion state не подтверждено.");
      }
      return expired;
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#database.close();
    this.#closed = true;
  }

  #initializeDestructionState(path: string): void {
    const marker = this.#database.prepare("PRAGMA destruction.user_version").get()?.user_version;
    if (marker !== 0 && marker !== destructionStateVersion)
      throw new Error("Неизвестная версия destruction state.");
    const statePath = `${path}.destruction-state.sqlite`;
    const descriptor = openSync(
      statePath,
      (marker === 0 ? constants.O_CREAT : 0) | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    closeSync(descriptor);
    chmodSync(statePath, 0o600);
    this.#database.prepare("ATTACH DATABASE ? AS destruction_state").run(statePath);
    this.#database.exec(`PRAGMA destruction_state.journal_mode = DELETE;
      PRAGMA destruction_state.synchronous = EXTRA;
      PRAGMA destruction_state.secure_delete = ON;`);
    if (
      this.#database.prepare("PRAGMA destruction_state.journal_mode").get()?.journal_mode !==
        "delete" ||
      this.#database.prepare("PRAGMA destruction_state.synchronous").get()?.synchronous !== 3
    )
      throw new Error("Недопустимый режим destruction state.");
    // Marker и импорт legacy фиксируются одной транзакцией всех подключённых файлов.
    this.#transaction(() => {
      const currentMarker = this.#database
        .prepare("PRAGMA destruction.user_version")
        .get()?.user_version;
      if (currentMarker === 0) {
        if (
          this.#database.prepare("SELECT name FROM destruction_state.sqlite_master").all()
            .length !== 0 ||
          this.#database.prepare("PRAGMA destruction_state.user_version").get()?.user_version !== 0
        )
          throw new Error("Неизвестное частичное состояние migration.");
        this.#database.exec(
          destructionStateTableSql.replace(
            "CREATE TABLE consent_destruction_state",
            "CREATE TABLE destruction_state.consent_destruction_state",
          ),
        );
        const events = this.#database
          .prepare("SELECT * FROM destruction.consent_destructions")
          .all()
          .map((row) => destructionEventSchema.parse(row));
        for (const event of events)
          this.#database
            .prepare(`INSERT INTO destruction_state.consent_destruction_state
            (consentReceiptId, localDeletedAt, origin) VALUES (?, ?, 'legacy')`)
            .run(event.consentReceiptId, timestampSchema.parse(event.destroyedAt));
        this.#database.exec(`PRAGMA destruction_state.user_version = ${destructionStateVersion};
          PRAGMA destruction.user_version = ${destructionStateVersion};`);
      } else if (currentMarker !== destructionStateVersion) {
        throw new Error("Версия migration изменилась.");
      }
      const tables = this.#database
        .prepare("SELECT name FROM destruction_state.sqlite_master WHERE type = 'table'")
        .all();
      const columns = this.#database
        .prepare("PRAGMA destruction_state.table_info(consent_destruction_state)")
        .all();
      const storedSql = this.#database
        .prepare(
          "SELECT sql FROM destruction_state.sqlite_master WHERE type = 'table' AND name = 'consent_destruction_state'",
        )
        .get()?.sql;
      const expectedColumns = [
        "consentReceiptId",
        "localDeletedAt",
        "origin",
        "timing",
        "completedAt",
        "completionMethod",
      ];
      if (
        this.#database.prepare("PRAGMA destruction_state.user_version").get()?.user_version !==
          destructionStateVersion ||
        tables.length !== 1 ||
        tables[0]?.name !== "consent_destruction_state" ||
        typeof storedSql !== "string" ||
        storedSql.replace(/\s+/g, " ").trim() !==
          destructionStateTableSql.replace(/\s+/g, " ").trim() ||
        this.#database
          .prepare(
            "SELECT strict FROM pragma_table_list WHERE name = 'consent_destruction_state' AND schema = 'destruction_state'",
          )
          .get()?.strict !== 1 ||
        columns.length !== expectedColumns.length ||
        columns.some(
          (column, index) => column.name !== expectedColumns[index] || column.type !== "TEXT",
        )
      )
        throw new Error("Схема destruction state не соответствует контракту.");
      this.#destructionFlows();
    });
  }

  #destructionFlows(): (PendingConsentDestruction | ConsentDestructionEvent)[] {
    const events = this.#database
      .prepare("SELECT * FROM destruction.consent_destructions")
      .all()
      .map((row) => destructionEventSchema.parse(row));
    const states = this.#database
      .prepare(
        "SELECT * FROM destruction_state.consent_destruction_state ORDER BY localDeletedAt, consentReceiptId",
      )
      .all()
      .map((row) => destructionStateSchema.parse(row));
    if (events.length !== states.filter((state) => state.origin === "legacy").length)
      throw new Error("Неполное legacy destruction state.");
    const eventByReceipt = new Map(events.map((event) => [event.consentReceiptId, event]));
    return states.map((state) => {
      const legacy = eventByReceipt.get(state.consentReceiptId);
      if (
        state.origin === "legacy"
          ? !legacy || state.localDeletedAt !== timestampSchema.parse(legacy.destroyedAt)
          : legacy !== undefined
      )
        throw new Error("Несогласованное evidence local delete.");
      const details = legacy ?? { consentReceiptId: state.consentReceiptId, ...destructionDetails };
      const timing =
        state.timing === null ? undefined : destructionTimingSchema.parse(JSON.parse(state.timing));
      if (timing) validateDestructionTiming(timing, state.localDeletedAt);
      else if (state.origin !== "legacy") throw new Error("Timing inputs потеряны.");
      const flow = {
        consentReceiptId: details.consentReceiptId,
        dataCategory: details.dataCategory,
        informationSystem: details.informationSystem,
        reason: details.reason,
        localDeletedAt: state.localDeletedAt,
      };
      if (state.completedAt === null && state.completionMethod === null)
        return {
          ...flow,
          status: "pending",
          legacyReviewRequired: state.origin === "legacy",
          ...(timing ? { timing } : {}),
        };
      if (
        !state.completedAt ||
        !state.completionMethod ||
        !timing ||
        state.completedAt < state.localDeletedAt ||
        (state.completionMethod === "rotation" &&
          (state.completedAt === state.localDeletedAt || timing.backupPlan !== "rotation"))
      )
        throw new Error("Недопустимое completion state.");
      return {
        ...flow,
        status: "completed",
        legacyReviewRequired: false,
        timing,
        completedAt: state.completedAt,
        completionMethod: state.completionMethod,
        timely: state.completedAt <= timing.deadlineAt,
      };
    });
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
