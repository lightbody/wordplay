//! Pure game logic, shared with the wasm frontend build via the
//! `wordplay-engine-core` crate. `dictionary` and `endgame` stay here:
//! `endgame` isn't shared logic, and `dictionary` needs a backend-specific
//! `include_str!` wrapper (see `dictionary.rs`).

pub use wordplay_engine_core::{board, moves, scoring, tiles};

pub mod dictionary;
pub mod endgame;
