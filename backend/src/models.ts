// DB row shapes + request DTOs. Ported from backend/src/models.rs.
//
// Postgres column names are already snake_case and match the JSON shape the
// frontend expects (there's no serde rename_all in the Rust structs), so
// these interfaces intentionally mirror the DB columns verbatim.

import type { PlacedTile } from "@wordplay/shared";
import { AppError } from "./errors.js";

export interface User {
  id: string;
  username: string;
  default_deduct_unused: boolean;
  avatar_emoji: string;
  avatar_color: string;
  created_at: string;
}

export interface Game {
  id: string;
  status: "awaiting_opponent" | "active" | "finished";
  creator_id: string;
  opponent_id: string | null;
  creator_username: string;
  opponent_username: string | null;
  creator_avatar_emoji: string;
  creator_avatar_color: string;
  opponent_avatar_emoji: string | null;
  opponent_avatar_color: string | null;
  current_player_id: string | null;
  deduct_unused: boolean;
  board: string;
  tiles_remaining: number;
  creator_rack_count: number;
  opponent_rack_count: number;
  creator_score: number;
  opponent_score: number;
  move_count: number;
  scoreless_streak: number;
  final_moves_remaining: number | null;
  ended_reason: string | null;
  winner_id: string | null;
  creator_adjustment: number;
  opponent_adjustment: number;
  created_at: string;
  updated_at: string;
}

export interface Move {
  id: string;
  game_id: string;
  user_id: string;
  move_number: number;
  move_type: "play" | "swap" | "pass" | "resign";
  tiles: PlacedTile[] | null;
  words: unknown;
  swap_count: number | null;
  score: number;
  created_at: string;
}

export const GAME_COLUMNS =
  "id, status, creator_id, opponent_id, creator_username, " +
  "opponent_username, creator_avatar_emoji, creator_avatar_color, " +
  "opponent_avatar_emoji, opponent_avatar_color, current_player_id, deduct_unused, board, tiles_remaining, " +
  "creator_rack_count, opponent_rack_count, creator_score, opponent_score, move_count, " +
  "scoreless_streak, final_moves_remaining, ended_reason, winner_id, creator_adjustment, " +
  "opponent_adjustment, created_at, updated_at";

export const MOVE_COLUMNS =
  "id, game_id, user_id, move_number, move_type, tiles, words, swap_count, score, created_at";

// --- request DTOs ---

export type MoveRequest =
  | { type: "play"; tiles: PlacedTile[] }
  | { type: "swap"; letters: string }
  | { type: "pass" }
  | { type: "resign" };

/** Malformed request bodies are a 400, matching axum's JSON-extractor rejections. */
export function parseMoveRequest(body: unknown): MoveRequest {
  if (typeof body !== "object" || body === null) throw AppError.badRequest("invalid_request");
  const b = body as Record<string, unknown>;
  switch (b.type) {
    case "play": {
      if (!Array.isArray(b.tiles)) throw AppError.badRequest("invalid_request");
      return { type: "play", tiles: b.tiles.map(parsePlacedTile) };
    }
    case "swap": {
      if (typeof b.letters !== "string") throw AppError.badRequest("invalid_request");
      return { type: "swap", letters: b.letters };
    }
    case "pass":
      return { type: "pass" };
    case "resign":
      return { type: "resign" };
    default:
      throw AppError.badRequest("invalid_request");
  }
}

function parsePlacedTile(t: unknown): PlacedTile {
  if (typeof t !== "object" || t === null) throw AppError.badRequest("invalid_request");
  const o = t as Record<string, unknown>;
  if (typeof o.row !== "number" || typeof o.col !== "number" || typeof o.letter !== "string") {
    throw AppError.badRequest("invalid_request");
  }
  return { row: o.row, col: o.col, letter: o.letter, blank: o.blank === true };
}
