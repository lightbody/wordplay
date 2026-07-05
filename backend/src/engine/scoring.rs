//! Word scoring. Premiums count only under newly placed tiles; letter
//! premiums apply to the letter, word premiums multiply the whole word and
//! stack with each other. A blank (lowercase board cell) is worth 0.

use serde::{Deserialize, Serialize};

use super::board::{premium, Premium};
use super::moves::WordCell;
use super::tiles::letter_value;

pub const BINGO_BONUS: i32 = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WordScore {
    pub word: String,
    pub score: i32,
}

fn tile_points(cell: u8) -> i32 {
    if cell.is_ascii_lowercase() {
        0 // blank
    } else {
        letter_value(cell as char)
    }
}

pub fn score_word(cells: &[WordCell]) -> i32 {
    let mut sum = 0;
    let mut multiplier = 1;
    for &(row, col, cell, newly_placed) in cells {
        let mut value = tile_points(cell);
        if newly_placed {
            match premium(row, col) {
                Premium::DoubleLetter => value *= 2,
                Premium::TripleLetter => value *= 3,
                Premium::DoubleWord => multiplier *= 2,
                Premium::TripleWord => multiplier *= 3,
                Premium::None => {}
            }
        }
        sum += value;
    }
    sum * multiplier
}
