-- Wordplay initial schema.
--
-- Sync classes (enforced by the backend's /shape view registry):
--   * games, moves        — public to both players, synced via Electric shapes
--   * game_players        — per-player secrets (rack), shape-filtered to owner
--   * game_secrets        — server-only (the tile bag); NO shape view maps to
--                           this table, so its rows can never reach a client.

CREATE TABLE users (
    id                    TEXT PRIMARY KEY,           -- WorkOS sub claim
    username              TEXT NOT NULL,
    default_deduct_unused BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE games (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status                TEXT NOT NULL DEFAULT 'awaiting_opponent'
                          CHECK (status IN ('awaiting_opponent', 'active', 'finished')),
    creator_id            TEXT NOT NULL REFERENCES users(id),
    opponent_id           TEXT REFERENCES users(id),
    -- Denormalized so the games shape is self-contained (no users shape
    -- needed). Usernames are immutable once chosen.
    creator_username      TEXT NOT NULL,
    opponent_username     TEXT,
    -- NULL while waiting for an opponent to join after the creator's first
    -- move, and once the game is finished.
    current_player_id     TEXT,
    deduct_unused         BOOLEAN NOT NULL,
    -- 225 chars, row-major. '.' = empty, 'A'-'Z' = tile, 'a'-'z' = blank
    -- played as that letter (scores 0).
    board                 TEXT NOT NULL DEFAULT repeat('.', 225),
    tiles_remaining       INT NOT NULL DEFAULT 86,
    creator_rack_count    INT NOT NULL DEFAULT 7,
    opponent_rack_count   INT NOT NULL DEFAULT 0,
    creator_score         INT NOT NULL DEFAULT 0,
    opponent_score        INT NOT NULL DEFAULT 0,
    move_count            INT NOT NULL DEFAULT 0,
    scoreless_streak      INT NOT NULL DEFAULT 0,
    -- NULL until the bag empties; then counts down 2, 1, 0 (one final move
    -- per player).
    final_moves_remaining INT,
    ended_reason          TEXT CHECK (ended_reason IN
                          ('resigned', 'played_out', 'bag_final_moves', 'scoreless_limit')),
    winner_id             TEXT,                       -- NULL = draw (or unfinished)
    -- End-game rack deductions (zero or negative), applied when the
    -- deduct_unused option is on. Final score = score + adjustment.
    creator_adjustment    INT NOT NULL DEFAULT 0,
    opponent_adjustment   INT NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX games_creator_idx ON games (creator_id);
CREATE INDEX games_opponent_idx ON games (opponent_id);

CREATE TABLE game_players (
    game_id    UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id),
    rack       TEXT NOT NULL DEFAULT '',   -- up to 7 of 'A'-'Z' plus '?' for blanks
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, user_id)
);
CREATE INDEX game_players_user_idx ON game_players (user_id);

CREATE TABLE game_secrets (
    game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    bag     TEXT NOT NULL    -- remaining tiles in draw order; draw = pop from front
);

CREATE TABLE moves (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    move_number INT NOT NULL,
    move_type   TEXT NOT NULL CHECK (move_type IN ('play', 'swap', 'pass', 'resign')),
    tiles       JSONB,        -- play only: [{row, col, letter, blank}]
    words       JSONB,        -- play only: [{word, score}], main word first
    swap_count  INT,          -- swap only: how many (which letters stays secret)
    score       INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_id, move_number)
);
CREATE INDEX moves_game_idx ON moves (game_id, move_number);

CREATE TABLE invites (
    token      TEXT PRIMARY KEY,
    game_id    UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'revoked')),
    claimed_by TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ
);
CREATE INDEX invites_game_idx ON invites (game_id);
