import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { DbConnection } from "../src/connection.js";
import {
  applyForkMigrations,
  prepareForkMigrations,
} from "../src/fork-migrations.js";
import { createMigratedConnection } from "../src/testing.js";

const upstreamFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const widgetsSql =
  "CREATE TABLE `fork_widgets` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n--> statement-breakpoint\nALTER TABLE `projects` ADD `fork_flag` integer DEFAULT 0 NOT NULL;";

const tempDirs: string[] = [];
const connections: DbConnection[] = [];

afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

function openDatabase(): DbConnection {
  const db = createMigratedConnection();
  connections.push(db);
  return db;
}

function copyMigrations(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "bb-fork-migrations-"));
  tempDirs.push(folder);
  fs.cpSync(upstreamFolder, folder, {
    recursive: true,
    filter: (source) => !source.endsWith("_snapshot.json"),
  });
  return folder;
}

function writeForkJournal(
  folder: string,
  migrations: { tag: string; when: number; sql: string }[],
): void {
  for (const migration of migrations) {
    fs.writeFileSync(path.join(folder, `${migration.tag}.sql`), migration.sql);
  }
  fs.writeFileSync(
    path.join(folder, "meta", "_fork_journal.json"),
    JSON.stringify({
      entries: migrations.map(({ tag, when }) => ({ tag, when })),
    }),
  );
}

function appendUpstreamMigration(
  folder: string,
  tag: string,
  sql: string,
): void {
  const journalPath = path.join(folder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const last = journal.entries.at(-1);
  journal.entries.push({
    idx: last.idx + 1,
    version: last.version,
    when: last.when + 1_000,
    tag,
    breakpoints: true,
  });
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  fs.writeFileSync(path.join(folder, `${tag}.sql`), sql);
}

function migrateWith(db: DbConnection, folder: string): void {
  const run = prepareForkMigrations(db, folder);
  drizzleMigrate(db, { migrationsFolder: folder });
  applyForkMigrations(db, run);
}

function count(db: DbConnection, table: string): number {
  return (
    db.$client
      .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
      .get()?.count ?? 0
  );
}

function testForkTags(db: DbConnection): string[] {
  return db.$client
    .prepare<[], { tag: string }>(
      "SELECT tag FROM __fork_migrations WHERE tag LIKE '900%' ORDER BY tag",
    )
    .all()
    .map((row) => row.tag);
}

function columns(db: DbConnection, table: string): string[] {
  return db.$client
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => column.name);
}

it("applies fork migrations once, after upstream ones, outside drizzle's ledger", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  writeForkJournal(folder, [
    { tag: "9001_test_fork_widgets", when: 1, sql: widgetsSql },
  ]);
  const upstreamApplied = count(db, "__drizzle_migrations");

  migrateWith(db, folder);
  migrateWith(db, folder);

  expect(columns(db, "fork_widgets")).toEqual(["id"]);
  expect(columns(db, "projects")).toContain("fork_flag");
  expect(count(db, "__drizzle_migrations")).toBe(upstreamApplied);
  expect(testForkTags(db)).toEqual(["9001_test_fork_widgets"]);
});

it("refuses a fork migration whose SQL changed after it was applied", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  writeForkJournal(folder, [
    { tag: "9001_test_fork_widgets", when: 1, sql: widgetsSql },
  ]);
  migrateWith(db, folder);

  writeForkJournal(folder, [
    {
      tag: "9001_test_fork_widgets",
      when: 1,
      sql: widgetsSql.replace("DEFAULT 0", "DEFAULT 1"),
    },
  ]);

  expect(() => prepareForkMigrations(db, folder)).toThrow(
    /Fork migration 9001_test_fork_widgets changed after it was applied/,
  );
});

it("records a renumbered fork migration without running it again", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  writeForkJournal(folder, [
    { tag: "9001_test_fork_widgets", when: 1, sql: widgetsSql },
  ]);
  migrateWith(db, folder);

  writeForkJournal(folder, [
    { tag: "9002_test_fork_widgets", when: 2, sql: widgetsSql },
  ]);
  migrateWith(db, folder);

  expect(testForkTags(db)).toEqual([
    "9001_test_fork_widgets",
    "9002_test_fork_widgets",
  ]);
});

it("records an upstream migration with the SQL of an applied fork migration without running it, and runs the upstream ones before it", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  writeForkJournal(folder, [
    { tag: "9001_test_fork_widgets", when: 1, sql: widgetsSql },
  ]);
  migrateWith(db, folder);
  const upstreamApplied = count(db, "__drizzle_migrations");

  appendUpstreamMigration(
    folder,
    "0147_upstream_gadgets",
    "CREATE TABLE `upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
  );
  appendUpstreamMigration(folder, "0148_merged_widgets", widgetsSql);
  writeForkJournal(folder, []);
  migrateWith(db, folder);

  expect(columns(db, "upstream_gadgets")).toEqual(["id"]);
  expect(count(db, "__drizzle_migrations")).toBe(upstreamApplied + 2);
});

it("records a fork migration an upstream migration already ran without running it", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  appendUpstreamMigration(folder, "0147_merged_widgets", widgetsSql);
  writeForkJournal(folder, [
    { tag: "9001_test_fork_widgets", when: 1, sql: widgetsSql },
  ]);

  migrateWith(db, folder);

  expect(columns(db, "projects")).toContain("fork_flag");
  expect(testForkTags(db)).toEqual(["9001_test_fork_widgets"]);
});

it("puts back a fork column and index an upstream table rebuild drops, with the column's values", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  appendUpstreamMigration(
    folder,
    "0147_upstream_gadgets",
    "CREATE TABLE `upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL\n);\n",
  );
  writeForkJournal(folder, [
    {
      tag: "9001_test_fork_gadget_notes",
      when: 1,
      sql: "ALTER TABLE `upstream_gadgets` ADD `fork_note` text;--> statement-breakpoint\nCREATE INDEX `upstream_gadgets_fork_note_idx` ON `upstream_gadgets` (`fork_note`);",
    },
  ]);
  migrateWith(db, folder);
  db.$client.exec(
    "INSERT INTO upstream_gadgets (id, name, fork_note) VALUES ('a', 'A', 'kept'), ('b', 'B', NULL)",
  );

  appendUpstreamMigration(
    folder,
    "0148_upstream_gadgets_rebuild",
    [
      "PRAGMA foreign_keys=OFF;",
      "CREATE TABLE `__new_upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`name` text NOT NULL,\n\t`rank` integer DEFAULT 0 NOT NULL\n);\n",
      'INSERT INTO `__new_upstream_gadgets`("id", "name") SELECT "id", "name" FROM `upstream_gadgets`;',
      "DROP TABLE `upstream_gadgets`;",
      "ALTER TABLE `__new_upstream_gadgets` RENAME TO `upstream_gadgets`;",
      "PRAGMA foreign_keys=ON;",
    ].join("--> statement-breakpoint\n"),
  );
  migrateWith(db, folder);

  expect(columns(db, "upstream_gadgets")).toEqual([
    "id",
    "name",
    "rank",
    "fork_note",
  ]);
  expect(
    db.$client
      .prepare("SELECT id, fork_note FROM upstream_gadgets ORDER BY id")
      .all(),
  ).toEqual([
    { id: "a", fork_note: "kept" },
    { id: "b", fork_note: null },
  ]);
  expect(
    db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'upstream_gadgets_fork_note_idx'",
      )
      .all(),
  ).toHaveLength(1);
});

it("keeps a fork column's values when a later fork migration fails in the same start", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  appendUpstreamMigration(
    folder,
    "0147_upstream_gadgets",
    "CREATE TABLE `upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
  );
  const notes = {
    tag: "9001_test_fork_gadget_notes",
    when: 1,
    sql: "ALTER TABLE `upstream_gadgets` ADD `fork_note` text;",
  };
  writeForkJournal(folder, [notes]);
  migrateWith(db, folder);
  db.$client.exec(
    "INSERT INTO upstream_gadgets (id, fork_note) VALUES ('a', 'kept')",
  );

  appendUpstreamMigration(
    folder,
    "0148_upstream_gadgets_rebuild",
    [
      "CREATE TABLE `__new_upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
      'INSERT INTO `__new_upstream_gadgets`("id") SELECT "id" FROM `upstream_gadgets`;',
      "DROP TABLE `upstream_gadgets`;",
      "ALTER TABLE `__new_upstream_gadgets` RENAME TO `upstream_gadgets`;",
    ].join("--> statement-breakpoint\n"),
  );
  writeForkJournal(folder, [
    notes,
    {
      tag: "9002_test_fork_broken",
      when: 2,
      sql: "CREATE INDEX `broken_idx` ON `missing_table` (`id`);",
    },
  ]);
  expect(() => migrateWith(db, folder)).toThrow(/no such table/);

  writeForkJournal(folder, [notes]);
  migrateWith(db, folder);

  expect(
    db.$client.prepare("SELECT id, fork_note FROM upstream_gadgets").all(),
  ).toEqual([{ id: "a", fork_note: "kept" }]);
});

it("puts back a fork column an upstream migration rebuilt away, once its pull request merged upstream", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  appendUpstreamMigration(
    folder,
    "0147_upstream_gadgets",
    "CREATE TABLE `upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
  );
  const notesSql = "ALTER TABLE `upstream_gadgets` ADD `fork_note` text;";
  writeForkJournal(folder, [
    { tag: "9001_test_fork_gadget_notes", when: 1, sql: notesSql },
  ]);
  migrateWith(db, folder);
  db.$client.exec(
    "INSERT INTO upstream_gadgets (id, fork_note) VALUES ('a', 'kept')",
  );

  appendUpstreamMigration(
    folder,
    "0148_upstream_gadgets_rebuild",
    [
      "CREATE TABLE `__new_upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
      'INSERT INTO `__new_upstream_gadgets`("id") SELECT "id" FROM `upstream_gadgets`;',
      "DROP TABLE `upstream_gadgets`;",
      "ALTER TABLE `__new_upstream_gadgets` RENAME TO `upstream_gadgets`;",
    ].join("--> statement-breakpoint\n"),
  );
  appendUpstreamMigration(folder, "0149_merged_gadget_notes", notesSql);
  writeForkJournal(folder, []);
  migrateWith(db, folder);

  expect(
    db.$client.prepare("SELECT id, fork_note FROM upstream_gadgets").all(),
  ).toEqual([{ id: "a", fork_note: "kept" }]);
});

it("records an upstream migration that differs from a fork migration only in quoting and IF NOT EXISTS", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  writeForkJournal(folder, [
    {
      tag: "9001_test_fork_gizmos",
      when: 1,
      sql: "CREATE TABLE IF NOT EXISTS `fork_gizmos` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
    },
  ]);
  migrateWith(db, folder);
  const upstreamApplied = count(db, "__drizzle_migrations");

  appendUpstreamMigration(
    folder,
    "0147_merged_gizmos",
    'CREATE TABLE "fork_gizmos" (\n  "id" text PRIMARY KEY NOT NULL\n);',
  );
  migrateWith(db, folder);

  expect(count(db, "__drizzle_migrations")).toBe(upstreamApplied + 1);
});

it("puts back a fork column a database lost outside the fork's migrations, but not one a later fork migration drops", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  writeForkJournal(folder, [
    {
      tag: "9001_test_fork_flags",
      when: 1,
      sql: "ALTER TABLE `projects` ADD `fork_flag` integer DEFAULT 0 NOT NULL;--> statement-breakpoint\nALTER TABLE `projects` ADD `fork_scratch` text;",
    },
    {
      tag: "9002_test_fork_drop_scratch",
      when: 2,
      sql: "ALTER TABLE `projects` DROP COLUMN `fork_scratch`;",
    },
  ]);
  migrateWith(db, folder);
  db.$client.exec("ALTER TABLE projects DROP COLUMN fork_flag");

  migrateWith(db, folder);

  expect(columns(db, "projects")).toContain("fork_flag");
  expect(columns(db, "projects")).not.toContain("fork_scratch");
});

it("leaves no table behind when upstream adopts a fork migration that rebuilds a fork table", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  const createSql =
    "CREATE TABLE `fork_widgets` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n";
  const rebuildSql = [
    "CREATE TABLE `__new_fork_widgets` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`size` integer\n);\n",
    'INSERT INTO `__new_fork_widgets`("id") SELECT "id" FROM `fork_widgets`;',
    "DROP TABLE `fork_widgets`;",
    "ALTER TABLE `__new_fork_widgets` RENAME TO `fork_widgets`;",
  ].join("--> statement-breakpoint\n");
  writeForkJournal(folder, [
    { tag: "9001_test_fork_widgets", when: 1, sql: createSql },
    { tag: "9002_test_fork_widgets_size", when: 2, sql: rebuildSql },
  ]);
  migrateWith(db, folder);

  appendUpstreamMigration(folder, "0147_merged_widgets", createSql);
  appendUpstreamMigration(folder, "0148_merged_widgets_size", rebuildSql);
  writeForkJournal(folder, []);
  migrateWith(db, folder);

  expect(
    db.$client
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE '__new_%'")
      .all(),
  ).toEqual([]);
  expect(columns(db, "fork_widgets")).toEqual(["id", "size"]);
});

it("runs an upstream migration whose string literals differ from a fork migration's", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  writeForkJournal(folder, [
    {
      tag: "9001_test_fork_state",
      when: 1,
      sql: "ALTER TABLE `projects` ADD `fork_state` text DEFAULT 'Open' NOT NULL;",
    },
  ]);
  migrateWith(db, folder);

  appendUpstreamMigration(
    folder,
    "0147_upstream_state",
    "ALTER TABLE `projects` ADD `fork_state` text DEFAULT 'open' NOT NULL;",
  );

  expect(() => migrateWith(db, folder)).toThrow(
    /Failed to run the query 'ALTER TABLE `projects` ADD `fork_state`/,
  );
});

it("does not put back a fork column a later fork migration renames", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  writeForkJournal(folder, [
    {
      tag: "9001_test_fork_flag",
      when: 1,
      sql: "ALTER TABLE `projects` ADD `fork_flag` integer;",
    },
    {
      tag: "9002_test_fork_flag_rename",
      when: 2,
      sql: "ALTER TABLE `projects` RENAME COLUMN `fork_flag` TO `fork_flag_2`;",
    },
  ]);
  migrateWith(db, folder);
  migrateWith(db, folder);

  expect(columns(db, "projects")).toContain("fork_flag_2");
  expect(columns(db, "projects")).not.toContain("fork_flag");
});

it("puts back a fork column that an upstream migration dropped before the fork added it again", () => {
  const db = openDatabase();
  const folder = copyMigrations();
  appendUpstreamMigration(
    folder,
    "0147_upstream_gadgets",
    "CREATE TABLE `upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`note` text\n);\n",
  );
  appendUpstreamMigration(
    folder,
    "0148_upstream_gadgets_drop_note",
    "ALTER TABLE `upstream_gadgets` DROP COLUMN `note`;",
  );
  writeForkJournal(folder, [
    {
      tag: "9001_test_fork_gadget_note",
      when: 1,
      sql: "ALTER TABLE `upstream_gadgets` ADD `note` text;",
    },
  ]);
  migrateWith(db, folder);
  db.$client.exec(
    "INSERT INTO upstream_gadgets (id, note) VALUES ('a', 'kept')",
  );

  appendUpstreamMigration(
    folder,
    "0149_upstream_gadgets_rebuild",
    [
      "CREATE TABLE `__new_upstream_gadgets` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n",
      'INSERT INTO `__new_upstream_gadgets`("id") SELECT "id" FROM `upstream_gadgets`;',
      "DROP TABLE `upstream_gadgets`;",
      "ALTER TABLE `__new_upstream_gadgets` RENAME TO `upstream_gadgets`;",
    ].join("--> statement-breakpoint\n"),
  );
  migrateWith(db, folder);

  expect(
    db.$client.prepare("SELECT id, note FROM upstream_gadgets").all(),
  ).toEqual([{ id: "a", note: "kept" }]);
});
