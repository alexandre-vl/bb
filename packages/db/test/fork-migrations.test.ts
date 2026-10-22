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
  return db.$client
    .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
    .get()?.count ?? 0;
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
