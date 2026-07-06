// Small custom migration runner: applies backend/migrations/*.sql files in
// filename order, tracked in a `_migrations` table. Mirrors sqlx::migrate!'s
// once-only-apply-in-order semantics, without sqlx's checksum verification.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

// Postgres "already exists" error classes (duplicate_table, duplicate_object,
// duplicate_column, duplicate_function, duplicate_schema). Any database that
// already has this schema applied by the old Rust backend's sqlx::migrate!
// (production, or a Neon branch copied from it) has no `_migrations` row for
// a migration sqlx already ran under its own `_sqlx_migrations` bookkeeping
// -- so the first run here would otherwise try to replay already-applied DDL
// and crash. Treat these as "already applied" instead.
const ALREADY_EXISTS_CODES = new Set(["42P07", "42710", "42701", "42723", "42P06"]);

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const { rows } = await pool.query("SELECT 1 FROM _migrations WHERE name = $1", [file]);
    if (rows.length > 0) continue;

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      const code = (e as { code?: string }).code;
      if (code && ALREADY_EXISTS_CODES.has(code)) {
        console.warn(`${file}: schema already present (${code}), marking as applied`);
        await pool.query("INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
        continue;
      }
      throw e;
    } finally {
      client.release();
    }
  }
}
