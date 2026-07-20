-- Nudge timestamps live on games (per seat) so they ride the existing games
-- shape to both players and the game list can compute nudge eligibility
-- locally. creator_last_nudge_at = the last time the CREATOR sent a nudge
-- (i.e. nudged the opponent), and vice versa.
ALTER TABLE games
    ADD COLUMN creator_last_nudge_at  TIMESTAMPTZ,
    ADD COLUMN opponent_last_nudge_at TIMESTAMPTZ;

-- Push-usage signals: whether a user is likely actually receiving pushes.
ALTER TABLE users
    ADD COLUMN push_enabled_at TIMESTAMPTZ,   -- last successful POST /me/push-subscriptions
    ADD COLUMN push_opened_at  TIMESTAMPTZ;   -- last app open via a notification tap

-- Backfill: users who enabled push before this migration would otherwise look
-- "stale" (subscriptions but no signal). Seed from their newest subscription.
UPDATE users u
   SET push_enabled_at = s.latest
  FROM (SELECT user_id, max(created_at) AS latest FROM push_subscriptions GROUP BY user_id) s
 WHERE s.user_id = u.id;
