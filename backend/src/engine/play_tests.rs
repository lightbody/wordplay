//! Play validation and scoring tests using ASCII-art board fixtures.

use super::board::Board;
use super::moves::{validate_play, PlacedTile, PlayError};

/// Build a board from 15 rows of 15 chars ('.' = empty).
fn board(rows: [&str; 15]) -> Board {
    let s: String = rows.concat();
    Board::from_str(&s).expect("valid fixture board")
}

fn empty() -> Board {
    Board::empty()
}

fn t(row: u8, col: u8, letter: char) -> PlacedTile {
    PlacedTile { row, col, letter, blank: false }
}

fn tb(row: u8, col: u8, letter: char) -> PlacedTile {
    PlacedTile { row, col, letter, blank: true }
}

/// A board with HELLO played across row 7, columns 5-9 (through center).
fn hello_board() -> Board {
    board([
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        ".....HELLO.....",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
    ])
}

// --- first-move rules ---

#[test]
fn first_move_through_center_scores_double_word() {
    let tiles = [t(7, 5, 'H'), t(7, 6, 'E'), t(7, 7, 'L'), t(7, 8, 'L'), t(7, 9, 'O')];
    let out = validate_play(&empty(), "HELLOXY", &tiles).unwrap();
    assert_eq!(out.words.len(), 1);
    assert_eq!(out.words[0].word, "HELLO");
    assert_eq!(out.total, 16); // (4+1+1+1+1) x 2 for the center DW
    assert!(!out.bingo);
    assert_eq!(out.remaining_rack, "XY");
}

#[test]
fn first_move_must_cover_center() {
    let tiles = [t(0, 0, 'H'), t(0, 1, 'I')];
    assert_eq!(
        validate_play(&empty(), "HI", &tiles).unwrap_err(),
        PlayError::FirstMoveMustCoverCenter
    );
}

#[test]
fn first_move_needs_at_least_two_tiles() {
    let tiles = [t(7, 7, 'A')];
    assert_eq!(
        validate_play(&empty(), "A", &tiles).unwrap_err(),
        PlayError::FirstMoveTooShort
    );
}

// --- placement rules ---

#[test]
fn tiles_must_share_a_line() {
    let tiles = [t(7, 7, 'H'), t(8, 8, 'I')];
    assert_eq!(validate_play(&empty(), "HI", &tiles).unwrap_err(), PlayError::NotInLine);
}

#[test]
fn gaps_are_rejected() {
    let tiles = [t(7, 6, 'H'), t(7, 9, 'I')];
    assert_eq!(validate_play(&empty(), "HI", &tiles).unwrap_err(), PlayError::Gap);
}

#[test]
fn existing_tiles_fill_gaps() {
    // T + A around the existing E of HELLO: TEA vertically at column 6.
    let tiles = [t(6, 6, 'T'), t(8, 6, 'A')];
    let out = validate_play(&hello_board(), "TAZ", &tiles).unwrap();
    assert_eq!(out.words.len(), 1);
    assert_eq!(out.words[0].word, "TEA");
    // (6,6) and (8,6) are both DL: (1x2) + 1 + (1x2) = 5
    assert_eq!(out.total, 5);
}

#[test]
fn occupied_squares_are_rejected() {
    let tiles = [t(7, 7, 'A'), t(7, 6, 'B')];
    assert_eq!(
        validate_play(&hello_board(), "AB", &tiles).unwrap_err(),
        PlayError::Occupied { row: 7, col: 7 }
    );
}

#[test]
fn duplicate_positions_are_rejected() {
    let tiles = [t(3, 3, 'A'), t(3, 3, 'B')];
    assert_eq!(
        validate_play(&hello_board(), "AB", &tiles).unwrap_err(),
        PlayError::Duplicate { row: 3, col: 3 }
    );
}

#[test]
fn off_board_is_rejected() {
    let tiles = [t(7, 14, 'A'), t(7, 15, 'B')];
    assert_eq!(validate_play(&hello_board(), "AB", &tiles).unwrap_err(), PlayError::OffBoard);
}

#[test]
fn moves_must_connect_to_existing_tiles() {
    let tiles = [t(0, 0, 'H'), t(0, 1, 'I')];
    assert_eq!(
        validate_play(&hello_board(), "HI", &tiles).unwrap_err(),
        PlayError::NotConnected
    );
}

#[test]
fn player_must_hold_the_tiles() {
    let tiles = [t(7, 10, 'S')];
    assert_eq!(
        validate_play(&hello_board(), "ABC", &tiles).unwrap_err(),
        PlayError::NotInRack('S')
    );
}

// --- word extraction & dictionary ---

#[test]
fn extending_a_word_rescores_it_without_old_premiums() {
    // HELLO -> HELLOS; the center DW under the existing L must not re-apply.
    let tiles = [t(7, 10, 'S')];
    let out = validate_play(&hello_board(), "S", &tiles).unwrap();
    assert_eq!(out.words.len(), 1);
    assert_eq!(out.words[0].word, "HELLOS");
    assert_eq!(out.total, 9); // 4+1+1+1+1+1, no multipliers
}

#[test]
fn invalid_words_are_all_reported() {
    let tiles = [t(7, 7, 'Z'), t(7, 8, 'Q')];
    match validate_play(&empty(), "ZQ", &tiles).unwrap_err() {
        PlayError::InvalidWords(words) => assert_eq!(words, vec!["ZQ".to_string()]),
        other => panic!("expected InvalidWords, got {other:?}"),
    }
}

#[test]
fn parallel_play_scores_main_and_cross_words() {
    // AS under HELLO's H/E: main AS, crosses HA and ES.
    // Board: HELLO at row 7 cols 5-9. Place A(8,5) S(8,6).
    let tiles = [t(8, 5, 'A'), t(8, 6, 'S')];
    let out = validate_play(&hello_board(), "AS", &tiles).unwrap();
    let words: Vec<(&str, i32)> = out.words.iter().map(|w| (w.word.as_str(), w.score)).collect();
    // Main word first, then crosses in placement order.
    // (8,6) is DL, so S doubles in both AS and ES.
    assert_eq!(words, vec![("AS", 3), ("HA", 5), ("ES", 3)]);
    assert_eq!(out.total, 11);
}

#[test]
fn single_tile_can_form_two_words() {
    // HELLO across row 7 cols 4-8, A below the H. Placing S at (8,5)
    // makes AS (main, horizontal) and ES (cross, vertical).
    let b = board([
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "....HELLO......",
        "....A..........",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
    ]);
    let tiles = [t(8, 5, 'S')];
    let out = validate_play(&b, "S", &tiles).unwrap();
    let words: Vec<&str> = out.words.iter().map(|w| w.word.as_str()).collect();
    assert_eq!(words, vec!["AS", "ES"]);
    assert_eq!(out.total, 4);
}

// --- premiums ---

#[test]
fn triple_word_multiplies_the_whole_word() {
    // EAR down column 0, rows 1-3; B at (0,0) makes BEAR from the TW corner.
    let b = board([
        "...............",
        "E..............",
        "A..............",
        "R..............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
    ]);
    let tiles = [t(0, 0, 'B')];
    let out = validate_play(&b, "B", &tiles).unwrap();
    assert_eq!(out.words[0].word, "BEAR");
    assert_eq!(out.total, 18); // (3+1+1+1) x 3
}

#[test]
fn covered_premiums_do_not_reapply() {
    // TEA down column 7 through the center DW; YES through its E must not
    // get the center multiplier.
    let b = board([
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        ".......T.......",
        ".......E.......",
        ".......A.......",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
        "...............",
    ]);
    let tiles = [t(7, 6, 'Y'), t(7, 8, 'S')];
    let out = validate_play(&b, "YS", &tiles).unwrap();
    assert_eq!(out.words[0].word, "YES");
    assert_eq!(out.total, 6); // 4+1+1, center DW already covered
}

#[test]
fn seven_tile_play_earns_the_bingo_bonus() {
    let word = "AIRLINE";
    let tiles: Vec<PlacedTile> = word
        .chars()
        .enumerate()
        .map(|(i, letter)| t(7, 4 + i as u8, letter))
        .collect();
    let out = validate_play(&empty(), "AIRLINE", &tiles).unwrap();
    assert!(out.bingo);
    assert_eq!(out.total, 64); // 7 x 2 (center DW) + 50
    assert_eq!(out.remaining_rack, "");
}

// --- blanks ---

#[test]
fn blank_scores_zero_but_completes_the_word() {
    // JO with a blank as the O.
    let tiles = [t(7, 7, 'J'), tb(7, 8, 'O')];
    let out = validate_play(&empty(), "J?", &tiles).unwrap();
    assert_eq!(out.words[0].word, "JO");
    assert_eq!(out.total, 16); // (8+0) x 2 for the center DW
    assert_eq!(out.remaining_rack, "");
    assert_eq!(out.new_board.get(7, 8), b'o'); // stored lowercase
}

#[test]
fn playing_a_blank_requires_holding_one() {
    let tiles = [t(7, 7, 'J'), tb(7, 8, 'O')];
    assert_eq!(
        validate_play(&empty(), "JO", &tiles).unwrap_err(),
        PlayError::NotInRack('?')
    );
}
