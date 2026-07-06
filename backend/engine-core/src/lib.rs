//! Pure game logic: board, tiles, move validation, scoring, and dictionary
//! membership. No I/O, no async, no backend-specific concerns -- everything
//! here is unit-testable with plain values and compiles to wasm32.

pub mod board;
pub mod dictionary;
pub mod moves;
pub mod scoring;
pub mod tiles;

#[cfg(test)]
mod play_tests;
