/*!
 * Copyright (c) MerciYanis.
 * All rights reserved.
 */

import { mkdirSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import migrations from 'scripts/db/migrations';
import { type Logger } from 'scripts/lib/logger';

/**
 * A connected better-sqlite3 database instance.
 */
export type Db = Database.Database;

/**
 * Applies pragmas tuned for a write-heavy ingest workload with concurrent dashboard reads.
 */
function applyPragmas(db: Db): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('foreign_keys = ON');
}

/**
 * Applies any migrations whose id is greater than the highest already-recorded id.
 * Each migration runs inside its own transaction so a failure leaves a clean state.
 */
function runMigrations(db: Db, logger: Logger): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);

  const row = db.prepare('SELECT MAX(id) AS current FROM schema_version').get() as { current: number | null };
  const current = row.current ?? 0;

  const record = db.prepare('INSERT INTO schema_version (id, name, applied_at) VALUES (?, ?, ?)');
  migrations
    .filter((migration) => migration.id > current)
    .forEach((migration) => {
      const apply = db.transaction(() => {
        db.exec(migration.sql);
        record.run(migration.id, migration.name, new Date().toISOString());
      });
      apply();
      logger.info({ id: migration.id, name: migration.name }, 'Applied migration.');
    });
}

/**
 * Opens the database (creating parent directories as needed), applies pragmas, and runs
 * pending migrations. Returns the ready-to-use connection.
 */
export function openDatabase(databasePath: string, logger: Logger): Db {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  applyPragmas(db);
  runMigrations(db, logger);
  return db;
}
