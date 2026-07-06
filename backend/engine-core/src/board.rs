//! The 15x15 board: premium-square layout and the board string codec.

pub const N: usize = 15;
pub const CELLS: usize = N * N;
pub const CENTER: (usize, usize) = (7, 7);

pub const EMPTY: u8 = b'.';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Premium {
    None,
    DoubleLetter,
    TripleLetter,
    DoubleWord,
    TripleWord,
}

// Standard Scrabble premium layout. T = triple word, D = double word
// (center star included), t = triple letter, d = double letter.
const LAYOUT: [&str; N] = [
    "T..d...T...d..T",
    ".D...t...t...D.",
    "..D...d.d...D..",
    "d..D...d...D..d",
    "....D.....D....",
    ".t...t...t...t.",
    "..d...d.d...d..",
    "T..d...D...d..T",
    "..d...d.d...d..",
    ".t...t...t...t.",
    "....D.....D....",
    "d..D...d...D..d",
    "..D...d.d...D..",
    ".D...t...t...D.",
    "T..d...T...d..T",
];

pub fn premium(row: usize, col: usize) -> Premium {
    match LAYOUT[row].as_bytes()[col] {
        b'd' => Premium::DoubleLetter,
        b't' => Premium::TripleLetter,
        b'D' => Premium::DoubleWord,
        b'T' => Premium::TripleWord,
        _ => Premium::None,
    }
}

/// Board cells, row-major. `.` = empty, `A`-`Z` = normal tile, `a`-`z` =
/// blank played as that letter (worth 0 points).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Board(pub [u8; CELLS]);

impl Board {
    #[cfg(test)]
    pub fn empty() -> Self {
        Board([EMPTY; CELLS])
    }

    pub fn from_str(s: &str) -> Option<Self> {
        let bytes = s.as_bytes();
        if bytes.len() != CELLS {
            return None;
        }
        let mut cells = [EMPTY; CELLS];
        for (i, &b) in bytes.iter().enumerate() {
            if b != EMPTY && !b.is_ascii_alphabetic() {
                return None;
            }
            cells[i] = b;
        }
        Some(Board(cells))
    }

    pub fn to_string(&self) -> String {
        String::from_utf8(self.0.to_vec()).expect("board cells are ASCII")
    }

    pub fn get(&self, row: usize, col: usize) -> u8 {
        self.0[row * N + col]
    }

    pub fn set(&mut self, row: usize, col: usize, cell: u8) {
        self.0[row * N + col] = cell;
    }

    pub fn is_empty_cell(&self, row: usize, col: usize) -> bool {
        self.get(row, col) == EMPTY
    }

    pub fn is_blank(&self) -> bool {
        self.0.iter().all(|&c| c == EMPTY)
    }

    /// The letter a cell reads as, regardless of whether it's a blank.
    #[cfg(test)]
    pub fn letter(&self, row: usize, col: usize) -> Option<char> {
        match self.get(row, col) {
            EMPTY => None,
            c => Some(c.to_ascii_uppercase() as char),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_rows_are_15_wide() {
        for row in LAYOUT {
            assert_eq!(row.len(), N);
        }
    }

    #[test]
    fn layout_is_four_fold_symmetric() {
        for r in 0..N {
            for c in 0..N {
                let p = premium(r, c);
                assert_eq!(p, premium(N - 1 - r, c), "vertical mirror at {r},{c}");
                assert_eq!(p, premium(r, N - 1 - c), "horizontal mirror at {r},{c}");
                assert_eq!(p, premium(c, r), "diagonal mirror at {r},{c}");
            }
        }
    }

    #[test]
    fn premium_counts_match_standard_board() {
        let mut tw = 0;
        let mut dw = 0;
        let mut tl = 0;
        let mut dl = 0;
        for r in 0..N {
            for c in 0..N {
                match premium(r, c) {
                    Premium::TripleWord => tw += 1,
                    Premium::DoubleWord => dw += 1,
                    Premium::TripleLetter => tl += 1,
                    Premium::DoubleLetter => dl += 1,
                    Premium::None => {}
                }
            }
        }
        assert_eq!((tw, dw, tl, dl), (8, 17, 12, 24)); // DW includes center
    }

    #[test]
    fn center_is_double_word() {
        assert_eq!(premium(CENTER.0, CENTER.1), Premium::DoubleWord);
    }

    #[test]
    fn board_codec_round_trips() {
        let mut b = Board::empty();
        b.set(7, 7, b'Q');
        b.set(7, 8, b'i'); // blank played as I
        let s = b.to_string();
        assert_eq!(s.len(), CELLS);
        let b2 = Board::from_str(&s).unwrap();
        assert_eq!(b, b2);
        assert_eq!(b2.letter(7, 8), Some('I'));
    }

    #[test]
    fn board_from_str_rejects_bad_input() {
        assert!(Board::from_str("short").is_none());
        let bad = "!".repeat(CELLS);
        assert!(Board::from_str(&bad).is_none());
    }
}
