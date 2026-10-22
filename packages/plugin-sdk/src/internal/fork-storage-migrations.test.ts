import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { runPluginStorageMigrations } from "./host-policy.js";

const createItems = "CREATE TABLE items (id INTEGER PRIMARY KEY)";
const addPr = "ALTER TABLE items ADD COLUMN pr TEXT";
const addLabels = "ALTER TABLE items ADD COLUMN labels TEXT";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function openDatabase(): Database.Database {
  const database = new Database(":memory:");
  databases.push(database);
  return database;
}

function hash(statement: string): string {
  return createHash("sha256").update(statement).digest("hex");
}

function readLedger(database: Database.Database): unknown[] {
  return database
    .prepare("SELECT id, statement_hash FROM _bb_migrations ORDER BY id")
    .all();
}

it("moves a statement's record when a statement is inserted before it, without running it again", () => {
  const database = openDatabase();
  runPluginStorageMigrations(database, [createItems, addPr]);

  runPluginStorageMigrations(database, [createItems, addLabels, addPr]);

  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addLabels) },
    { id: 2, statement_hash: hash(addPr) },
  ]);
});

it("sets aside the record of a statement that left the list and does not run it again when it returns", () => {
  const database = openDatabase();
  runPluginStorageMigrations(database, [createItems, addPr]);

  runPluginStorageMigrations(database, [createItems, addLabels]);
  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addLabels) },
    { id: 1_000_000, statement_hash: hash(addPr) },
  ]);

  runPluginStorageMigrations(database, [createItems, addLabels, addPr]);
  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addLabels) },
    { id: 2, statement_hash: hash(addPr) },
  ]);
});

it("keeps the ledger as it was when a new statement fails", () => {
  const database = openDatabase();
  runPluginStorageMigrations(database, [createItems, addPr]);

  expect(() =>
    runPluginStorageMigrations(database, [
      createItems,
      "ALTER TABLE missing ADD COLUMN labels TEXT",
      addPr,
    ]),
  ).toThrow(/no such table: missing/);
  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addPr) },
  ]);
});
