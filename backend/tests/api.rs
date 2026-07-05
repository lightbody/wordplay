//! HTTP integration tests. Requires a Postgres reachable via DATABASE_URL
//! (defaults to the CI service). Auth is exercised with locally minted
//! RS256 JWTs whose public key is injected into the app's JwkSet, so no
//! WorkOS network dependency is needed.

use std::sync::{Arc, Mutex, OnceLock};

use axum::body::Body;
use axum::Router;
use base64::Engine;
use http::{Request, StatusCode};
use http_body_util::BodyExt;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use rsa::pkcs8::{EncodePrivateKey, LineEnding};
use rsa::traits::PublicKeyParts;
use rsa::{RsaPrivateKey, RsaPublicKey};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tokio::sync::RwLock;
use tower::ServiceExt;

use wordplay_backend::{app, AppState};

const KID: &str = "test-key";

struct Keys {
    encoding: EncodingKey,
    jwks: JwkSet,
}

fn keys() -> &'static Keys {
    static KEYS: OnceLock<Keys> = OnceLock::new();
    KEYS.get_or_init(|| {
        let mut rng = rand::thread_rng();
        let priv_key = RsaPrivateKey::new(&mut rng, 2048).expect("generate key");
        let pub_key = RsaPublicKey::from(&priv_key);
        let pem = priv_key.to_pkcs8_pem(LineEnding::LF).expect("pem");
        let encoding = EncodingKey::from_rsa_pem(pem.as_bytes()).expect("encoding key");

        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let n = b64.encode(pub_key.n().to_bytes_be());
        let e = b64.encode(pub_key.e().to_bytes_be());
        let jwks: JwkSet = serde_json::from_value(json!({
            "keys": [{ "kty": "RSA", "use": "sig", "alg": "RS256", "kid": KID, "n": n, "e": e }]
        }))
        .expect("jwks");

        Keys { encoding, jwks }
    })
}

fn token(sub: &str) -> String {
    #[derive(Serialize)]
    struct Claims {
        sub: String,
        exp: usize,
    }
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(KID.to_string());
    encode(
        &header,
        &Claims { sub: sub.to_string(), exp: 4_102_444_800 }, // year 2100
        &keys().encoding,
    )
    .unwrap()
}

/// Fake Electric that records the query string of the last shape request.
async fn spawn_electric_stub() -> (String, Arc<Mutex<Option<String>>>) {
    use axum::extract::RawQuery;
    let seen: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let seen2 = seen.clone();
    let router = Router::new().route(
        "/v1/shape",
        axum::routing::get(move |RawQuery(q): RawQuery| {
            let seen = seen2.clone();
            async move {
                *seen.lock().unwrap() = q;
                ([("electric-handle", "1")], "[]")
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (format!("http://{addr}"), seen)
}

/// Serializes DB access across tests: each test TRUNCATEs the shared
/// database, so they must not overlap.
fn db_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

async fn setup() -> (
    tokio::sync::MutexGuard<'static, ()>,
    Router,
    PgPool,
    Arc<Mutex<Option<String>>>,
) {
    let guard = db_lock().lock().await;
    let _ = tracing_subscriber::fmt().with_env_filter("wordplay_backend=error").try_init();
    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgresql://postgres:password@localhost:5432/wordplay?sslmode=disable".to_string()
    });
    let pool = PgPoolOptions::new().max_connections(5).connect(&url).await.unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    sqlx::query(
        "TRUNCATE users, games, game_players, game_secrets, moves, invites RESTART IDENTITY CASCADE",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (electric_url, seen) = spawn_electric_stub().await;

    let state = AppState {
        pool: pool.clone(),
        jwks: Arc::new(RwLock::new(keys().jwks.clone())),
        electric_url,
        public_app_url: "https://wordplay.example".to_string(),
        http_client: reqwest::Client::new(),
    };
    (guard, app(state, tower_http::cors::CorsLayer::permissive()), pool, seen)
}

// --- request helpers ---

struct Resp {
    status: StatusCode,
    body: Value,
}

async fn send(app: &Router, req: Request<Body>) -> Resp {
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    Resp { status, body }
}

fn get(path: &str, sub: Option<&str>) -> Request<Body> {
    let mut b = Request::builder().method("GET").uri(path);
    if let Some(s) = sub {
        b = b.header("Authorization", format!("Bearer {}", token(s)));
    }
    b.body(Body::empty()).unwrap()
}

fn post(path: &str, sub: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(path)
        .header("Authorization", format!("Bearer {}", token(sub)))
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn onboard(app: &Router, sub: &str, username: &str) {
    let r = send(app, post("/me", sub, json!({ "username": username }))).await;
    assert_eq!(r.status, StatusCode::CREATED, "onboard {username}: {:?}", r.body);
}

/// Directly seed a player's rack (bypassing the random draw) for
/// deterministic move tests.
async fn set_rack(pool: &PgPool, game_id: &str, user: &str, rack: &str) {
    let id: uuid::Uuid = game_id.parse().unwrap();
    sqlx::query("UPDATE game_players SET rack = $1 WHERE game_id = $2 AND user_id = $3")
        .bind(rack)
        .bind(id)
        .bind(user)
        .execute(pool)
        .await
        .unwrap();
}

// --- tests ---

#[tokio::test]
async fn onboarding_flow_and_username_uniqueness() {
    let (_guard, app, _pool, _) = setup().await;

    // Not onboarded yet.
    assert_eq!(send(&app, get("/me", Some("user_a"))).await.status, StatusCode::NOT_FOUND);

    onboard(&app, "user_a", "Alice").await;

    let me = send(&app, get("/me", Some("user_a"))).await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.body["username"], "Alice");

    // Case-insensitive collision from a different account.
    let dup = send(&app, post("/me", "user_b", json!({ "username": "alice" }))).await;
    assert_eq!(dup.status, StatusCode::CONFLICT);
    assert_eq!(dup.body["error"], "username_taken");

    // Availability endpoint reflects the taken name.
    let check = send(&app, get("/usernames/ALICE", Some("user_b"))).await;
    assert_eq!(check.body["available"], false);
    let free = send(&app, get("/usernames/bob", Some("user_b"))).await;
    assert_eq!(free.body["available"], true);
}

#[tokio::test]
async fn missing_auth_is_rejected() {
    let (_guard, app, _pool, _) = setup().await;
    assert_eq!(send(&app, get("/me", None)).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(send(&app, get("/shape?view=games", None)).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn full_two_player_game() {
    let (_guard, app, pool, _) = setup().await;
    onboard(&app, "creator", "Creator").await;
    onboard(&app, "joiner", "Joiner").await;

    // Create the game (deduct option on) and play the opening word.
    let created = send(&app, post("/games", "creator", json!({ "deduct_unused": true }))).await;
    assert_eq!(created.status, StatusCode::CREATED, "{:?}", created.body);
    let game_id = created.body["game"]["id"].as_str().unwrap().to_string();

    // Deterministic opening rack, then play HELLO through the center.
    set_rack(&pool, &game_id, "creator", "HELLOAB").await;
    let play = send(
        &app,
        post(
            &format!("/games/{game_id}/moves"),
            "creator",
            json!({ "type": "play", "tiles": [
                {"row":7,"col":5,"letter":"H","blank":false},
                {"row":7,"col":6,"letter":"E","blank":false},
                {"row":7,"col":7,"letter":"L","blank":false},
                {"row":7,"col":8,"letter":"L","blank":false},
                {"row":7,"col":9,"letter":"O","blank":false}
            ]}),
        ),
    )
    .await;
    assert_eq!(play.status, StatusCode::CREATED, "{:?}", play.body);
    assert_eq!(play.body["move"]["score"], 16);
    assert_eq!(play.body["game"]["creator_score"], 16);
    // Turn handed off to nobody yet (awaiting opponent).
    assert_eq!(play.body["game"]["current_player_id"], Value::Null);

    // An invalid word is rejected with the offending words listed.
    set_rack(&pool, &game_id, "creator", "ZQXJKVW").await;
    // (still awaiting; force creator's turn back for the negative test)
    sqlx::query("UPDATE games SET current_player_id = 'creator' WHERE id = $1::uuid")
        .bind(&game_id)
        .execute(&pool)
        .await
        .unwrap();
    let bad = send(
        &app,
        post(
            &format!("/games/{game_id}/moves"),
            "creator",
            json!({ "type": "play", "tiles": [
                {"row":8,"col":5,"letter":"Z","blank":false},
                {"row":9,"col":5,"letter":"Q","blank":false}
            ]}),
        ),
    )
    .await;
    assert_eq!(bad.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(bad.body["error"], "invalid_words");
    // reset turn to NULL (opening done) before opponent joins
    sqlx::query("UPDATE games SET current_player_id = NULL WHERE id = $1::uuid")
        .bind(&game_id)
        .execute(&pool)
        .await
        .unwrap();

    // Opponent joins by challenge.
    let ch = send(
        &app,
        post(&format!("/games/{game_id}/challenge"), "creator", json!({ "username": "Joiner" })),
    )
    .await;
    assert_eq!(ch.status, StatusCode::OK, "{:?}", ch.body);
    assert_eq!(ch.body["status"], "active");
    assert_eq!(ch.body["current_player_id"], "joiner");

    // Creator can't move out of turn.
    let out_of_turn = send(
        &app,
        post(&format!("/games/{game_id}/moves"), "creator", json!({ "type": "pass" })),
    )
    .await;
    assert_eq!(out_of_turn.status, StatusCode::CONFLICT);
    assert_eq!(out_of_turn.body["error"], "not_your_turn");

    // Opponent plays a connecting word: HELLO + S -> HELLOS.
    set_rack(&pool, &game_id, "joiner", "STUVWXY").await;
    let opp = send(
        &app,
        post(
            &format!("/games/{game_id}/moves"),
            "joiner",
            json!({ "type": "play", "tiles": [ {"row":7,"col":10,"letter":"S","blank":false} ]}),
        ),
    )
    .await;
    assert_eq!(opp.status, StatusCode::CREATED, "{:?}", opp.body);
    assert!(opp.body["move"]["score"].as_i64().unwrap() > 0);
    assert_eq!(opp.body["game"]["current_player_id"], "creator");

    // Creator resigns -> game finished, opponent wins.
    let resign = send(
        &app,
        post(&format!("/games/{game_id}/moves"), "creator", json!({ "type": "resign" })),
    )
    .await;
    assert_eq!(resign.status, StatusCode::CREATED);
    assert_eq!(resign.body["game"]["status"], "finished");
    assert_eq!(resign.body["game"]["ended_reason"], "resigned");
    assert_eq!(resign.body["game"]["winner_id"], "joiner");
}

#[tokio::test]
async fn invite_preview_and_accept() {
    let (_guard, app, _pool, _) = setup().await;
    onboard(&app, "host", "Host").await;
    onboard(&app, "guest", "Guest").await;

    let created = send(&app, post("/games", "host", json!({ "deduct_unused": false }))).await;
    let game_id = created.body["game"]["id"].as_str().unwrap().to_string();

    let invite = send(&app, post(&format!("/games/{game_id}/invites"), "host", json!({}))).await;
    assert_eq!(invite.status, StatusCode::CREATED, "{:?}", invite.body);
    let itoken = invite.body["token"].as_str().unwrap().to_string();

    // Public preview needs no auth.
    let preview = send(&app, get(&format!("/invites/{itoken}/preview"), None)).await;
    assert_eq!(preview.status, StatusCode::OK);
    assert_eq!(preview.body["inviter_username"], "Host");

    // Guest accepts and is linked as opponent.
    let accept = send(&app, post(&format!("/invites/{itoken}/accept"), "guest", json!({}))).await;
    assert_eq!(accept.status, StatusCode::OK, "{:?}", accept.body);
    assert_eq!(accept.body["game_id"], game_id);

    // Idempotent for the same claimer.
    let again = send(&app, post(&format!("/invites/{itoken}/accept"), "guest", json!({}))).await;
    assert_eq!(again.status, StatusCode::OK);

    // A third user can't claim it.
    onboard(&app, "third", "Third").await;
    let stolen = send(&app, post(&format!("/invites/{itoken}/accept"), "third", json!({}))).await;
    assert_eq!(stolen.status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn shape_proxy_enforces_authorization() {
    let (_guard, app, pool, seen) = setup().await;
    onboard(&app, "member", "Member").await;
    onboard(&app, "outsider", "Outsider").await;

    // Unknown view and missing params are rejected before hitting Electric.
    assert_eq!(send(&app, get("/shape?view=bogus", Some("member"))).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(send(&app, get("/shape?view=moves", Some("member"))).await.status, StatusCode::BAD_REQUEST);

    // games view forwards a where-clause scoped to the caller.
    let r = send(&app, get("/shape?view=games", Some("member"))).await;
    assert_eq!(r.status, StatusCode::OK);
    let q = seen.lock().unwrap().clone().unwrap();
    assert!(q.contains("member"), "where clause must scope to the user: {q}");
    assert!(q.contains("table=games"));
    // The bag table must never be reachable through any view.
    assert!(!q.contains("game_secrets"));

    // A non-participant cannot stream another game's moves.
    let created = send(&app, post("/games", "member", json!({ "deduct_unused": false }))).await;
    let game_id = created.body["game"]["id"].as_str().unwrap().to_string();
    let _ = &pool;
    let forbidden = send(
        &app,
        get(&format!("/shape?view=moves&game_id={game_id}"), Some("outsider")),
    )
    .await;
    assert_eq!(forbidden.status, StatusCode::FORBIDDEN);
}
