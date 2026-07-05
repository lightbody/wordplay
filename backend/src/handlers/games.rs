use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rand::thread_rng;
use serde_json::json;
use uuid::Uuid;

use super::error::AppError;
use crate::{
    auth::AuthUser,
    engine::tiles,
    models::{Challenge, CreateGame, Game, Move, GAME_COLUMNS, MOVE_COLUMNS},
    AppState,
};

async fn load_username(state: &AppState, user_id: &str) -> Result<String, AppError> {
    sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn create_game(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Json(payload): Json<CreateGame>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let creator_username = load_username(&state, &user_id).await?;

    let mut bag = tiles::shuffled_bag(&mut thread_rng());
    let mut rack = String::new();
    tiles::draw(&mut bag, &mut rack);
    let tiles_remaining = bag.chars().count() as i32;

    let mut tx = state.pool.begin().await?;

    // Remember the option as this user's default for next time.
    sqlx::query("UPDATE users SET default_deduct_unused = $1 WHERE id = $2")
        .bind(payload.deduct_unused)
        .bind(&user_id)
        .execute(&mut *tx)
        .await?;

    let game = sqlx::query_as::<_, Game>(&format!(
        "INSERT INTO games (creator_id, creator_username, current_player_id, deduct_unused,
             tiles_remaining, creator_rack_count)
         VALUES ($1, $2, $1, $3, $4, $5)
         RETURNING {GAME_COLUMNS}"
    ))
    .bind(&user_id)
    .bind(&creator_username)
    .bind(payload.deduct_unused)
    .bind(tiles_remaining)
    .bind(rack.chars().count() as i32)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query("INSERT INTO game_secrets (game_id, bag) VALUES ($1, $2)")
        .bind(game.id)
        .bind(&bag)
        .execute(&mut *tx)
        .await?;

    sqlx::query("INSERT INTO game_players (game_id, user_id, rack) VALUES ($1, $2, $3)")
        .bind(game.id)
        .bind(&user_id)
        .bind(&rack)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(json!({ "game": game, "rack": rack }))))
}

pub async fn get_game(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let game = sqlx::query_as::<_, Game>(&format!("SELECT {GAME_COLUMNS} FROM games WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;

    if game.creator_id != user_id && game.opponent_id.as_deref() != Some(&user_id) {
        return Err(AppError::Forbidden);
    }

    let rack: Option<String> =
        sqlx::query_scalar("SELECT rack FROM game_players WHERE game_id = $1 AND user_id = $2")
            .bind(id)
            .bind(&user_id)
            .fetch_optional(&state.pool)
            .await?;

    let moves = sqlx::query_as::<_, Move>(&format!(
        "SELECT {MOVE_COLUMNS} FROM moves WHERE game_id = $1 ORDER BY move_number ASC"
    ))
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({ "game": game, "rack": rack, "moves": moves })))
}

pub async fn challenge(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(id): Path<Uuid>,
    Json(payload): Json<Challenge>,
) -> Result<Json<Game>, AppError> {
    let mut tx = state.pool.begin().await?;

    let game = sqlx::query_as::<_, Game>(&format!(
        "SELECT {GAME_COLUMNS} FROM games WHERE id = $1 FOR UPDATE"
    ))
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if game.creator_id != user_id {
        return Err(AppError::Forbidden);
    }
    if game.opponent_id.is_some() {
        return Err(AppError::conflict("already_has_opponent"));
    }

    let opponent = sqlx::query_as::<_, (String, String)>(
        "SELECT id, username FROM users WHERE lower(username) = lower($1)",
    )
    .bind(&payload.username)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    if opponent.0 == user_id {
        return Err(AppError::conflict("cannot_challenge_self"));
    }

    let game = attach_opponent(&mut tx, &game, &opponent.0, &opponent.1).await?;
    tx.commit().await?;
    Ok(Json(game))
}

/// Link `opponent_id` to the game, deal their rack from the bag, activate
/// the game, and set the current turn. Shared by challenge + invite accept.
/// Assumes the caller holds a `FOR UPDATE` lock on the game row.
pub async fn attach_opponent(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game: &Game,
    opponent_id: &str,
    opponent_username: &str,
) -> Result<Game, AppError> {
    let mut bag: String =
        sqlx::query_scalar("SELECT bag FROM game_secrets WHERE game_id = $1 FOR UPDATE")
            .bind(game.id)
            .fetch_one(&mut **tx)
            .await?;

    let mut rack = String::new();
    tiles::draw(&mut bag, &mut rack);

    sqlx::query("INSERT INTO game_players (game_id, user_id, rack) VALUES ($1, $2, $3)")
        .bind(game.id)
        .bind(opponent_id)
        .bind(&rack)
        .execute(&mut **tx)
        .await?;

    sqlx::query("UPDATE game_secrets SET bag = $1 WHERE game_id = $2")
        .bind(&bag)
        .bind(game.id)
        .execute(&mut **tx)
        .await?;

    // If the creator already played the opening move, it's the opponent's
    // turn; otherwise the creator still owes the opening move.
    let next_player = if game.move_count >= 1 {
        opponent_id
    } else {
        game.creator_id.as_str()
    };
    let updated = sqlx::query_as::<_, Game>(&format!(
        "UPDATE games SET status = 'active', opponent_id = $1, opponent_username = $2,
             opponent_rack_count = $3, current_player_id = $4,
             tiles_remaining = $5, updated_at = now()
         WHERE id = $6
         RETURNING {GAME_COLUMNS}"
    ))
    .bind(opponent_id)
    .bind(opponent_username)
    .bind(rack.chars().count() as i32)
    .bind(next_player)
    .bind(bag.chars().count() as i32)
    .bind(game.id)
    .fetch_one(&mut **tx)
    .await?;

    Ok(updated)
}
