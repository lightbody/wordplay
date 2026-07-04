//! Generalized Electric shape proxy with a server-side view registry.
//!
//! Clients call `GET /shape?view=<name>[&game_id=<uuid>]` plus Electric
//! protocol params (offset, handle, live, cursor). The proxy strips any
//! client-supplied `table`/`where`/`columns`/`params`, looks the view up in
//! a fixed registry, and injects a server-enforced filter. The bag lives in
//! `game_secrets`, which has no view, so it can never be synced to a client.

use std::collections::HashMap;

use axum::{
    body::Body,
    extract::{Query, State},
    response::Response,
};
use uuid::Uuid;

use super::error::AppError;
use crate::{auth::AuthUser, AppState};

/// Reject anything that isn't a plain WorkOS-style identifier before we
/// interpolate it into a shape `where` clause.
fn safe_user_id(user_id: &str) -> Result<&str, AppError> {
    if !user_id.is_empty() && user_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        Ok(user_id)
    } else {
        Err(AppError::bad_request("invalid_user_id"))
    }
}

pub async fn shape_proxy(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, AppError> {
    let me = safe_user_id(&user_id)?;
    let view = params.get("view").map(String::as_str).unwrap_or("");

    // Compose the enforced (table, where, columns) for this view.
    let (table, where_clause, columns): (&str, String, Option<&str>) = match view {
        "games" => (
            "games",
            format!("creator_id = '{me}' OR opponent_id = '{me}'"),
            None,
        ),
        "racks" => (
            "game_players",
            format!("user_id = '{me}'"),
            Some("game_id,user_id,rack,updated_at"),
        ),
        "moves" => {
            let game_id: Uuid = params
                .get("game_id")
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| AppError::bad_request("game_id_required"))?;
            // Membership check: only participants may stream a game's moves.
            let is_member: Option<i32> = sqlx::query_scalar(
                "SELECT 1 FROM games WHERE id = $1 AND (creator_id = $2 OR opponent_id = $2)",
            )
            .bind(game_id)
            .bind(me)
            .fetch_optional(&state.pool)
            .await?;
            if is_member.is_none() {
                return Err(AppError::Forbidden);
            }
            ("moves", format!("game_id = '{game_id}'"), None)
        }
        _ => return Err(AppError::bad_request("unknown_view")),
    };

    // Forward only Electric protocol params; drop everything client-chosen.
    let mut forward: Vec<(String, String)> = params
        .iter()
        .filter(|(k, _)| matches!(k.as_str(), "offset" | "handle" | "live" | "cursor"))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    forward.push(("table".into(), table.into()));
    forward.push(("where".into(), where_clause));
    if let Some(cols) = columns {
        forward.push(("columns".into(), cols.into()));
    }

    let upstream = state
        .http_client
        .get(format!("{}/v1/shape", state.electric_url))
        .query(&forward)
        .send()
        .await
        .map_err(AppError::Upstream)?;

    let status = upstream.status();
    let headers = upstream.headers().clone();
    let stream = upstream.bytes_stream();

    let mut builder = Response::builder().status(status);
    for (name, value) in &headers {
        match name.as_str() {
            "connection" | "keep-alive" | "transfer-encoding" | "te" | "trailer"
            | "proxy-authorization" | "proxy-authenticate" | "upgrade" => {}
            _ => builder = builder.header(name, value),
        }
    }
    Ok(builder.body(Body::from_stream(stream)).unwrap())
}
