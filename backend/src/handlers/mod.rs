use axum::{http::StatusCode, response::IntoResponse, Json};

pub mod error;
pub mod games;
pub mod invites;
pub mod moves;
pub mod shape;
pub mod users;

pub async fn health() -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({ "status": "ok" })))
}
