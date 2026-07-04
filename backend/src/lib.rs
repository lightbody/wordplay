use axum::{
    routing::{get, post},
    Router,
};
use jsonwebtoken::jwk::JwkSet;
use reqwest::Client;
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;

pub mod auth;
pub mod engine;
pub mod handlers;
pub mod models;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwks: Arc<RwLock<JwkSet>>,
    pub electric_url: String,
    pub public_app_url: String,
    pub http_client: Client,
}

pub fn app(state: AppState, cors: CorsLayer) -> Router {
    Router::new()
        .route("/health", get(handlers::health))
        .route("/shape", get(handlers::shape::shape_proxy))
        .route("/me", get(handlers::users::get_me).post(handlers::users::create_me))
        .route("/usernames/:username", get(handlers::users::check_username))
        .route("/games", post(handlers::games::create_game))
        .route("/games/:id", get(handlers::games::get_game))
        .route("/games/:id/moves", post(handlers::moves::make_move))
        .route("/games/:id/challenge", post(handlers::games::challenge))
        .route("/games/:id/invites", post(handlers::invites::create_invite))
        .route("/invites/:token/preview", get(handlers::invites::invite_preview))
        .route("/invites/:token/accept", post(handlers::invites::accept_invite))
        .with_state(state)
        .layer(cors)
}
