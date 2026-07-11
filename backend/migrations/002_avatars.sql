-- Customizable avatars: one emoji + one background color id (see
-- shared/src/avatar.ts for the allowed sets; validated at the app layer).

ALTER TABLE users
    ADD COLUMN avatar_emoji TEXT NOT NULL DEFAULT '🦊',
    ADD COLUMN avatar_color TEXT NOT NULL DEFAULT 'coral-vivid';

-- Existing users (onboarded before this migration) get one deliberate
-- default rather than a per-row random pick — population is tiny.
UPDATE users SET avatar_emoji = '🎲', avatar_color = 'sky-vivid';

-- Denormalized onto games, same pattern as creator_username /
-- opponent_username (see 001's comment: "games shape is self-contained").
-- opponent_* stay nullable like opponent_username until a game is joined.
ALTER TABLE games
    ADD COLUMN creator_avatar_emoji TEXT NOT NULL DEFAULT '🦊',
    ADD COLUMN creator_avatar_color TEXT NOT NULL DEFAULT 'coral-vivid',
    ADD COLUMN opponent_avatar_emoji TEXT,
    ADD COLUMN opponent_avatar_color TEXT;

UPDATE games g SET creator_avatar_emoji = u.avatar_emoji, creator_avatar_color = u.avatar_color
FROM users u WHERE u.id = g.creator_id;

UPDATE games g SET opponent_avatar_emoji = u.avatar_emoji, opponent_avatar_color = u.avatar_color
FROM users u WHERE u.id = g.opponent_id AND g.opponent_id IS NOT NULL;
