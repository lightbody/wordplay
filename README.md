# Wordplay

A Scrabble-like, two-player, turn-based word game. Play at
[wordplay.lightbody.net](https://wordplay.lightbody.net).

Register with WorkOS, pick a username, start a game by playing your opening
word, then challenge a friend by username or share a mobile-friendly invite
link. Games sync in real time — you see your opponent's move land on the
board the moment they play it.

## Stack

Mirrors the architecture of the `todo` reference app:

| Layer | Tech |
|---|---|
| Backend | Rust + Axum, deployed on Fly.io |
| Database | Neon (serverless Postgres) |
| Realtime | ElectricSQL shape streams, auth-proxied through the backend |
| Auth | WorkOS AuthKit (stateless bearer JWTs) |
| Frontend | React + Vite SPA on Cloudflare Pages, `motion` animations, `recharts` |
| CI/CD | GitHub Actions with per-PR preview stacks |

### How it fits together

- **Reads** flow through Electric: the client subscribes to shapes
  (`games`, `racks`, `moves`) via the backend's `/shape` proxy, which
  injects a server-enforced `where` filter so a player only ever receives
  their own rows.
- **Writes** are plain REST calls (`POST /games/:id/moves`, …). The backend
  validates the move with its game engine, updates Postgres in a
  transaction, and Electric streams the result back to both players.
- **Information hiding**: a player's rack lives in `game_players` (shape-
  filtered to its owner) and the tile bag lives in `game_secrets`, which
  **no shape view maps to** — so the bag can never reach a client.

## Layout

```
backend/     Rust/Axum API + game engine (src/engine) + migrations
electric/    ElectricSQL Fly deployment (prebuilt image)
frontend/    React SPA; functions/ holds the OG-preview Pages Function
docker-compose.yml   Local Postgres (wal_level=logical) + Electric
.github/     CI workflows + preview-env scripts
```

The game rules live in `backend/src/engine/` as pure, dependency-free Rust
(board layout, tile bag, move validation, word extraction, scoring, the
ENABLE dictionary, and end-game logic) with ~44 unit tests. A trimmed
mirror in `frontend/src/engine.ts` powers the live score preview; the
server always has the final say (and owns the dictionary).

## Local development

```bash
# 1. Start Postgres + Electric
docker compose up

# 2. Backend
cd backend
cp .env.example .env
cp .env.local.example .env.local   # fill in WORKOS_JWKS_URL
cargo run                          # runs migrations on startup, listens on :8080

# 3. Frontend
cd frontend
cp .env.example .env
cp .env.local.example .env.local   # fill in VITE_WORKOS_CLIENT_ID
npm install
npm run dev                        # Vite dev server on :5173, proxies /api -> :8080
```

Open two browser profiles signed in as different users to play a full game.

### Tests

```bash
cd backend && cargo test           # engine unit tests + HTTP integration tests
cd frontend && npm test            # engine mirror (vitest)
```

The integration tests need a Postgres (`DATABASE_URL`), mint their own
RS256 JWTs (no WorkOS dependency), and stub Electric to assert the shape
proxy's enforced filters — including that no view can reach `game_secrets`.

## One-time infrastructure setup

1. **WorkOS** — note the Production **Client ID** and **JWKS URL**. Register
   redirect URIs: `https://wordplay.lightbody.net`, `http://localhost:5173`,
   and the wildcard `https://*.wordplay-frontend.pages.dev` (so PR previews
   share one user pool).
2. **Neon** — create a Postgres 16 project. The backend uses the **pooled**
   connection string; Electric needs the **direct** (non-pooled) string —
   logical replication does not work through Neon's pooler. Note
   `NEON_PROJECT_ID` and create a `NEON_API_KEY`.
3. **Fly** — create apps `plightbo-wordplay-backend` and
   `plightbo-wordplay-electric`. Backend secrets: `DATABASE_URL` (pooled),
   `WORKOS_JWKS_URL`, `ELECTRIC_URL=https://plightbo-wordplay-electric.fly.dev`,
   `ALLOWED_ORIGIN=https://wordplay.lightbody.net`,
   `PUBLIC_APP_URL=https://wordplay.lightbody.net`. Electric secret:
   `DATABASE_URL` (direct).
4. **Cloudflare Pages** — create project `wordplay-frontend` with an empty
   build config (Actions builds and uploads). Add the custom domain
   `wordplay.lightbody.net`, and set the project env var
   `BACKEND_URL=https://plightbo-wordplay-backend.fly.dev` (used by the
   OG-preview Pages Function).
5. **GitHub repo secrets**: `FLY_API_TOKEN`, `FLY_ORG`, `NEON_API_KEY`,
   `NEON_PROJECT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `VITE_WORKOS_CLIENT_ID`, `WORKOS_JWKS_URL`.

Every pull request gets an isolated preview stack (a Neon branch plus
dedicated backend/Electric Fly apps and a Pages preview), torn down on
close.

## Game rules

Standard Scrabble to start: 15×15 board with the usual premium squares,
the opening move must cover the center star, standard 100-tile English
distribution and letter values, 7-tile racks replenished from the bag, and
two blanks. Turn actions are **play**, **swap** 1–7 tiles (requires ≥7 in
the bag; costs your turn), **pass**, and **resign**. Words are validated
server-side against the ENABLE word list.

**Game options** (remembered as your default for next time):
- *Deduct unused tile values from final score* — at game end, each player
  loses points for the tiles left on their rack.

**Ending**: when the bag empties, each player gets one final move, then the
game ends (a player who uses their last tile with an empty bag ends it
immediately). Six consecutive scoreless turns also end a game, as does a
resignation. The end-of-game summary shows final scores (with any unused-
tile adjustment), per-player stats (best/average/lowest move, bingos), and
a chart of both scores over the course of the game.

## Notes

- The `og.png` share image is a plain gradient placeholder — replace it
  with a designed 1200×630 image whenever you like.
- No push/browser notifications and no native app yet; the bearer-token
  JSON API keeps the native-app door open.
