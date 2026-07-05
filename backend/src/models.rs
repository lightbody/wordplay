use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::engine::moves::PlacedTile;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub username: String,
    pub default_deduct_unused: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Game {
    pub id: Uuid,
    pub status: String,
    pub creator_id: String,
    pub opponent_id: Option<String>,
    pub creator_username: String,
    pub opponent_username: Option<String>,
    pub current_player_id: Option<String>,
    pub deduct_unused: bool,
    pub board: String,
    pub tiles_remaining: i32,
    pub creator_rack_count: i32,
    pub opponent_rack_count: i32,
    pub creator_score: i32,
    pub opponent_score: i32,
    pub move_count: i32,
    pub scoreless_streak: i32,
    pub final_moves_remaining: Option<i32>,
    pub ended_reason: Option<String>,
    pub winner_id: Option<String>,
    pub creator_adjustment: i32,
    pub opponent_adjustment: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Move {
    pub id: Uuid,
    pub game_id: Uuid,
    pub user_id: String,
    pub move_number: i32,
    pub move_type: String,
    pub tiles: Option<serde_json::Value>,
    pub words: Option<serde_json::Value>,
    pub swap_count: Option<i32>,
    pub score: i32,
    pub created_at: DateTime<Utc>,
}

pub const GAME_COLUMNS: &str = "id, status, creator_id, opponent_id, creator_username, \
    opponent_username, current_player_id, deduct_unused, board, tiles_remaining, \
    creator_rack_count, opponent_rack_count, creator_score, opponent_score, move_count, \
    scoreless_streak, final_moves_remaining, ended_reason, winner_id, creator_adjustment, \
    opponent_adjustment, created_at, updated_at";

pub const MOVE_COLUMNS: &str =
    "id, game_id, user_id, move_number, move_type, tiles, words, swap_count, score, created_at";

// --- request/response DTOs ---

#[derive(Debug, Deserialize)]
pub struct CreateUser {
    pub username: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateGame {
    pub deduct_unused: bool,
}

#[derive(Debug, Deserialize)]
pub struct Challenge {
    pub username: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MoveRequest {
    Play { tiles: Vec<PlacedTile> },
    Swap { letters: String },
    Pass,
    Resign,
}
