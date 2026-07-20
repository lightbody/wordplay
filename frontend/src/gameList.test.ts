import { describe, expect, it } from "vitest";
import {
  canNudge,
  canRematch,
  NUDGE_COOLDOWN_MS,
  NUDGE_TURN_IDLE_MS,
  nudgeAvailableAt,
  opponentIdOf,
  visibleGame,
  yourTurnCount,
} from "./gameList";
import type { Game } from "./types";

function makeGame(overrides: Partial<Game>): Game {
  return {
    id: "g1",
    status: "active",
    creator_id: "me",
    opponent_id: "them",
    creator_username: "Me",
    opponent_username: "Them",
    creator_avatar_emoji: "🦊",
    creator_avatar_color: "coral-vivid",
    opponent_avatar_emoji: "🐙",
    opponent_avatar_color: "sky-vivid",
    pending_opponent_id: null,
    pending_opponent_username: null,
    pending_opponent_avatar_emoji: null,
    pending_opponent_avatar_color: null,
    current_player_id: "me",
    deduct_unused: false,
    board: ".".repeat(225),
    tiles_remaining: 79,
    creator_rack_count: 7,
    opponent_rack_count: 7,
    creator_score: 0,
    opponent_score: 0,
    move_count: 1,
    scoreless_streak: 0,
    final_moves_remaining: null,
    ended_reason: null,
    winner_id: null,
    creator_adjustment: 0,
    opponent_adjustment: 0,
    creator_last_nudge_at: null,
    opponent_last_nudge_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("visibleGame", () => {
  it("hides opponent-less games regardless of moves played", () => {
    expect(visibleGame(makeGame({ status: "awaiting_opponent", opponent_id: null, move_count: 0 }))).toBe(false);
    expect(visibleGame(makeGame({ status: "awaiting_opponent", opponent_id: null, move_count: 1 }))).toBe(false);
    expect(
      visibleGame(makeGame({ status: "awaiting_opponent", opponent_id: null, pending_opponent_id: "them" })),
    ).toBe(false);
  });

  it("shows active and finished games", () => {
    expect(visibleGame(makeGame({ status: "active" }))).toBe(true);
    expect(visibleGame(makeGame({ status: "finished", winner_id: "me" }))).toBe(true);
  });
});

describe("opponentIdOf", () => {
  it("resolves the other participant from either seat", () => {
    const game = makeGame({});
    expect(opponentIdOf(game, "me")).toBe("them");
    expect(opponentIdOf(game, "them")).toBe("me");
  });
});

describe("canRematch", () => {
  const friends = new Set(["them"]);

  it("offers rematch on finished games against current friends, from either seat", () => {
    expect(canRematch(makeGame({ status: "finished" }), "me", friends)).toBe(true);
    expect(canRematch(makeGame({ status: "finished" }), "them", new Set(["me"]))).toBe(true);
  });

  it("never offers rematch on unfinished games", () => {
    expect(canRematch(makeGame({ status: "active" }), "me", friends)).toBe(false);
    expect(canRematch(makeGame({ status: "awaiting_opponent", opponent_id: null }), "me", friends)).toBe(false);
  });

  it("requires the opponent to still be a friend", () => {
    expect(canRematch(makeGame({ status: "finished" }), "me", new Set())).toBe(false);
  });
});

describe("yourTurnCount", () => {
  it("counts only active games where it's my turn", () => {
    const games = [
      makeGame({ id: "g1", status: "active", current_player_id: "me" }),
      makeGame({ id: "g2", status: "active", current_player_id: "them" }),
      makeGame({ id: "g3", status: "active", current_player_id: "me" }),
      makeGame({ id: "g4", status: "finished", current_player_id: null }),
      makeGame({ id: "g5", status: "awaiting_opponent", current_player_id: "me" }),
    ];
    expect(yourTurnCount(games, "me")).toBe(2);
  });

  it("is zero with no games", () => {
    expect(yourTurnCount([], "me")).toBe(0);
  });
});

describe("nudgeAvailableAt / canNudge", () => {
  const T0 = Date.parse("2026-01-01T00:00:00Z");
  // Game where it's the opponent's turn as of T0 (I just moved).
  const waiting = (overrides: Partial<Game> = {}) =>
    makeGame({ current_player_id: "them", updated_at: "2026-01-01T00:00:00Z", ...overrides });

  it("is null when the game isn't nudgeable at all", () => {
    expect(nudgeAvailableAt(makeGame({ status: "finished", current_player_id: null }), "me")).toBeNull();
    expect(nudgeAvailableAt(makeGame({ status: "awaiting_opponent", current_player_id: null }), "me")).toBeNull();
    // My turn: I'm the one being waited on.
    expect(nudgeAvailableAt(makeGame({ current_player_id: "me" }), "me")).toBeNull();
  });

  it("gates on one hour since they went on the clock", () => {
    const game = waiting();
    expect(nudgeAvailableAt(game, "me")).toBe(T0 + NUDGE_TURN_IDLE_MS);
    expect(canNudge(game, "me", T0 + NUDGE_TURN_IDLE_MS - 1)).toBe(false);
    expect(canNudge(game, "me", T0 + NUDGE_TURN_IDLE_MS)).toBe(true);
  });

  it("lets my own recent nudge dominate the idle gate", () => {
    // They went on the clock 2h before my nudge; the 4h nudge cooldown wins.
    const game = waiting({ creator_last_nudge_at: "2026-01-01T02:00:00Z" });
    expect(nudgeAvailableAt(game, "me")).toBe(Date.parse("2026-01-01T02:00:00Z") + NUDGE_COOLDOWN_MS);
  });

  it("keeps nudge cooldowns per seat", () => {
    // The creator's nudge doesn't gate the opponent (and vice versa) — here
    // I'm the opponent seat, waiting on the creator.
    const game = waiting({
      current_player_id: "me",
      creator_last_nudge_at: "2026-01-01T00:30:00Z",
    });
    // From the opponent seat ("them"), only the idle gate applies.
    expect(nudgeAvailableAt(game, "them")).toBe(T0 + NUDGE_TURN_IDLE_MS);
  });

  it("parses both REST-ISO and Electric/Postgres timestamp formats", () => {
    const iso = waiting({ updated_at: "2026-01-01T00:00:00Z" });
    const pg = waiting({ updated_at: "2026-01-01 00:00:00+00" });
    const pgFractional = waiting({ updated_at: "2026-01-01 00:00:00.123456+00" });
    expect(nudgeAvailableAt(iso, "me")).toBe(T0 + NUDGE_TURN_IDLE_MS);
    expect(nudgeAvailableAt(pg, "me")).toBe(T0 + NUDGE_TURN_IDLE_MS);
    expect(nudgeAvailableAt(pgFractional, "me")).toBe(T0 + 123 + NUDGE_TURN_IDLE_MS);
  });
});
