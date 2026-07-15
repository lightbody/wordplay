-- Web Push subscriptions, one row per browser/device a user has enabled
-- notifications on (multi-device: a user can have any number of rows).
-- Keyed by endpoint (not user_id) so re-subscribing the same browser
-- upserts instead of accumulating duplicates.

CREATE TABLE push_subscriptions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
