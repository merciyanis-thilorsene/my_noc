import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

export async function runMigrations(): Promise<void> {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn({ dir: MIGRATIONS_DIR }, 'no migrations directory found; skipping');
    return;
  }

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await connectWithRetry(client);

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM _migrations',
    );
    const applied = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) {
        logger.debug({ file }, 'migration already applied');
        continue;
      }
      logger.info({ file }, 'applying migration');
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations(name) VALUES ($1)', [file]);
        logger.info({ file }, 'migration applied');
      } catch (err) {
        logger.error({ err, file }, 'migration failed');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

async function connectWithRetry(client: pg.Client, tries = 30): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      await client.connect();
      return;
    } catch (err) {
      lastErr = err;
      logger.warn({ attempt: i + 1, tries }, 'waiting for database…');
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  throw lastErr;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
