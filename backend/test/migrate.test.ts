import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.js";

// Minimal fake pg Pool/PoolClient -- enough surface for runMigrations,
// without needing a real Postgres connection.
function fakePool(handlers: { onQuery?: (sql: string, params?: unknown[]) => { rows: unknown[] } | never }) {
  const calls: string[] = [];
  const client = {
    query: (sql: string, params?: unknown[]) => {
      calls.push(sql.trim().split("\n")[0]);
      if (handlers.onQuery) return handlers.onQuery(sql, params);
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = {
    query: (sql: string, params?: unknown[]) => client.query(sql, params),
    connect: async () => client,
  };
  return { pool, calls };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "migrate-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("applies a new migration and records it", async () => {
    await writeFile(path.join(dir, "001_initial.sql"), "CREATE TABLE foo (id int);");
    const seen: string[] = [];
    const { pool } = fakePool({
      onQuery: (sql) => {
        seen.push(sql.trim().split("\n")[0]);
        if (sql.includes("SELECT 1 FROM _migrations")) return { rows: [] };
        return { rows: [] };
      },
    });
    await runMigrations(pool as never, dir);
    expect(seen.some((s) => s.includes("CREATE TABLE foo"))).toBe(true);
    expect(seen.some((s) => s.includes("INSERT INTO _migrations"))).toBe(true);
  });

  it("skips a migration already recorded in _migrations", async () => {
    await writeFile(path.join(dir, "001_initial.sql"), "CREATE TABLE foo (id int);");
    const seen: string[] = [];
    const { pool } = fakePool({
      onQuery: (sql) => {
        seen.push(sql.trim().split("\n")[0]);
        if (sql.includes("SELECT 1 FROM _migrations")) return { rows: [{ "?column?": 1 }] };
        return { rows: [] };
      },
    });
    await runMigrations(pool as never, dir);
    expect(seen.some((s) => s.includes("CREATE TABLE foo"))).toBe(false);
  });

  it("treats an 'already exists' error as already applied instead of crashing", async () => {
    await writeFile(path.join(dir, "001_initial.sql"), "CREATE TABLE users (id int);");
    const seen: string[] = [];
    const { pool } = fakePool({
      onQuery: (sql) => {
        seen.push(sql.trim().split("\n")[0]);
        if (sql.includes("SELECT 1 FROM _migrations")) return { rows: [] };
        if (sql.includes("CREATE TABLE users")) {
          const err = new Error('relation "users" already exists') as Error & { code: string };
          err.code = "42P07";
          throw err;
        }
        return { rows: [] };
      },
    });
    await expect(runMigrations(pool as never, dir)).resolves.toBeUndefined();
    expect(seen.some((s) => s.includes("ROLLBACK"))).toBe(true);
    expect(seen.some((s) => s.includes("ON CONFLICT DO NOTHING"))).toBe(true);
  });

  it("rethrows errors that aren't an 'already exists' class", async () => {
    await writeFile(path.join(dir, "001_initial.sql"), "CREATE TABLE foo (id int);");
    const { pool } = fakePool({
      onQuery: (sql) => {
        if (sql.includes("SELECT 1 FROM _migrations")) return { rows: [] };
        if (sql.includes("CREATE TABLE foo")) {
          const err = new Error("syntax error") as Error & { code: string };
          err.code = "42601";
          throw err;
        }
        return { rows: [] };
      },
    });
    await expect(runMigrations(pool as never, dir)).rejects.toThrow("syntax error");
  });
});
