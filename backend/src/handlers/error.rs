use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde_json::json;

/// Application error with a stable machine-readable `code` plus optional
/// structured detail (e.g. the list of invalid words).
pub enum AppError {
    Database(sqlx::Error),
    Upstream(reqwest::Error),
    NotFound,
    Forbidden,
    /// (status, code, optional detail object merged into the JSON body)
    Status(StatusCode, &'static str, Option<serde_json::Value>),
}

impl AppError {
    pub fn bad_request(code: &'static str) -> Self {
        AppError::Status(StatusCode::BAD_REQUEST, code, None)
    }
    pub fn conflict(code: &'static str) -> Self {
        AppError::Status(StatusCode::CONFLICT, code, None)
    }
    pub fn unprocessable(code: &'static str, detail: Option<serde_json::Value>) -> Self {
        AppError::Status(StatusCode::UNPROCESSABLE_ENTITY, code, detail)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Database(e)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            AppError::Database(e) => {
                tracing::error!("database error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    json!({ "error": "internal_server_error" }),
                )
            }
            AppError::Upstream(e) => {
                tracing::error!("upstream error: {e}");
                (StatusCode::BAD_GATEWAY, json!({ "error": "upstream_error" }))
            }
            AppError::NotFound => (StatusCode::NOT_FOUND, json!({ "error": "not_found" })),
            AppError::Forbidden => (StatusCode::FORBIDDEN, json!({ "error": "forbidden" })),
            AppError::Status(status, code, detail) => {
                let mut obj = json!({ "error": code });
                if let Some(serde_json::Value::Object(extra)) = detail {
                    if let serde_json::Value::Object(map) = &mut obj {
                        map.extend(extra);
                    }
                }
                (status, obj)
            }
        };
        (status, Json(body)).into_response()
    }
}
