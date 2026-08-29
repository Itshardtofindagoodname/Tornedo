/**
 * Database layer: opens the SQLite database, applies migrations, and provides
 * typed accessors. Uses better-sqlite3 (synchronous).
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { dbFile } from "../config/paths.js";
import { MIGRATIONS } from "./migrations.js";

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

let singleton: Database.Database | null = null;

export interface DatabaseHandle {
  db: Database.Database;
  close(): void;
}

export function openDatabase(file?: string): DatabaseHandle {
  const target = file ?? dbFile();
  mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return {
    db,
    close() {
      db.close();
    },
  };
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );
  `);
  const row = db.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get() as
    | { version: number }
    | undefined;
  const current = row?.version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
    });
    run();
  }
}

export function currentSchemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
  return row?.v ?? 0;
}

/** Convenience for the tests / tools that need a standalone in-memory DB. */
export function openInMemory(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** In-memory DatabaseHandle with migrations applied (used by Application). */
export function openInMemoryHandle(): DatabaseHandle {
  const db = openInMemory();
  return { db, close: () => db.close() };
}

export function isOpen(db: Database.Database): boolean {
  return db.open;
}

export { singleton as defaultDatabase };