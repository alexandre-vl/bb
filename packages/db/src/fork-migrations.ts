import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DbConnection } from "./connection.js";

export interface ForkMigration {
  tag: string;
  when: number;
  hash: string;
  statements: string[];
}

interface AddedColumn {
  table: string;
  column: string;
  statement: string;
}

interface CreatedIndex {
  index: string;
  table: string;
  statement: string;
}

interface DroppedColumn extends AddedColumn {
  keys: string[];
  copy: string | null;
}

export interface ForkMigrationRun {
  migrations: ForkMigration[];
  droppedColumns: DroppedColumn[];
  droppedIndexes: CreatedIndex[];
}

const addColumnPattern =
  /^\s*ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+ADD\s+(?:COLUMN\s+)?[`"[]?(\w+)[`"\]]?/i;
const createIndexPattern =
  /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s+ON\s+[`"[]?(\w+)[`"\]]?/i;
const dropTablePattern =
  /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?/gi;

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
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

function columnExists(db: DbConnection, table: string, column: string): boolean {
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
      return {
        ...entry,
        hash: createHash("sha256").update(sql).digest("hex"),
        statements: sql.split("--> statement-breakpoint"),
      };
    })
    .sort((left, right) => left.when - right.when);
}

function readRecordedForkMigrations(db: DbConnection): Map<string, string> {
  const rows = db.$client
    .prepare<[], { tag: string; hash: string }>(
      "SELECT tag, hash FROM __fork_migrations",
    )
    .all();
  return new Map(rows.map((row) => [row.tag, row.hash]));
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

function addedColumns(migrations: ForkMigration[]): AddedColumn[] {
  return migrations.flatMap((migration) =>
    migration.statements.flatMap((statement) => {
      const match = addColumnPattern.exec(statement);
      return match ? [{ table: match[1], column: match[2], statement }] : [];
    }),
  );
}

function createdIndexes(migrations: ForkMigration[]): CreatedIndex[] {
  return migrations.flatMap((migration) =>
    migration.statements.flatMap((statement) => {
      const match = createIndexPattern.exec(statement);
      return match ? [{ index: match[1], table: match[2], statement }] : [];
    }),
  );
}

function tablesDroppedBy(pending: MigrationMeta[]): Set<string> {
  return new Set(
    pending.flatMap((migration) =>
      migration.sql.flatMap((statement) =>
        [...statement.matchAll(dropTablePattern)].map((match) => match[1]),
      ),
    ),
  );
}

function saveColumn(
  db: DbConnection,
  column: AddedColumn,
  position: number,
): DroppedColumn {
  const keys = tableColumns(db, column.table)
    .filter((info) => info.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((info) => info.name);
  if (keys.length === 0) {
    return { ...column, keys, copy: null };
  }
  const copy = `__fork_dropped_column_${position}`;
  db.$client.exec(`DROP TABLE IF EXISTS temp.${copy}`);
  db.$client.exec(
    `CREATE TEMP TABLE ${copy} AS SELECT ${[...keys, column.column]
      .map(quote)
      .join(", ")} FROM ${quote(column.table)}`,
  );
  return { ...column, keys, copy };
}

function applyUpstreamMigrationsTheForkRan(
  db: DbConnection,
  pending: MigrationMeta[],
  forkHashes: Set<string>,
): void {
  let last = -1;
  pending.forEach((migration, index) => {
    if (forkHashes.has(migration.hash)) {
      last = index;
    }
  });
  if (last === -1) {
    return;
  }
  const record = db.$client.prepare<[string, number]>(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  db.$client.transaction(() => {
    for (const migration of pending.slice(0, last + 1)) {
      if (!forkHashes.has(migration.hash)) {
        for (const statement of migration.sql) {
          db.$client.exec(statement);
        }
      }
      record.run(migration.hash, migration.folderMillis);
    }
  })();
}

export function prepareForkMigrations(
  db: DbConnection,
  migrationsFolder: string,
): ForkMigrationRun {
  const migrations = readForkMigrations(migrationsFolder);
  if (
    !tableExists(db, "__fork_migrations") ||
    !tableExists(db, "__drizzle_migrations")
  ) {
    return { migrations, droppedColumns: [], droppedIndexes: [] };
  }
  const recorded = readRecordedForkMigrations(db);
  for (const migration of migrations) {
    const hash = recorded.get(migration.tag);
    if (hash !== undefined && hash !== migration.hash) {
      throw new Error(
        `Fork migration ${migration.tag} changed after it was applied. Restore the applied version and put the change in a new migration.`,
      );
    }
  }
  const pending = readPendingUpstreamMigrations(db, migrationsFolder);
  const dropped = tablesDroppedBy(pending);
  const applied = migrations.filter((migration) => recorded.has(migration.tag));
  const droppedColumns = addedColumns(applied)
    .filter(
      (column) =>
        dropped.has(column.table) &&
        columnExists(db, column.table, column.column),
    )
    .map((column, position) => saveColumn(db, column, position));
  const droppedIndexes = createdIndexes(applied).filter(
    (index) => dropped.has(index.table) && indexExists(db, index.index),
  );
  applyUpstreamMigrationsTheForkRan(db, pending, new Set(recorded.values()));
  return { migrations, droppedColumns, droppedIndexes };
}

function restoreDroppedForkSchema(
  db: DbConnection,
  run: ForkMigrationRun,
): void {
  for (const column of run.droppedColumns) {
    if (
      tableExists(db, column.table) &&
      !columnExists(db, column.table, column.column)
    ) {
      db.$client.exec(column.statement);
      if (column.copy !== null) {
        const copy = column.copy;
        const match = column.keys
          .map(
            (key) =>
              `${copy}.${quote(key)} = ${quote(column.table)}.${quote(key)}`,
          )
          .join(" AND ");
        db.$client.exec(
          `UPDATE ${quote(column.table)} SET ${quote(column.column)} = (SELECT ${copy}.${quote(column.column)} FROM ${copy} WHERE ${match}) WHERE EXISTS (SELECT 1 FROM ${copy} WHERE ${match})`,
        );
      }
    }
    if (column.copy !== null) {
      db.$client.exec(`DROP TABLE temp.${column.copy}`);
    }
  }
  for (const index of run.droppedIndexes) {
    if (tableExists(db, index.table) && !indexExists(db, index.index)) {
      db.$client.exec(index.statement);
    }
  }
}

export function applyForkMigrations(
  db: DbConnection,
  run: ForkMigrationRun,
): void {
  if (run.migrations.length === 0) {
    return;
  }
  db.$client.exec(
    "CREATE TABLE IF NOT EXISTS __fork_migrations (tag TEXT PRIMARY KEY NOT NULL, hash TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const recorded = readRecordedForkMigrations(db);
  const known = new Set([
    ...recorded.values(),
    ...db.$client
      .prepare<[], { hash: string }>("SELECT hash FROM __drizzle_migrations")
      .all()
      .map((row) => row.hash),
  ]);
  const record = db.$client.prepare<[string, string, number]>(
    "INSERT INTO __fork_migrations (tag, hash, applied_at) VALUES (?, ?, ?)",
  );
  db.$client.transaction(() => {
    for (const migration of run.migrations) {
      if (recorded.has(migration.tag)) {
        continue;
      }
      if (!known.has(migration.hash)) {
        for (const statement of migration.statements) {
          db.$client.exec(statement);
        }
        known.add(migration.hash);
      }
      record.run(migration.tag, migration.hash, Date.now());
    }
    restoreDroppedForkSchema(db, run);
  })();
}
