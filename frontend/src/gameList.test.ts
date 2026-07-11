import { describe, expect, it } from "vitest";
import { canRematch, opponentIdOf, visibleGame } from "./gameList";
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
