use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Json},
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;

use crate::AppState;

pub struct AuthUser {
    pub user_id: String,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
}

#[async_trait::async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(AuthError::Missing)?;

        let header = decode_header(token).map_err(|_| AuthError::Invalid)?;
        let kid = header.kid.ok_or(AuthError::Invalid)?;

        let jwks = state.jwks.read().await;
        let jwk = jwks.find(&kid).ok_or(AuthError::Invalid)?;
        let key = DecodingKey::from_jwk(jwk).map_err(|_| AuthError::Invalid)?;

        let mut validation = Validation::new(Algorithm::RS256);
        // No issuer check: the JWKS signature already proves the token is
        // from WorkOS. WorkOS's iss claim is an opaque internal ID that
        // differs from the public client ID, making static validation brittle.
        validation.validate_aud = false;

        let claims = decode::<Claims>(token, &key, &validation)
            .map_err(|_| AuthError::Invalid)?
            .claims;

        Ok(AuthUser { user_id: claims.sub })
    }
}

pub enum AuthError {
    Missing,
    Invalid,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match self {
            AuthError::Missing => (StatusCode::UNAUTHORIZED, "missing authorization header"),
            AuthError::Invalid => (StatusCode::UNAUTHORIZED, "invalid token"),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
