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

function forkStatements(...statements: string[]): Map<string, number> {
  return new Map(statements.map((statement) => [hash(statement), 1]));
}

function readLedger(database: Database.Database): unknown[] {
  return database
    .prepare("SELECT id, statement_hash FROM _bb_migrations ORDER BY id")
    .all();
}

it("records a fork statement outside upstream's indexes, so upstream can append its own", () => {
  const database = openDatabase();
  runPluginStorageMigrations(
    database,
    [createItems, addPr],
    forkStatements(addPr),
  );
  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1_000_000, statement_hash: hash(addPr) },
  ]);

  runPluginStorageMigrations(
    database,
    [createItems, addPr, addLabels],
    forkStatements(addPr),
  );

  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addLabels) },
    { id: 1_000_000, statement_hash: hash(addPr) },
  ]);
  expect(() =>
    runPluginStorageMigrations(database, [createItems, addLabels], new Map()),
  ).not.toThrow();
});

it("keeps the record of a fork statement that left the list and does not run it again when it returns", () => {
  const database = openDatabase();
  runPluginStorageMigrations(
    database,
    [createItems, addPr],
    forkStatements(addPr),
  );
  runPluginStorageMigrations(database, [createItems, addLabels], new Map());

  runPluginStorageMigrations(
    database,
    [createItems, addLabels, addPr],
    forkStatements(addPr),
  );

  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addLabels) },
    { id: 1_000_000, statement_hash: hash(addPr) },
  ]);
});

it("moves a fork statement that upstream merged to its upstream index without running it again", () => {
  const database = openDatabase();
  runPluginStorageMigrations(
    database,
    [createItems, addPr],
    forkStatements(addPr),
  );

  runPluginStorageMigrations(database, [createItems, addPr], new Map());

  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addPr) },
  ]);
});

it("moves a fork statement recorded at an upstream index out of upstream's way", () => {
  const database = openDatabase();
  runPluginStorageMigrations(database, [createItems, addPr], new Map());

  runPluginStorageMigrations(
    database,
    [createItems, addLabels, addPr],
    forkStatements(addPr),
  );

  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addLabels) },
    { id: 1_000_000, statement_hash: hash(addPr) },
  ]);
});

it("keeps the ledger as it was when a new statement fails", () => {
  const database = openDatabase();
  runPluginStorageMigrations(database, [createItems, addPr], new Map());

  expect(() =>
    runPluginStorageMigrations(
      database,
      [createItems, "ALTER TABLE missing ADD COLUMN labels TEXT", addPr],
      forkStatements(addPr),
    ),
  ).toThrow(/no such table: missing/);
  expect(readLedger(database)).toEqual([
    { id: 0, statement_hash: hash(createItems) },
    { id: 1, statement_hash: hash(addPr) },
  ]);
});
