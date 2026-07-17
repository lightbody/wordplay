-- Post-move play rating vs. the best move possible with the pre-move rack.
-- Nullable: pre-feature rows and non-play moves have no rating.
ALTER TABLE moves
    ADD COLUMN rating     TEXT CHECK (rating IN ('wow', 'great', 'good', 'meh')),
    ADD COLUMN best_score INT;
