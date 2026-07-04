//! Play validation and word extraction.

use serde::{Deserialize, Serialize};

use super::board::{Board, EMPTY, N};
use super::dictionary;
use super::scoring::{self, WordScore};
use super::tiles::RACK_SIZE;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PlacedTile {
    pub row: u8,
    pub col: u8,
    /// The letter the tile reads as, `A`-`Z`. For a blank this is the
    /// letter the player assigned to it.
    pub letter: char,
    #[serde(default)]
    pub blank: bool,
}

/// One cell of an extracted word: (row, col, board cell, newly placed).
pub type WordCell = (usize, usize, u8, bool);

#[derive(Debug, PartialEq, Eq)]
pub enum PlayError {
    NoTiles,
    TooManyTiles,
    OffBoard,
    Occupied { row: u8, col: u8 },
    Duplicate { row: u8, col: u8 },
    NotInRack(char),
    NotInLine,
    Gap,
    FirstMoveMustCoverCenter,
    FirstMoveTooShort,
    NotConnected,
    NoWordFormed,
    InvalidWords(Vec<String>),
}

impl PlayError {
    pub fn code(&self) -> &'static str {
        match self {
            PlayError::NoTiles => "no_tiles",
            PlayError::TooManyTiles => "too_many_tiles",
            PlayError::OffBoard => "off_board",
            PlayError::Occupied { .. } => "occupied",
            PlayError::Duplicate { .. } => "duplicate_position",
            PlayError::NotInRack(_) => "not_in_rack",
            PlayError::NotInLine => "not_in_line",
            PlayError::Gap => "gap",
            PlayError::FirstMoveMustCoverCenter => "first_move_must_cover_center",
            PlayError::FirstMoveTooShort => "first_move_too_short",
            PlayError::NotConnected => "not_connected",
            PlayError::NoWordFormed => "no_word_formed",
            PlayError::InvalidWords(_) => "invalid_words",
        }
    }
}

#[derive(Debug)]
pub struct PlayOutcome {
    pub new_board: Board,
    /// Rack after removing the played tiles (before drawing replacements).
    pub remaining_rack: String,
    /// Main word first, then cross words.
    pub words: Vec<WordScore>,
    pub total: i32,
    /// True when all 7 rack tiles were placed (earns the 50-pt bonus).
    #[cfg_attr(not(test), allow(dead_code))]
    pub bingo: bool,
}

pub fn validate_play(board: &Board, rack: &str, tiles: &[PlacedTile]) -> Result<PlayOutcome, PlayError> {
    if tiles.is_empty() {
        return Err(PlayError::NoTiles);
    }
    if tiles.len() > RACK_SIZE {
        return Err(PlayError::TooManyTiles);
    }

    // Positions: on-board, unique, empty; letters valid.
    for t in tiles {
        if t.row as usize >= N || t.col as usize >= N || !t.letter.is_ascii_alphabetic() {
            return Err(PlayError::OffBoard);
        }
        if !board.is_empty_cell(t.row as usize, t.col as usize) {
            return Err(PlayError::Occupied { row: t.row, col: t.col });
        }
    }
    for (i, a) in tiles.iter().enumerate() {
        for b in &tiles[i + 1..] {
            if a.row == b.row && a.col == b.col {
                return Err(PlayError::Duplicate { row: a.row, col: a.col });
            }
        }
    }

    // The player must hold every tile they place (blanks consume '?').
    let mut remaining_rack = rack.to_string();
    for t in tiles {
        let needed = if t.blank { '?' } else { t.letter.to_ascii_uppercase() };
        match remaining_rack.find(needed) {
            Some(i) => {
                remaining_rack.remove(i);
            }
            None => return Err(PlayError::NotInRack(needed)),
        }
    }

    // All tiles in one row or one column.
    let same_row = tiles.iter().all(|t| t.row == tiles[0].row);
    let same_col = tiles.iter().all(|t| t.col == tiles[0].col);
    if !same_row && !same_col {
        return Err(PlayError::NotInLine);
    }

    // Place onto a copy: uppercase for a normal tile, lowercase for a blank.
    let mut new_board = board.clone();
    for t in tiles {
        let cell = if t.blank {
            t.letter.to_ascii_lowercase() as u8
        } else {
            t.letter.to_ascii_uppercase() as u8
        };
        new_board.set(t.row as usize, t.col as usize, cell);
    }

    // Orientation: for a single tile, pick whichever axis forms a run.
    let horizontal = if tiles.len() > 1 {
        same_row
    } else {
        let (r, c) = (tiles[0].row as usize, tiles[0].col as usize);
        let has_h = (c > 0 && !new_board.is_empty_cell(r, c - 1))
            || (c + 1 < N && !new_board.is_empty_cell(r, c + 1));
        has_h
    };

    // Contiguity: no holes across the placed span (existing tiles fill gaps).
    if horizontal && same_row {
        let row = tiles[0].row as usize;
        let min = tiles.iter().map(|t| t.col as usize).min().unwrap();
        let max = tiles.iter().map(|t| t.col as usize).max().unwrap();
        if (min..=max).any(|c| new_board.is_empty_cell(row, c)) {
            return Err(PlayError::Gap);
        }
    } else if same_col {
        let col = tiles[0].col as usize;
        let min = tiles.iter().map(|t| t.row as usize).min().unwrap();
        let max = tiles.iter().map(|t| t.row as usize).max().unwrap();
        if (min..=max).any(|r| new_board.is_empty_cell(r, col)) {
            return Err(PlayError::Gap);
        }
    }

    let first_move = board.is_blank();
    if first_move {
        if tiles.len() < 2 {
            return Err(PlayError::FirstMoveTooShort);
        }
        if !tiles.iter().any(|t| (t.row as usize, t.col as usize) == super::board::CENTER) {
            return Err(PlayError::FirstMoveMustCoverCenter);
        }
    } else {
        // Must touch the existing structure: some placed tile orthogonally
        // adjacent to a pre-existing tile (gap-fills are adjacent by
        // construction).
        let touches = tiles.iter().any(|t| {
            let (r, c) = (t.row as usize, t.col as usize);
            let mut neighbors = Vec::new();
            if r > 0 {
                neighbors.push((r - 1, c));
            }
            if r + 1 < N {
                neighbors.push((r + 1, c));
            }
            if c > 0 {
                neighbors.push((r, c - 1));
            }
            if c + 1 < N {
                neighbors.push((r, c + 1));
            }
            neighbors.iter().any(|&(nr, nc)| !board.is_empty_cell(nr, nc))
        });
        if !touches {
            return Err(PlayError::NotConnected);
        }
    }

    // Extract the main word plus a perpendicular cross word per placed tile.
    let placed: Vec<(usize, usize)> = tiles.iter().map(|t| (t.row as usize, t.col as usize)).collect();
    let is_new = |r: usize, c: usize| placed.contains(&(r, c));

    let mut word_cells: Vec<Vec<WordCell>> = Vec::new();
    let main = extract_run(&new_board, placed[0].0, placed[0].1, horizontal, &is_new);
    if main.len() >= 2 {
        word_cells.push(main);
    }
    for &(r, c) in &placed {
        let cross = extract_run(&new_board, r, c, !horizontal, &is_new);
        if cross.len() >= 2 {
            word_cells.push(cross);
        }
    }
    if word_cells.is_empty() {
        return Err(PlayError::NoWordFormed);
    }

    let texts: Vec<String> = word_cells.iter().map(|cells| word_text(cells)).collect();
    let invalid: Vec<String> = texts
        .iter()
        .filter(|w| !dictionary::is_word(w))
        .cloned()
        .collect();
    if !invalid.is_empty() {
        return Err(PlayError::InvalidWords(invalid));
    }

    let bingo = tiles.len() == RACK_SIZE;
    let words: Vec<WordScore> = word_cells
        .iter()
        .zip(&texts)
        .map(|(cells, text)| WordScore {
            word: text.clone(),
            score: scoring::score_word(cells),
        })
        .collect();
    let total: i32 = words.iter().map(|w| w.score).sum::<i32>() + if bingo { scoring::BINGO_BONUS } else { 0 };

    Ok(PlayOutcome {
        new_board,
        remaining_rack,
        words,
        total,
        bingo,
    })
}

/// The maximal run of tiles through (row, col) along one axis.
fn extract_run(
    board: &Board,
    row: usize,
    col: usize,
    horizontal: bool,
    is_new: &dyn Fn(usize, usize) -> bool,
) -> Vec<WordCell> {
    let (mut r, mut c) = (row, col);
    // Walk back to the start of the run.
    loop {
        let (pr, pc) = if horizontal {
            if c == 0 {
                break;
            }
            (r, c - 1)
        } else {
            if r == 0 {
                break;
            }
            (r - 1, c)
        };
        if board.is_empty_cell(pr, pc) {
            break;
        }
        r = pr;
        c = pc;
    }
    // Walk forward collecting cells.
    let mut cells = Vec::new();
    loop {
        let cell = board.get(r, c);
        if cell == EMPTY {
            break;
        }
        cells.push((r, c, cell, is_new(r, c)));
        if horizontal {
            c += 1;
            if c >= N {
                break;
            }
        } else {
            r += 1;
            if r >= N {
                break;
            }
        }
    }
    cells
}

pub fn word_text(cells: &[WordCell]) -> String {
    cells
        .iter()
        .map(|&(_, _, cell, _)| cell.to_ascii_uppercase() as char)
        .collect()
}
