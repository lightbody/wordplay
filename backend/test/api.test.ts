// HTTP integration tests. Requires a Postgres reachable via DATABASE_URL
// (defaults to the local docker-compose service). Auth is exercised with
// locally minted RS256 JWTs whose public key is injected into the app's
// AppContext.jwks map, so no WorkOS network dependency is needed.
// Ported from backend/tests/api.rs.

import { generateKeyPairSync } from "node:crypto";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { exportJWK, importJWK, SignJWT, type KeyLike } from "jose";
import { Pool } from "pg";
import { createDictionary } from "@wordplay/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppContext } from "../src/context.js";
import { runMigrations } from "../src/migrate.js";
import { buildApp } from "../src/server.js";

const KID = "test-key";

async function mintKeys(): Promise<{ privateKey: KeyLike; jwks: Map<string, KeyLike> }> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = await exportJWK(publicKey);
  jwk.kid = KID;
  jwk.alg = "RS256";
  const importedPublic = await importJWK(jwk, "RS256");
  const jwks = new Map<string, KeyLike>();
  jwks.set(KID, importedPublic as KeyLike);
  return { privateKey: privateKey as unknown as KeyLike, jwks };
}

async function token(privateKey: KeyLike, sub: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setSubject(sub)
    .setExpirationTime("10y")
    .sign(privateKey);
}

/** Fake Electric that records the query string of the last shape request. */
function spawnElectricStub(): Promise<{ url: string; server: Server; lastQuery: () => string | undefined }> {
  return new Promise((resolve) => {
    let last: string | undefined;
    const server = http.createServer((req, res) => {
      const idx = req.url?.indexOf("?") ?? -1;
      last = idx >= 0 ? req.url!.slice(idx + 1) : "";
      res.setHeader("electric-handle", "1");
      res.setHeader("content-type", "application/json");
      // Real Electric marks historical shape chunks publicly cacheable;
      // the proxy must override this since responses are per-user scoped.
      res.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=300");
      res.end("[]");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${addr.port}`, server, lastQuery: () => last });
    });
  });
}

let pool: Pool;
let app: FastifyInstance;
let privateKey: KeyLike;
let electric: { url: string; server: Server; lastQuery: () => string | undefined };

beforeAll(async () => {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://postgres:password@127.0.0.1:5432/wordplay?sslmode=disable";
  pool = new Pool({ connectionString: databaseUrl });
  await runMigrations(pool, new URL("../migrations", import.meta.url).pathname);

  const keys = await mintKeys();
  privateKey = keys.privateKey;

  electric = await spawnElectricStub();

  const ctx: AppContext = {
    pool,
    jwks: keys.jwks,
    electricUrl: electric.url,
    publicAppUrl: "https://wordplay.example",
    dictionary: createDictionary(["hello", "hellos", "world"]),
    dictionaryText: "hello\nhellos\nworld\n",
    dictionaryHash: "test-hash",
    dictionarySize: 0,
    dictionaryWordCount: 3,
  };
  app = buildApp(ctx, "http://localhost:5173");
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await new Promise<void>((resolve) => electric.server.close(() => resolve()));
});

beforeEach(async () => {
  await pool.query("TRUNCATE users, games, game_players, game_secrets, moves, invites RESTART IDENTITY CASCADE");
});

// --- request helpers ---

async function get(path: string, sub?: string) {
  const headers: Record<string, string> = {};
  if (sub) headers.authorization = `Bearer ${await token(privateKey, sub)}`;
  const res = await app.inject({ method: "GET", url: path, headers });
  return { status: res.statusCode, body: res.body.length > 0 ? JSON.parse(res.body) : null, headers: res.headers };
}

async function post(path: string, sub: string, body: unknown) {
  const res = await app.inject({
    method: "POST",
    url: path,
    headers: { authorization: `Bearer ${await token(privateKey, sub)}`, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  return { status: res.statusCode, body: res.body.length > 0 ? JSON.parse(res.body) : null };
}

async function onboard(sub: string, username: string) {
  const r = await post("/me", sub, { username });
  expect(r.status, `onboard ${username}: ${JSON.stringify(r.body)}`).toBe(201);
}

/** Directly seed a player's rack (bypassing the random draw) for deterministic move tests. */
async function setRack(gameId: string, user: string, rack: string) {
  await pool.query("UPDATE game_players SET rack = $1 WHERE game_id = $2 AND user_id = $3", [rack, gameId, user]);
}

// --- tests ---

describe("wordplay backend API", () => {
  it("onboarding flow and username uniqueness", async () => {
    expect((await get("/me", "user_a")).status).toBe(404);

    await onboard("user_a", "Alice");

    const me = await get("/me", "user_a");
    expect(me.status).toBe(200);
    expect(me.body.username).toBe("Alice");

    // Case-insensitive collision from a different account.
    const dup = await post("/me", "user_b", { username: "alice" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("username_taken");

    const check = await get("/usernames/ALICE", "user_b");
    expect(check.body.available).toBe(false);
    const free = await get("/usernames/bob", "user_b");
    expect(free.body.available).toBe(true);
  });

  it("rejects missing auth", async () => {
    expect((await get("/me")).status).toBe(401);
    expect((await get("/shape?view=games")).status).toBe(401);
  });

  it("plays a full two-player game", async () => {
    await onboard("creator", "Creator");
    await onboard("joiner", "Joiner");

    const created = await post("/games", "creator", { deduct_unused: true });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const gameId: string = created.body.game.id;

    await setRack(gameId, "creator", "HELLOAB");
    const play = await post(`/games/${gameId}/moves`, "creator", {
      type: "play",
      tiles: [
        { row: 7, col: 5, letter: "H", blank: false },
        { row: 7, col: 6, letter: "E", blank: false },
        { row: 7, col: 7, letter: "L", blank: false },
        { row: 7, col: 8, letter: "L", blank: false },
        { row: 7, col: 9, letter: "O", blank: false },
      ],
    });
    expect(play.status, JSON.stringify(play.body)).toBe(201);
    expect(play.body.move.score).toBe(16);
    expect(play.body.game.creator_score).toBe(16);
    // Turn handed off to nobody yet (awaiting opponent).
    expect(play.body.game.current_player_id).toBeNull();

    // An invalid word is rejected with the offending words listed.
    await setRack(gameId, "creator", "ZQXJKVW");
    await pool.query("UPDATE games SET current_player_id = 'creator' WHERE id = $1", [gameId]);
    const bad = await post(`/games/${gameId}/moves`, "creator", {
      type: "play",
      tiles: [
        { row: 8, col: 5, letter: "Z", blank: false },
        { row: 9, col: 5, letter: "Q", blank: false },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe("invalid_words");
    await pool.query("UPDATE games SET current_player_id = NULL WHERE id = $1", [gameId]);

    // Opponent joins by challenge.
    const ch = await post(`/games/${gameId}/challenge`, "creator", { username: "Joiner" });
    expect(ch.status, JSON.stringify(ch.body)).toBe(200);
    expect(ch.body.status).toBe("active");
    expect(ch.body.current_player_id).toBe("joiner");

    // Creator can't move out of turn.
    const outOfTurn = await post(`/games/${gameId}/moves`, "creator", { type: "pass" });
    expect(outOfTurn.status).toBe(409);
    expect(outOfTurn.body.error).toBe("not_your_turn");

    // Opponent plays a connecting word: HELLO + S -> HELLOS.
    await setRack(gameId, "joiner", "STUVWXY");
    const opp = await post(`/games/${gameId}/moves`, "joiner", {
      type: "play",
      tiles: [{ row: 7, col: 10, letter: "S", blank: false }],
    });
    expect(opp.status, JSON.stringify(opp.body)).toBe(201);
    expect(opp.body.move.score).toBeGreaterThan(0);
    expect(opp.body.game.current_player_id).toBe("creator");

    // Creator resigns -> game finished, opponent wins.
    const resign = await post(`/games/${gameId}/moves`, "creator", { type: "resign" });
    expect(resign.status).toBe(201);
    expect(resign.body.game.status).toBe("finished");
    expect(resign.body.game.ended_reason).toBe("resigned");
    expect(resign.body.game.winner_id).toBe("joiner");
  });

  it("invite preview and accept", async () => {
    await onboard("host", "Host");
    await onboard("guest", "Guest");

    const created = await post("/games", "host", { deduct_unused: false });
    const gameId: string = created.body.game.id;

    const invite = await post(`/games/${gameId}/invites`, "host", {});
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    const itoken: string = invite.body.token;

    // Public preview needs no auth.
    const preview = await get(`/invites/${itoken}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.inviter_username).toBe("Host");

    // Guest accepts and is linked as opponent.
    const accept = await post(`/invites/${itoken}/accept`, "guest", {});
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    expect(accept.body.game_id).toBe(gameId);

    // Idempotent for the same claimer.
    const again = await post(`/invites/${itoken}/accept`, "guest", {});
    expect(again.status).toBe(200);

    // A third user can't claim it.
    await onboard("third", "Third");
    const stolen = await post(`/invites/${itoken}/accept`, "third", {});
    expect(stolen.status).toBe(409);
  });

  it("shape proxy enforces authorization and never leaks game_secrets", async () => {
    await onboard("member", "Member");
    await onboard("outsider", "Outsider");

    // Unknown view and missing params are rejected before hitting Electric.
    expect((await get("/shape?view=bogus", "member")).status).toBe(400);
    expect((await get("/shape?view=moves", "member")).status).toBe(400);

    // games view forwards a where-clause scoped to the caller.
    const r = await get("/shape?view=games", "member");
    expect(r.status).toBe(200);
    // Electric's own cache-control (which marks historical chunks publicly
    // cacheable) must never reach the client -- every response here is
    // scoped to the caller and must not be shared/replayed by any cache.
    expect(r.headers["cache-control"]).toBe("no-store");
    const q = electric.lastQuery();
    expect(q, "where clause must scope to the user").toBeDefined();
    expect(decodeURIComponent(q!)).toContain("member");
    expect(q).toContain("table=games");
    // The bag table must never be reachable through any view.
    expect(q).not.toContain("game_secrets");

    // A non-participant cannot stream another game's moves.
    const created = await post("/games", "member", { deduct_unused: false });
    const gameId: string = created.body.game.id;
    const forbidden = await get(`/shape?view=moves&game_id=${gameId}`, "outsider");
    expect(forbidden.status).toBe(403);

    // The moves view (as a member) also never leaks game_secrets.
    const memberMoves = await get(`/shape?view=moves&game_id=${gameId}`, "member");
    expect(memberMoves.status).toBe(200);
    expect(electric.lastQuery()).not.toContain("game_secrets");

    // racks view is scoped to the caller and never leaks game_secrets either.
    const racks = await get("/shape?view=racks", "member");
    expect(racks.status).toBe(200);
    const racksQuery = electric.lastQuery();
    expect(racksQuery).not.toContain("game_secrets");
    expect(decodeURIComponent(racksQuery!)).toContain("member");
  });
});
