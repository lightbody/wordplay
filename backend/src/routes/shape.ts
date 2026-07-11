// Generalized Electric shape proxy with a server-side view registry.
// Ported from backend/src/handlers/shape.rs — security-critical, port with
// zero deviation.
//
// Clients call GET /shape?view=<name>[&game_id=<uuid>] plus Electric
// protocol params (offset, handle, live, cursor). The proxy strips any
// client-supplied table/where/columns/params, looks the view up in a fixed
// registry, and injects a server-enforced filter. The bag lives in
// game_secrets, which has no view, so it can never be synced to a client.

import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { authenticate } from "../auth.js";
import type { AppContext } from "../context.js";
import { AppError } from "../errors.js";
import { UUID_RE } from "../util.js";

/** Reject anything that isn't a plain WorkOS-style identifier before we interpolate it into a shape where clause. */
function safeUserId(userId: string): string {
  if (userId.length > 0 && /^[A-Za-z0-9_]+$/.test(userId)) return userId;
  throw AppError.badRequest("invalid_user_id");
}

const FORWARD_PARAMS = ["offset", "handle", "live", "cursor"];

// Hop-by-hop headers (per the Rust proxy) plus content-length/content-encoding:
// Node's fetch transparently decodes the response body, so forwarding the
// original content-encoding/content-length would describe bytes we're no
// longer sending. cache-control is also stripped: Electric marks historical
// (non-live) shape chunks as publicly cacheable so a CDN can serve them
// directly, but every response from this proxy is scoped to the calling
// user via an injected `where` filter -- nothing here varies by
// Authorization, so letting a shared cache (or the browser's own HTTP
// cache) store and replay it is both a correctness bug (the client can get
// an instantly-replayed stale response instead of a real long-poll, which
// Electric's client library detects as a stuck retry loop) and a
// cross-user data exposure risk. Replaced with an explicit no-store below.
const STRIPPED_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-authenticate",
  "upgrade",
  "content-encoding",
  "content-length",
  "cache-control",
]);

export function registerShapeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/shape", async (req, reply) => {
    const userId = await authenticate(ctx, req);
    const me = safeUserId(userId);
    const query = req.query as Record<string, string>;
    const view = query.view ?? "";

    let table: string;
    let whereClause: string;
    let columns: string | undefined;

    if (view === "games") {
      table = "games";
      whereClause = `creator_id = '${me}' OR opponent_id = '${me}'`;
    } else if (view === "friends") {
      table = "friendships";
      whereClause = `user_id = '${me}'`;
      columns = "user_id,friend_id,friend_username,friend_avatar_emoji,friend_avatar_color,created_at";
    } else if (view === "racks") {
      table = "game_players";
      whereClause = `user_id = '${me}'`;
      columns = "game_id,user_id,rack,updated_at";
    } else if (view === "moves") {
      const gameId = query.game_id;
      if (!gameId || !UUID_RE.test(gameId)) throw AppError.badRequest("game_id_required");
      // Membership check: only participants may stream a game's moves.
      const { rows } = await ctx.pool.query(
        "SELECT 1 FROM games WHERE id = $1 AND (creator_id = $2 OR opponent_id = $2)",
        [gameId, me],
      );
      if (rows.length === 0) throw AppError.forbidden();
      table = "moves";
      whereClause = `game_id = '${gameId}'`;
    } else {
      throw AppError.badRequest("unknown_view");
    }

    // Forward only Electric protocol params; drop everything client-chosen.
    const forward = new URLSearchParams();
    for (const key of FORWARD_PARAMS) {
      const value = query[key];
      if (value !== undefined) forward.set(key, value);
    }
    forward.set("table", table);
    forward.set("where", whereClause);
    if (columns) forward.set("columns", columns);

    let upstream: Response;
    try {
      upstream = await fetch(`${ctx.electricUrl}/v1/shape?${forward.toString()}`);
    } catch {
      throw AppError.upstream();
    }

    reply.status(upstream.status);
    upstream.headers.forEach((value, name) => {
      if (!STRIPPED_HEADERS.has(name.toLowerCase())) reply.header(name, value);
    });
    reply.header("cache-control", "no-store");

    if (!upstream.body) {
      return reply.send();
    }
    // Must `return` reply.send() here, not call it bare: in an async
    // handler, Fastify races the handler's own promise resolution against
    // the stream finishing. With a bare call the handler resolves (with
    // undefined) before the piped stream has written any chunks, and
    // Fastify finalizes the response as empty -- reproduced in isolation
    // (a 90-byte upstream body came back as 0 bytes without `return`, and
    // correctly in full with it). JSON-payload routes elsewhere don't hit
    // this because their sends complete synchronously within the handler;
    // this is the only route in the app that streams a piped body.
    return reply.send(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream));
  });
}
