// Electric's useShape<T> requires T extends Row (an index signature).

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
  pending_opponent_id: string | null;
  pending_opponent_username: string | null;
  pending_opponent_avatar_emoji: string | null;
  pending_opponent_avatar_color: string | null;
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
  [key: string]: unknown;
}

export interface Rack {
  game_id: string;
  user_id: string;
  rack: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface Friend {
  user_id: string;
  friend_id: string;
  friend_username: string;
  friend_avatar_emoji: string;
  friend_avatar_color: string;
  created_at: string;
  [key: string]: unknown;
}

export interface PlayedWord {
  word: string;
  score: number;
}

export interface PlacedTileDto {
  row: number;
  col: number;
  letter: string;
  blank: boolean;
}

export interface Move {
  id: string;
  game_id: string;
  user_id: string;
  move_number: number;
  move_type: "play" | "swap" | "pass" | "resign";
  tiles: PlacedTileDto[] | null;
  words: PlayedWord[] | null;
  swap_count: number | null;
  score: number;
  created_at: string;
  [key: string]: unknown;
}

export interface Profile {
  id: string;
  username: string;
  default_deduct_unused: boolean;
  avatar_emoji: string;
  avatar_color: string;
  created_at: string;
}

/** A tile pending placement on the board (not yet submitted). */
export interface PendingTile {
  row: number;
  col: number;
  /** Rack index this tile came from. */
  rackIndex: number;
  letter: string;
  blank: boolean;
}
