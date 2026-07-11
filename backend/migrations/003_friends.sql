-- Friends: durable, bidirectional player relationships.
--
-- Sync classes (see 001's header; enforced by the backend's /shape registry):
--   * friendships  — shape-filtered to user_id (each user syncs their own
--                    mirrored rows)
--   * friend_links — server-only (the reusable "add me" token); NO shape view
--                    maps to this table, so tokens can never reach a client.
--
-- A friendship is stored as TWO mirrored rows (a→b and b→a), written and
-- deleted together in one transaction. That keeps the shape filter a trivial
-- `user_id = me` and gives each viewer their own denormalized copy of the
-- friend's username/avatar.

CREATE TABLE friendships (
    user_id             TEXT NOT NULL REFERENCES users(id),
    friend_id           TEXT NOT NULL REFERENCES users(id),
    -- Denormalized so the friends shape is self-contained. Usernames are
    -- immutable; avatars are propagated on change (see PATCH /me), same
    -- pattern as the games columns from 002.
    friend_username     TEXT NOT NULL,
    friend_avatar_emoji TEXT NOT NULL,
    friend_avatar_color TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, friend_id),
    CHECK (user_id <> friend_id)
);
CREATE INDEX friendships_friend_idx ON friendships (friend_id);

-- One reusable personal friend link per user; regenerating replaces the row.
CREATE TABLE friend_links (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL UNIQUE REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A game created against a chosen friend records that intent here; the
-- opponent_* columns stay NULL (keeping the game out of the friend's games
-- shape) until the creator's opening move attaches them for real. Also
-- denormalized username/avatar so the creator's game screen can show the
-- opponent-to-be during the opening move.
ALTER TABLE games
    ADD COLUMN pending_opponent_id TEXT REFERENCES users(id),
    ADD COLUMN pending_opponent_username TEXT,
    ADD COLUMN pending_opponent_avatar_emoji TEXT,
    ADD COLUMN pending_opponent_avatar_color TEXT;

-- Backfill: everyone who has ever shared a game becomes friends (both
-- directions), retroactively applying the new "playing a game together
-- forces a friendship" rule — and making Rematch work on historical games.
INSERT INTO friendships (user_id, friend_id, friend_username, friend_avatar_emoji, friend_avatar_color)
  SELECT DISTINCT g.creator_id, g.opponent_id, u.username, u.avatar_emoji, u.avatar_color
  FROM games g JOIN users u ON u.id = g.opponent_id
  WHERE g.opponent_id IS NOT NULL
  ON CONFLICT DO NOTHING;
INSERT INTO friendships (user_id, friend_id, friend_username, friend_avatar_emoji, friend_avatar_color)
  SELECT DISTINCT g.opponent_id, g.creator_id, u.username, u.avatar_emoji, u.avatar_color
  FROM games g JOIN users u ON u.id = g.creator_id
  WHERE g.opponent_id IS NOT NULL
  ON CONFLICT DO NOTHING;
