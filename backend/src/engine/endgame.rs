//! End-of-game rules.
//!
//! House rule (per product spec): when the bag empties, each player gets
//! exactly one final move, then the game ends. Additionally the standard
//! six-consecutive-scoreless-turns rule prevents endless pass loops, and a
//! player whose rack is empty with an empty bag can't move, so the game
//! ends immediately rather than waiting on them.

use super::tiles::rack_value;

pub const SCORELESS_LIMIT: i32 = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndReason {
    PlayedOut,
    BagFinalMoves,
    ScorelessLimit,
}

impl EndReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            EndReason::PlayedOut => "played_out",
            EndReason::BagFinalMoves => "bag_final_moves",
            EndReason::ScorelessLimit => "scoreless_limit",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct TurnOutcome {
    pub final_moves_remaining: Option<i32>,
    pub scoreless_streak: i32,
    pub finished: Option<EndReason>,
}

/// Evaluate game-continuation state after a (non-resign) move has been
/// applied and replacement tiles drawn.
///
/// * `bag_empty` — bag state after the mover drew replacements
/// * `prev_final_moves` — `final_moves_remaining` before this move
/// * `prev_scoreless` — `scoreless_streak` before this move
/// * `move_scored` — the move was a play that scored more than 0
/// * `next_rack_empty` — the player whose turn is next has no tiles
pub fn evaluate(
    bag_empty: bool,
    prev_final_moves: Option<i32>,
    prev_scoreless: i32,
    move_scored: bool,
    next_rack_empty: bool,
) -> TurnOutcome {
    let scoreless_streak = if move_scored { 0 } else { prev_scoreless + 1 };

    // A move made while the countdown is running consumes one final move.
    // The move that empties the bag starts the countdown but is not itself
    // a final move.
    let final_moves_remaining = match prev_final_moves {
        Some(n) => Some(n - 1),
        None if bag_empty => Some(2),
        None => None,
    };

    let finished = if final_moves_remaining == Some(0) {
        Some(EndReason::BagFinalMoves)
    } else if bag_empty && next_rack_empty {
        Some(EndReason::PlayedOut)
    } else if scoreless_streak >= SCORELESS_LIMIT {
        Some(EndReason::ScorelessLimit)
    } else {
        None
    };

    TurnOutcome {
        final_moves_remaining,
        scoreless_streak,
        finished,
    }
}

/// End-game score adjustment for one player: minus the value of their
/// unused tiles when the option is on, otherwise 0.
pub fn adjustment(deduct_unused: bool, rack: &str) -> i32 {
    if deduct_unused {
        -rack_value(rack)
    } else {
        0
    }
}

/// Winner given final (adjusted) totals. `None` = draw.
pub fn winner<'a>(
    creator_id: &'a str,
    opponent_id: &'a str,
    creator_total: i32,
    opponent_total: i32,
) -> Option<&'a str> {
    match creator_total.cmp(&opponent_total) {
        std::cmp::Ordering::Greater => Some(creator_id),
        std::cmp::Ordering::Less => Some(opponent_id),
        std::cmp::Ordering::Equal => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bag_emptying_starts_two_move_countdown() {
        let out = evaluate(true, None, 0, true, false);
        assert_eq!(out.final_moves_remaining, Some(2));
        assert_eq!(out.finished, None);
    }

    #[test]
    fn countdown_runs_two_then_one_then_ends() {
        let out = evaluate(true, Some(2), 0, true, false);
        assert_eq!(out.final_moves_remaining, Some(1));
        assert_eq!(out.finished, None);

        let out = evaluate(true, Some(1), 0, true, false);
        assert_eq!(out.final_moves_remaining, Some(0));
        assert_eq!(out.finished, Some(EndReason::BagFinalMoves));
    }

    #[test]
    fn next_player_with_empty_rack_ends_immediately() {
        let out = evaluate(true, Some(2), 0, true, true);
        assert_eq!(out.finished, Some(EndReason::PlayedOut));
    }

    #[test]
    fn six_scoreless_turns_end_the_game() {
        let out = evaluate(false, None, 5, false, false);
        assert_eq!(out.scoreless_streak, 6);
        assert_eq!(out.finished, Some(EndReason::ScorelessLimit));
    }

    #[test]
    fn scoring_play_resets_the_streak() {
        let out = evaluate(false, None, 5, true, false);
        assert_eq!(out.scoreless_streak, 0);
        assert_eq!(out.finished, None);
    }

    #[test]
    fn no_countdown_while_bag_has_tiles() {
        let out = evaluate(false, None, 0, true, false);
        assert_eq!(out.final_moves_remaining, None);
        assert_eq!(out.finished, None);
    }

    #[test]
    fn adjustment_respects_option() {
        assert_eq!(adjustment(true, "QZ"), -20);
        assert_eq!(adjustment(false, "QZ"), 0);
        assert_eq!(adjustment(true, ""), 0);
    }

    #[test]
    fn winner_by_adjusted_total_or_draw() {
        assert_eq!(winner("a", "b", 100, 90), Some("a"));
        assert_eq!(winner("a", "b", 90, 100), Some("b"));
        assert_eq!(winner("a", "b", 100, 100), None);
    }
}
