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
      // A non-trivial body, not "[]" -- catches the proxy silently dropping
      // a streamed response body (see the cache-control assertion below).
      res.end('[{"headers":{"operation":"insert"},"value":{"marker":"stub-payload"}}]');
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
    vapidPublicKey: "test-vapid-public-key",
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
  await pool.query(
    "TRUNCATE users, games, game_players, game_secrets, moves, invites, friendships, friend_links RESTART IDENTITY CASCADE",
  );
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

async function patch(path: string, sub: string, body: unknown) {
  const res = await app.inject({
    method: "PATCH",
    url: path,
    headers: { authorization: `Bearer ${await token(privateKey, sub)}`, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  return { status: res.statusCode, body: res.body.length > 0 ? JSON.parse(res.body) : null };
}

async function del(path: string, sub: string, body?: unknown) {
  const res = await app.inject({
    method: "DELETE",
    url: path,
    headers:
      body !== undefined
        ? { authorization: `Bearer ${await token(privateKey, sub)}`, "content-type": "application/json" }
        : { authorization: `Bearer ${await token(privateKey, sub)}` },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.statusCode, body: res.body.length > 0 ? JSON.parse(res.body) : null };
}

async function onboard(sub: string, username: string) {
  const r = await post("/me", sub, { username });
  expect(r.status, `onboard ${username}: ${JSON.stringify(r.body)}`).toBe(201);
}

/** Establish a friendship via the friend-link flow. */
async function befriend(owner: string, accepter: string) {
  const link = await get("/friends/link", owner);
  expect(link.status, JSON.stringify(link.body)).toBe(200);
  const r = await post(`/friends/${link.body.token}/accept`, accepter, {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

async function friendshipRows(a: string, b: string): Promise<number> {
  const { rows } = await pool.query(
    "SELECT 1 FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
    [a, b],
  );
  return rows.length;
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

    // Challenge-by-username is gone.
    const ch = await post(`/games/${gameId}/challenge`, "creator", { username: "Joiner" });
    expect(ch.status).toBe(404);

    // Opponent joins via an invite link.
    const invite = await post(`/games/${gameId}/invites`, "creator", {});
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    const accept = await post(`/invites/${invite.body.token}/accept`, "joiner", {});
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    const joined = await get(`/games/${gameId}`, "creator");
    expect(joined.body.game.status).toBe("active");
    expect(joined.body.game.current_player_id).toBe("joiner");

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

    // Accepting an invite also forges a durable friendship, both directions.
    expect(await friendshipRows("host", "guest")).toBe(2);

    // Idempotent for the same claimer.
    const again = await post(`/invites/${itoken}/accept`, "guest", {});
    expect(again.status).toBe(200);

    // A third user can't claim it.
    await onboard("third", "Third");
    const stolen = await post(`/invites/${itoken}/accept`, "third", {});
    expect(stolen.status).toBe(409);
  });

  it("push subscription management", async () => {
    await onboard("subscriber", "Subscriber");
    await onboard("other", "Other");

    const publicKey = await get("/push/vapid-public-key");
    expect(publicKey.status).toBe(200);
    expect(publicKey.body.public_key).toBe("test-vapid-public-key");

    const bad = await post("/me/push-subscriptions", "subscriber", { endpoint: "https://push.example/1" });
    expect(bad.status).toBe(400);

    const sub = {
      endpoint: "https://push.example/1",
      keys: { p256dh: "p256dh-value", auth: "auth-value" },
    };
    const created = await post("/me/push-subscriptions", "subscriber", sub);
    expect(created.status).toBe(204);

    const rows1 = await pool.query("SELECT user_id FROM push_subscriptions WHERE endpoint = $1", [sub.endpoint]);
    expect(rows1.rows).toHaveLength(1);
    expect(rows1.rows[0].user_id).toBe("subscriber");

    // Re-subscribing the same endpoint (e.g. a shared/reused browser) upserts
    // rather than duplicating, reassigning ownership.
    const reassigned = await post("/me/push-subscriptions", "other", sub);
    expect(reassigned.status).toBe(204);
    const rows2 = await pool.query("SELECT user_id FROM push_subscriptions WHERE endpoint = $1", [sub.endpoint]);
    expect(rows2.rows).toHaveLength(1);
    expect(rows2.rows[0].user_id).toBe("other");

    // Deleting as the wrong owner is a silent no-op, not an error or leak.
    const wrongDelete = await del("/me/push-subscriptions", "subscriber", { endpoint: sub.endpoint });
    expect(wrongDelete.status).toBe(204);
    const stillThere = await pool.query("SELECT 1 FROM push_subscriptions WHERE endpoint = $1", [sub.endpoint]);
    expect(stillThere.rows).toHaveLength(1);

    const deleted = await del("/me/push-subscriptions", "other", { endpoint: sub.endpoint });
    expect(deleted.status).toBe(204);
    const gone = await pool.query("SELECT 1 FROM push_subscriptions WHERE endpoint = $1", [sub.endpoint]);
    expect(gone.rows).toHaveLength(0);
  });

  it("friend links: get-or-create, preview, accept, regenerate, remove", async () => {
    await onboard("alice", "Alice");
    await onboard("bob", "Bob");

    // Get-or-create is stable across calls.
    const link = await get("/friends/link", "alice");
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    expect(link.body.url).toBe(`https://wordplay.example/friend/${link.body.token}`);
    const linkAgain = await get("/friends/link", "alice");
    expect(linkAgain.body.token).toBe(link.body.token);

    // Public preview needs no auth and shows the owner.
    const preview = await get(`/friends/${link.body.token}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.username).toBe("Alice");
    expect((await get("/friends/nosuchtoken/preview")).status).toBe(404);

    // Owner can't friend themselves; unknown tokens 404; the un-onboarded 404.
    expect((await post(`/friends/${link.body.token}/accept`, "alice", {})).body.error).toBe("cannot_friend_self");
    expect((await post("/friends/nosuchtoken/accept", "bob", {})).status).toBe(404);
    expect((await post(`/friends/${link.body.token}/accept`, "stranger", {})).status).toBe(404);

    // Accept establishes both mirrored rows; re-accept is a no-op.
    const accept = await post(`/friends/${link.body.token}/accept`, "bob", {});
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    expect(accept.body).toEqual({ friend_id: "alice", friend_username: "Alice" });
    expect(await friendshipRows("alice", "bob")).toBe(2);
    expect((await post(`/friends/${link.body.token}/accept`, "bob", {})).status).toBe(200);
    expect(await friendshipRows("alice", "bob")).toBe(2);

    // Avatar edits propagate into friends' denormalized rows.
    const avatar = await patch("/me", "alice", { avatar_emoji: "🐙", avatar_color: "sky-vivid" });
    expect(avatar.status, JSON.stringify(avatar.body)).toBe(200);
    const mirrored = await pool.query(
      "SELECT friend_avatar_emoji FROM friendships WHERE user_id = 'bob' AND friend_id = 'alice'",
    );
    expect(mirrored.rows[0].friend_avatar_emoji).toBe("🐙");

    // Regenerating invalidates the old link.
    const regen = await post("/friends/link", "alice", {});
    expect(regen.status).toBe(201);
    expect(regen.body.token).not.toBe(link.body.token);
    expect((await get(`/friends/${link.body.token}/preview`)).status).toBe(404);

    // Removal deletes both directions and is idempotent.
    expect((await del("/friends/alice", "bob")).status).toBe(204);
    expect(await friendshipRows("alice", "bob")).toBe(0);
    expect((await del("/friends/alice", "bob")).status).toBe(204);
  });

  it("friend games: hidden pending opponent, reuse, attach on opening move", async () => {
    await onboard("alice", "Alice");
    await onboard("bob", "Bob");
    await befriend("alice", "bob");

    // Starting a game against a non-friend is rejected.
    await onboard("carol", "Carol");
    const notFriends = await post("/games", "alice", { deduct_unused: false, friend_id: "carol" });
    expect(notFriends.status).toBe(409);
    expect(notFriends.body.error).toBe("not_friends");
    expect((await post("/games", "alice", { deduct_unused: false, friend_id: "alice" })).body.error).toBe(
      "cannot_play_self",
    );

    // A friend game records the pending opponent but attaches nobody.
    const created = await post("/games", "alice", { deduct_unused: false, friend_id: "bob" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const game = created.body.game;
    expect(game.status).toBe("awaiting_opponent");
    expect(game.opponent_id).toBeNull();
    expect(game.pending_opponent_id).toBe("bob");
    expect(game.pending_opponent_username).toBe("Bob");

    // No invite links for a game earmarked for a friend.
    const invite = await post(`/games/${game.id}/invites`, "alice", {});
    expect(invite.status).toBe(409);
    expect(invite.body.error).toBe("friend_game");

    // Re-creating against the same friend reuses the pending game (same
    // rack — no re-rolling the opening draw), updating the deduct option.
    const reused = await post("/games", "alice", { deduct_unused: true, friend_id: "bob" });
    expect(reused.status).toBe(200);
    expect(reused.body.game.id).toBe(game.id);
    expect(reused.body.game.deduct_unused).toBe(true);
    expect(reused.body.rack).toBe(created.body.rack);

    // ...but an open (no-friend) game is a separate pending slot, likewise reused.
    const open = await post("/games", "alice", { deduct_unused: false });
    expect(open.status).toBe(201);
    expect(open.body.game.id).not.toBe(game.id);
    expect(open.body.game.pending_opponent_id).toBeNull();
    const openReused = await post("/games", "alice", { deduct_unused: false });
    expect(openReused.status).toBe(200);
    expect(openReused.body.game.id).toBe(open.body.game.id);

    // The opening move attaches the friend: game goes active, their turn,
    // rack dealt — this is the moment the game enters Bob's shape.
    await setRack(game.id, "alice", "HELLOAB");
    const play = await post(`/games/${game.id}/moves`, "alice", {
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
    expect(play.body.game.status).toBe("active");
    expect(play.body.game.opponent_id).toBe("bob");
    expect(play.body.game.opponent_username).toBe("Bob");
    expect(play.body.game.current_player_id).toBe("bob");
    expect(play.body.game.opponent_rack_count).toBe(7);
    expect(play.body.game.pending_opponent_id).toBeNull();
  });

  it("a pending friend game degrades to open when the friendship is revoked", async () => {
    await onboard("alice", "Alice");
    await onboard("bob", "Bob");
    await befriend("alice", "bob");

    const created = await post("/games", "alice", { deduct_unused: false, friend_id: "bob" });
    const gameId: string = created.body.game.id;

    expect((await del("/friends/bob", "alice")).status).toBe(204);

    await setRack(gameId, "alice", "HELLOAB");
    const play = await post(`/games/${gameId}/moves`, "alice", {
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
    expect(play.body.game.status).toBe("awaiting_opponent");
    expect(play.body.game.opponent_id).toBeNull();
    expect(play.body.game.pending_opponent_id).toBeNull();

    // Now open to link invitees like any other opponent-less game.
    expect((await post(`/games/${gameId}/invites`, "alice", {})).status).toBe(201);
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
    // The streamed body must actually be forwarded, not silently dropped
    // (a real regression: an async handler calling reply.send() on a piped
    // stream without `return`ing it raced Fastify's own completion and
    // produced a 200 with an empty body).
    expect(r.body).toEqual([{ headers: { operation: "insert" }, value: { marker: "stub-payload" } }]);
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

    // friends view is scoped to the caller and never exposes friend_links
    // (the personal token table has no view at all).
    const friends = await get("/shape?view=friends", "member");
    expect(friends.status).toBe(200);
    const friendsQuery = electric.lastQuery();
    expect(friendsQuery).toContain("table=friendships");
    expect(decodeURIComponent(friendsQuery!.replace(/\+/g, " "))).toContain("user_id = 'member'");
    expect(friendsQuery).not.toContain("friend_links");
  });
});
