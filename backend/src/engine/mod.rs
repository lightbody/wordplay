//! Pure game logic: board, tiles, move validation, scoring, dictionary,
//! and end-game rules. No I/O, no async — everything here is unit-testable
//! with plain values.

pub mod board;
pub mod dictionary;
pub mod endgame;
pub mod moves;
pub mod scoring;
pub mod tiles;

#[cfg(test)]
mod play_tests;
