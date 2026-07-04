// Auth: WorkOS JWTs validated against WORKOS_JWKS_URL (see auth.rs).
use axum::{
    routing::{get, post},
    Router,
};
use dotenvy::dotenv;
use http::HeaderValue;
use jsonwebtoken::jwk::JwkSet;
use reqwest::Client;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::{
    env,
    net::{Ipv6Addr, SocketAddr},
    sync::Arc,
};
use tokio::sync::RwLock;
use tower_http::cors::{AllowHeaders, AllowMethods, CorsLayer};

mod auth;
mod engine;
mod handlers;
mod models;

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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();
    // .env.local overrides .env — gitignored, holds real secrets locally
    dotenvy::from_filename_override(".env.local").ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "wordplay_backend=debug,tower_http=debug".into()),
        )
        .init();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse()
        .expect("PORT must be a valid number");
    let allowed_origin =
        env::var("ALLOWED_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".to_string());
    let public_app_url =
        env::var("PUBLIC_APP_URL").unwrap_or_else(|_| "http://localhost:5173".to_string());
    let workos_jwks_url = env::var("WORKOS_JWKS_URL").expect("WORKOS_JWKS_URL must be set");
    let electric_url = env::var("ELECTRIC_URL").expect("ELECTRIC_URL must be set");

    let http_client = Client::new();

    let jwks: JwkSet = http_client.get(&workos_jwks_url).send().await?.json().await?;
    tracing::info!("loaded {} WorkOS JWKS key(s)", jwks.keys.len());

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("migrations applied");

    let state = AppState {
        pool,
        jwks: Arc::new(RwLock::new(jwks)),
        electric_url,
        public_app_url,
        http_client,
    };

    let origin: HeaderValue = allowed_origin.parse()?;
    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_methods(AllowMethods::any())
        .allow_headers(AllowHeaders::any());

    let app = app(state, cors);

    let addr = SocketAddr::from((Ipv6Addr::UNSPECIFIED, port));
    tracing::info!("listening on {addr} 🚀");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
