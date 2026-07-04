use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rand::distributions::{Alphanumeric, DistString};
use serde_json::json;
use uuid::Uuid;

use super::{error::AppError, games::attach_opponent};
use crate::{
    auth::AuthUser,
    models::{Game, GAME_COLUMNS},
    AppState,
};

pub async fn create_invite(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(game_id): Path<Uuid>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let game = sqlx::query_as::<_, Game>(&format!("SELECT {GAME_COLUMNS} FROM games WHERE id = $1"))
        .bind(game_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::NotFound)?;
    if game.creator_id != user_id {
        return Err(AppError::Forbidden);
    }
    if game.opponent_id.is_some() {
        return Err(AppError::conflict("already_has_opponent"));
    }

    let token = Alphanumeric.sample_string(&mut rand::thread_rng(), 22);
    sqlx::query("INSERT INTO invites (token, game_id, created_by) VALUES ($1, $2, $3)")
        .bind(&token)
        .bind(game_id)
        .bind(&user_id)
        .execute(&state.pool)
        .await?;

    let url = format!("{}/invite/{}", state.public_app_url, token);
    Ok((StatusCode::CREATED, Json(json!({ "token": token, "url": url }))))
}

/// Public (unauthenticated) minimal preview for OpenGraph unfurling.
pub async fn invite_preview(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let row = sqlx::query_as::<_, (String, Uuid)>(
        "SELECT i.created_by, i.game_id FROM invites i
         WHERE i.token = $1 AND i.status = 'pending'",
    )
    .bind(&token)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let inviter_username: String =
        sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
            .bind(&row.0)
            .fetch_one(&state.pool)
            .await?;

    // First word played in the game, if any (main word of move 1).
    let first_word: Option<String> = sqlx::query_scalar(
        "SELECT words->0->>'word' FROM moves
         WHERE game_id = $1 AND move_type = 'play' ORDER BY move_number ASC LIMIT 1",
    )
    .bind(row.1)
    .fetch_optional(&state.pool)
    .await?
    .flatten();

    Ok(Json(json!({
        "inviter_username": inviter_username,
        "first_word": first_word,
    })))
}

pub async fn accept_invite(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut tx = state.pool.begin().await?;

    let invite = sqlx::query_as::<_, (Uuid, String, String, Option<String>)>(
        "SELECT game_id, created_by, status, claimed_by FROM invites WHERE token = $1 FOR UPDATE",
    )
    .bind(&token)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    let (game_id, created_by, status, claimed_by) = invite;

    // Idempotent: if this caller already claimed it, just return the game.
    if status == "claimed" {
        if claimed_by.as_deref() == Some(&user_id) {
            return Ok(Json(json!({ "game_id": game_id })));
        }
        return Err(AppError::conflict("already_claimed"));
    }
    if status != "pending" {
        return Err(AppError::conflict("invite_revoked"));
    }
    if created_by == user_id {
        return Err(AppError::conflict("cannot_accept_own_invite"));
    }

    let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(&user_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;

    let game = sqlx::query_as::<_, Game>(&format!(
        "SELECT {GAME_COLUMNS} FROM games WHERE id = $1 FOR UPDATE"
    ))
    .bind(game_id)
    .fetch_one(&mut *tx)
    .await?;
    if game.opponent_id.is_some() {
        return Err(AppError::conflict("already_has_opponent"));
    }

    attach_opponent(&mut tx, &game, &user_id, &username).await?;

    sqlx::query(
        "UPDATE invites SET status = 'claimed', claimed_by = $1, claimed_at = now() WHERE token = $2",
    )
    .bind(&user_id)
    .bind(&token)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Json(json!({ "game_id": game_id })))
}
