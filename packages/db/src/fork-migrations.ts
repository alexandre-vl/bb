import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DbConnection } from "./connection.js";

export interface ForkMigration {
  tag: string;
  when: number;
  hash: string;
  shape: string;
  statements: string[];
}

export interface ForkMigrationRun {
  migrationsFolder: string;
  migrations: ForkMigration[];
}

interface RecordedForkMigration {
  tag: string;
  hash: string;
  shape: string;
  upstreamCreatedAt: number | null;
}

interface AddedColumn {
  table: string;
  column: string;
  statement: string;
}

interface CreatedIndex {
  index: string;
  table: string;
  columns: string[] | null;
  statement: string;
}

const identifier = String.raw`[\x60"\[]?(\w+)[\x60"\]]?`;
const addColumnPattern = new RegExp(
  String.raw`^\s*ALTER\s+TABLE\s+${identifier}\s+ADD\s+(?:COLUMN\s+)?${identifier}`,
  "i",
);
const createIndexPattern = new RegExp(
  String.raw`^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?${identifier}\s+ON\s+${identifier}\s*\(([^)]*)\)`,
  "i",
);
const createTablePattern = new RegExp(
  String.raw`^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${identifier}`,
  "i",
);
const dropTablePattern = new RegExp(
  String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${identifier}`,
  "gi",
);
const renameTablePattern = new RegExp(
  String.raw`\bALTER\s+TABLE\s+${identifier}\s+RENAME\s+TO\b`,
  "gi",
);
const dropIndexPattern = new RegExp(
  String.raw`\bDROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?${identifier}`,
  "gi",
);
const renameColumnPattern = new RegExp(
  String.raw`\bALTER\s+TABLE\s+${identifier}\s+RENAME\s+(?:COLUMN\s+)?${identifier}\s+TO\b`,
  "gi",
);
const dropColumnPattern = new RegExp(
  String.raw`\bALTER\s+TABLE\s+${identifier}\s+DROP\s+(?:COLUMN\s+)?${identifier}`,
  "gi",
);

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeStatement(statement: string): string {
  return statement
    .split(/('(?:[^']|'')*')/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/--[^\n]*/g, " ")
            .replace(/[`"[\]]/g, "")
            .replace(/\bif\s+(?:not\s+)?exists\b/gi, " ")
            .replace(/\s+/g, " ")
            .toLowerCase(),
    )
    .join("")
    .replace(/[\s;]+$/, "")
    .trim();
}

export function migrationShape(statements: string[]): string {
  return sha256(
    statements
      .map(normalizeStatement)
      .filter((statement) => statement.length > 0)
      .join("\n"),
  );
}

function tableExists(db: DbConnection, table: string): boolean {
  return (
    db.$client
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) !== undefined
  );
}

function indexExists(db: DbConnection, index: string): boolean {
  return (
    db.$client
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(index) !== undefined
  );
}

function tableColumns(
  db: DbConnection,
  table: string,
): { name: string; pk: number }[] {
  return db.$client
    .prepare<[], { name: string; pk: number }>(
      `PRAGMA table_info(${quote(table)})`,
    )
    .all();
}

function columnExists(
  db: DbConnection,
  table: string,
  column: string,
): boolean {
  return tableColumns(db, table).some((info) => info.name === column);
}

function parseForkJournal(value: unknown): { tag: string; when: number }[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("entries" in value) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error("meta/_fork_journal.json must hold an entries array");
  }
  return value.entries.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("tag" in entry) ||
      !("when" in entry) ||
      typeof entry.tag !== "string" ||
      !/^[\w-]+$/.test(entry.tag) ||
      typeof entry.when !== "number"
    ) {
      throw new Error(`Invalid fork journal entry: ${JSON.stringify(entry)}`);
    }
    return { tag: entry.tag, when: entry.when };
  });
}

export function readForkMigrations(migrationsFolder: string): ForkMigration[] {
  const journalPath = join(migrationsFolder, "meta", "_fork_journal.json");
  if (!existsSync(journalPath)) {
    return [];
  }
  return parseForkJournal(JSON.parse(readFileSync(journalPath, "utf8")))
    .map((entry) => {
      const sql = readFileSync(
        join(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
      );
      const statements = sql.split("--> statement-breakpoint");
      return {
        ...entry,
        hash: sha256(sql),
        shape: migrationShape(statements),
        statements,
      };
    })
    .sort((left, right) => left.when - right.when);
}

function ensureForkLedger(db: DbConnection): void {
  db.$client.exec(
    "CREATE TABLE IF NOT EXISTS __fork_migrations (tag TEXT PRIMARY KEY NOT NULL, hash TEXT NOT NULL, shape TEXT NOT NULL, upstream_created_at INTEGER, applied_at INTEGER NOT NULL)",
  );
}

function readRecordedForkMigrations(
  db: DbConnection,
): Map<string, RecordedForkMigration> {
  const rows = db.$client
    .prepare<[], RecordedForkMigration>(
      "SELECT tag, hash, shape, upstream_created_at AS upstreamCreatedAt FROM __fork_migrations",
    )
    .all();
  return new Map(rows.map((row) => [row.tag, row]));
}

function readPendingUpstreamMigrations(
  db: DbConnection,
  migrationsFolder: string,
): MigrationMeta[] {
  const latest =
    db.$client
      .prepare<[], { createdAt: number | null }>(
        "SELECT MAX(created_at) AS createdAt FROM __drizzle_migrations",
      )
      .get()?.createdAt ?? null;
  return readMigrationFiles({ migrationsFolder }).filter(
    (migration) => latest === null || Number(latest) < migration.folderMillis,
  );
}

function addedColumns(statements: string[]): AddedColumn[] {
  return statements.flatMap((statement) => {
    const match = addColumnPattern.exec(statement);
    return match ? [{ table: match[1], column: match[2], statement }] : [];
  });
}

function createdIndexes(statements: string[]): CreatedIndex[] {
  return statements.flatMap((statement) => {
    const match = createIndexPattern.exec(statement);
    if (!match) {
      return [];
    }
    const columns = match[3].split(",").map((part) => {
      const name = /^\s*[`"[]?(\w+)[`"\]]?(?:\s+(?:ASC|DESC))?\s*$/i.exec(part);
      return name ? name[1] : null;
    });
    return [
      {
        index: match[1],
        table: match[2],
        columns: columns.every((column) => column !== null)
          ? (columns as string[])
          : null,
        statement,
      },
    ];
  });
}

function tablesRemovedBy(statements: string[]): Set<string> {
  return new Set(
    statements.flatMap((statement) => [
      ...[...statement.matchAll(dropTablePattern)].map((match) => match[1]),
      ...[...statement.matchAll(renameTablePattern)].map((match) => match[1]),
    ]),
  );
}

function columnsRemovedBy(statements: string[]): Set<string> {
  return new Set(
    statements.flatMap((statement) =>
      [
        ...statement.matchAll(dropColumnPattern),
        ...statement.matchAll(renameColumnPattern),
      ].map((match) => `${match[1]}.${match[2]}`),
    ),
  );
}

function indexesDroppedBy(statements: string[]): Set<string> {
  return new Set(
    statements.flatMap((statement) =>
      [...statement.matchAll(dropIndexPattern)].map((match) => match[1]),
    ),
  );
}

function savedColumnTable(column: AddedColumn): string {
  return `__fork_saved_column__${column.table}__${column.column}`;
}

function primaryKey(db: DbConnection, table: string): string[] {
  return tableColumns(db, table)
    .filter((info) => info.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((info) => info.name);
}

function saveColumn(db: DbConnection, column: AddedColumn): void {
  const keys = primaryKey(db, column.table);
  if (keys.length === 0) {
    return;
  }
  const copy = quote(savedColumnTable(column));
  db.$client.exec(`DROP TABLE IF EXISTS ${copy}`);
  db.$client.exec(
    `CREATE TABLE ${copy} AS SELECT ${[...keys, column.column]
      .map(quote)
      .join(", ")} FROM ${quote(column.table)}`,
  );
}

function putColumnBack(db: DbConnection, column: AddedColumn): void {
  if (
    !tableExists(db, column.table) ||
    columnExists(db, column.table, column.column)
  ) {
    return;
  }
  db.$client.exec(column.statement);
  const copyName = savedColumnTable(column);
  if (!tableExists(db, copyName)) {
    return;
  }
  const keys = tableColumns(db, copyName)
    .map((info) => info.name)
    .filter((name) => name !== column.column);
  if (
    keys.length === 0 ||
    !keys.every((key) => columnExists(db, column.table, key))
  ) {
    return;
  }
  const copy = quote(copyName);
  const match = keys
    .map(
      (key) => `${copy}.${quote(key)} = ${quote(column.table)}.${quote(key)}`,
    )
    .join(" AND ");
  db.$client.exec(
    `UPDATE ${quote(column.table)} SET ${quote(column.column)} = (SELECT ${copy}.${quote(column.column)} FROM ${copy} WHERE ${match}) WHERE EXISTS (SELECT 1 FROM ${copy} WHERE ${match})`,
  );
}

function dropSavedColumnIfBack(db: DbConnection, column: AddedColumn): void {
  const copyName = savedColumnTable(column);
  if (
    tableExists(db, copyName) &&
    tableExists(db, column.table) &&
    columnExists(db, column.table, column.column)
  ) {
    db.$client.exec(`DROP TABLE ${quote(copyName)}`);
  }
}

function putIndexBack(db: DbConnection, index: CreatedIndex): void {
  if (
    index.columns === null ||
    !tableExists(db, index.table) ||
    indexExists(db, index.index) ||
    !index.columns.every((column) => columnExists(db, index.table, column))
  ) {
    return;
  }
  db.$client.exec(index.statement);
}

function ensureEffects(db: DbConnection, statements: string[]): void {
  const removed = tablesRemovedBy(statements);
  for (const statement of statements) {
    const table = createTablePattern.exec(statement);
    if (table && !removed.has(table[1]) && !tableExists(db, table[1])) {
      db.$client.exec(statement);
    }
  }
  for (const column of addedColumns(statements)) {
    putColumnBack(db, column);
    dropSavedColumnIfBack(db, column);
  }
  for (const index of createdIndexes(statements)) {
    putIndexBack(db, index);
  }
}

export function prepareForkMigrations(
  db: DbConnection,
  migrationsFolder: string,
): ForkMigrationRun {
  const run = {
    migrationsFolder,
    migrations: readForkMigrations(migrationsFolder),
  };
  if (
    !tableExists(db, "__fork_migrations") ||
    !tableExists(db, "__drizzle_migrations")
  ) {
    return run;
  }
  const recorded = readRecordedForkMigrations(db);
  for (const migration of run.migrations) {
    const applied = recorded.get(migration.tag);
    if (applied !== undefined && applied.hash !== migration.hash) {
      throw new Error(
        `Fork migration ${migration.tag} changed after it was applied. Restore the applied version and put the change in a new migration.`,
      );
    }
  }
  const forkHashes = new Set([...recorded.values()].map((row) => row.hash));
  const forkShapes = new Set([...recorded.values()].map((row) => row.shape));
  const pending = readPendingUpstreamMigrations(db, migrationsFolder);
  const isForkEquivalent = (migration: MigrationMeta) =>
    forkHashes.has(migration.hash) ||
    forkShapes.has(migrationShape(migration.sql));
  const removed = tablesRemovedBy(
    pending
      .filter((migration) => !isForkEquivalent(migration))
      .flatMap((migration) => migration.sql),
  );
  const forkColumns = addedColumns([
    ...run.migrations
      .filter((migration) => recorded.has(migration.tag))
      .flatMap((migration) => migration.statements),
    ...pending.filter(isForkEquivalent).flatMap((migration) => migration.sql),
  ]);
  for (const column of forkColumns) {
    if (
      removed.has(column.table) &&
      tableExists(db, column.table) &&
      columnExists(db, column.table, column.column)
    ) {
      saveColumn(db, column);
    }
  }
  let last = -1;
  pending.forEach((migration, index) => {
    if (isForkEquivalent(migration)) {
      last = index;
    }
  });
  if (last === -1) {
    return run;
  }
  const record = db.$client.prepare<[string, number]>(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  db.$client.transaction(() => {
    for (const migration of pending.slice(0, last + 1)) {
      if (isForkEquivalent(migration)) {
        ensureEffects(db, migration.sql);
      } else {
        for (const statement of migration.sql) {
          db.$client.exec(statement);
        }
      }
      record.run(migration.hash, migration.folderMillis);
    }
  })();
  return run;
}

function repairForkSchema(db: DbConnection, run: ForkMigrationRun): void {
  const recorded = readRecordedForkMigrations(db);
  const appliedUpstream = readAppliedUpstreamMigrations(db, run);
  const adoptedHashes = new Set(
    appliedUpstream.map((migration) => migration.hash),
  );
  const adoptedShapes = new Set(
    appliedUpstream.map((migration) => migrationShape(migration.sql)),
  );
  const removedTables = tablesRemovedBy(
    run.migrations.flatMap((migration) => migration.statements),
  );
  const columns: AddedColumn[] = [];
  const indexes: CreatedIndex[] = [];
  for (const migration of run.migrations) {
    const row = recorded.get(migration.tag);
    if (
      row === undefined ||
      adoptedHashes.has(migration.hash) ||
      adoptedShapes.has(migration.shape)
    ) {
      continue;
    }
    const later = [
      ...run.migrations
        .filter((other) => other.when > migration.when)
        .flatMap((other) => other.statements),
      ...appliedUpstream
        .filter(
          (upstream) =>
            row.upstreamCreatedAt === null ||
            upstream.folderMillis > row.upstreamCreatedAt,
        )
        .flatMap((upstream) => upstream.sql),
    ];
    const removedColumns = columnsRemovedBy(later);
    const droppedIndexes = indexesDroppedBy(later);
    columns.push(
      ...addedColumns(migration.statements).filter(
        (column) =>
          !removedTables.has(column.table) &&
          !removedColumns.has(`${column.table}.${column.column}`),
      ),
    );
    indexes.push(
      ...createdIndexes(migration.statements).filter(
        (index) =>
          !removedTables.has(index.table) && !droppedIndexes.has(index.index),
      ),
    );
  }
  db.$client.transaction(() => {
    for (const column of columns) {
      putColumnBack(db, column);
      dropSavedColumnIfBack(db, column);
    }
    for (const index of indexes) {
      putIndexBack(db, index);
    }
  })();
}

function readAppliedUpstreamMigrations(
  db: DbConnection,
  run: ForkMigrationRun,
): MigrationMeta[] {
  const applied = new Set(
    db.$client
      .prepare<[], { createdAt: number | null }>(
        "SELECT created_at AS createdAt FROM __drizzle_migrations",
      )
      .all()
      .map((row) => Number(row.createdAt)),
  );
  return readMigrationFiles({ migrationsFolder: run.migrationsFolder }).filter(
    (migration) => applied.has(migration.folderMillis),
  );
}

export function applyForkMigrations(
  db: DbConnection,
  run: ForkMigrationRun,
): void {
  if (run.migrations.length === 0) {
    return;
  }
  ensureForkLedger(db);
  repairForkSchema(db, run);
  const recorded = readRecordedForkMigrations(db);
  const upstream = readAppliedUpstreamMigrations(db, run);
  const knownHashes = new Set([
    ...[...recorded.values()].map((row) => row.hash),
    ...upstream.map((migration) => migration.hash),
  ]);
  const knownShapes = new Set([
    ...[...recorded.values()].map((row) => row.shape),
    ...upstream.map((migration) => migrationShape(migration.sql)),
  ]);
  const upstreamCreatedAt =
    db.$client
      .prepare<[], { createdAt: number | null }>(
        "SELECT MAX(created_at) AS createdAt FROM __drizzle_migrations",
      )
      .get()?.createdAt ?? null;
  const record = db.$client.prepare<
    [string, string, string, number | null, number]
  >(
    "INSERT INTO __fork_migrations (tag, hash, shape, upstream_created_at, applied_at) VALUES (?, ?, ?, ?, ?)",
  );
  db.$client.transaction(() => {
    for (const migration of run.migrations) {
      if (recorded.has(migration.tag)) {
        continue;
      }
      if (knownHashes.has(migration.hash) || knownShapes.has(migration.shape)) {
        ensureEffects(db, migration.statements);
      } else {
        for (const statement of migration.statements) {
          db.$client.exec(statement);
        }
      }
      knownHashes.add(migration.hash);
      knownShapes.add(migration.shape);
      record.run(
        migration.tag,
        migration.hash,
        migration.shape,
        upstreamCreatedAt === null ? null : Number(upstreamCreatedAt),
        Date.now(),
      );
    }
  })();
}
