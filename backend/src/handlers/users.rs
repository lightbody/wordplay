use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;

use super::error::AppError;
use crate::{
    auth::AuthUser,
    models::{CreateUser, User},
    AppState,
};

pub fn valid_username(name: &str) -> bool {
    let len = name.chars().count();
    (3..=20).contains(&len) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub async fn get_me(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
) -> Result<Json<User>, AppError> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, username, default_deduct_unused, created_at FROM users WHERE id = $1",
    )
    .bind(&user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(user))
}

pub async fn create_me(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Json(payload): Json<CreateUser>,
) -> Result<(StatusCode, Json<User>), AppError> {
    let username = payload.username.trim().to_string();
    if !valid_username(&username) {
        return Err(AppError::bad_request("invalid_username"));
    }

    // Case-insensitive uniqueness (enforced by users_username_lower_idx).
    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (id, username) VALUES ($1, $2)
         RETURNING id, username, default_deduct_unused, created_at",
    )
    .bind(&user_id)
    .bind(&username)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            // id PK collision means the user already onboarded; username
            // index collision means the name is taken.
            if db.constraint() == Some("users_pkey") {
                AppError::conflict("already_registered")
            } else {
                AppError::conflict("username_taken")
            }
        }
        other => AppError::Database(other),
    })?;

    Ok((StatusCode::CREATED, Json(user)))
}

pub async fn check_username(
    State(state): State<AppState>,
    AuthUser { .. }: AuthUser,
    Path(username): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !valid_username(&username) {
        return Ok(Json(json!({ "available": false, "reason": "invalid" })));
    }
    let taken: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM users WHERE lower(username) = lower($1)")
            .bind(&username)
            .fetch_optional(&state.pool)
            .await?;
    Ok(Json(json!({ "available": taken.is_none() })))
}
