// Boot sequence. Ported from backend/src/main.rs.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { importJWK, type JWK, type KeyLike } from "jose";
import { Pool } from "pg";
import { loadDictionaryFromText } from "@wordplay/shared";
import type { AppContext } from "./context.js";
import { runMigrations } from "./migrate.js";
import { buildApp } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");
const repoRoot = path.join(backendRoot, "..");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

async function main(): Promise<void> {
  dotenv.config({ path: path.join(backendRoot, ".env") });
  // .env.local overrides .env — gitignored, holds real secrets locally.
  dotenv.config({ path: path.join(backendRoot, ".env.local"), override: true });

  const databaseUrl = requireEnv("DATABASE_URL");
  const port = Number(process.env.PORT ?? "8080");
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";
  const publicAppUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:5173";
  const workosJwksUrl = requireEnv("WORKOS_JWKS_URL");
  const electricUrl = requireEnv("ELECTRIC_URL");

  const jwksRes = await fetch(workosJwksUrl, { signal: AbortSignal.timeout(30_000) });
  const jwksJson = (await jwksRes.json()) as { keys: Array<Record<string, unknown>> };
  const jwks = new Map<string, KeyLike>();
  for (const jwk of jwksJson.keys) {
    const kid = jwk.kid as string | undefined;
    if (!kid) continue;
    const alg = (jwk.alg as string | undefined) ?? "RS256";
    const key = await importJWK(jwk as unknown as JWK, alg);
    if (key instanceof Uint8Array) continue; // RSA/EC keys only
    jwks.set(kid, key);
  }
  console.log(`loaded ${jwks.size} WorkOS JWKS key(s)`);

  // Without an explicit timeout, a stalled TCP handshake hangs the pool
  // forever instead of surfacing an error (pg's default connectionTimeoutMillis
  // is 0 = no timeout). 30s rather than something tighter: a freshly
  // provisioned Neon branch's pooled endpoint can legitimately take longer
  // than a few seconds to accept its first connection after a cold start.
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 30_000 });

  await runMigrations(pool, path.join(backendRoot, "migrations"));
  console.log("migrations applied");

  const dictionaryPath = path.join(repoRoot, "shared", "assets", "enable.txt");
  const dictionaryText = await readFile(dictionaryPath, "utf8");
  const dictionaryHash = createHash("sha256").update(dictionaryText).digest("hex");
  const dictionary = loadDictionaryFromText(dictionaryText);

  const ctx: AppContext = {
    pool,
    jwks,
    electricUrl,
    publicAppUrl,
    dictionary,
    dictionaryText,
    dictionaryHash,
    dictionarySize: Buffer.byteLength(dictionaryText, "utf8"),
    dictionaryWordCount: dictionary.size,
  };

  const app = buildApp(ctx, allowedOrigin);

  // Dual-stack by default (matches the Rust binary's Ipv6Addr::UNSPECIFIED,
  // required by Fly.io); overridable via HOST for environments without IPv6.
  const host = process.env.HOST ?? "::";
  await app.listen({ port, host });
  console.log(`listening on port ${port} 🚀`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
