//! wasm-bindgen surface over `wordplay-engine-core`, for instant client-side
//! word validation. The dictionary is never compiled in here -- the caller
//! fetches the word list itself and hands it to `init_dictionary`, so the
//! word list's cache key stays independent of this crate's own code changes.

use std::cell::RefCell;

use serde::Serialize;
use wasm_bindgen::prelude::*;

use wordplay_engine_core::{board::Board, dictionary::Dictionary, moves, moves::PlacedTile};

thread_local! {
    static DICT: RefCell<Option<Dictionary>> = const { RefCell::new(None) };
}

#[wasm_bindgen]
pub fn init_dictionary(bytes: &[u8]) -> Result<(), JsValue> {
    let dict = Dictionary::from_bytes(bytes).map_err(|e| JsValue::from_str(&e.to_string()))?;
    DICT.with(|d| *d.borrow_mut() = Some(dict));
    Ok(())
}

#[wasm_bindgen]
pub fn dictionary_ready() -> bool {
    DICT.with(|d| d.borrow().is_some())
}

#[derive(Serialize)]
struct WordResult {
    text: String,
    cells: Vec<(usize, usize)>,
}

#[derive(Serialize)]
struct CheckResult {
    valid: bool,
    code: Option<&'static str>,
    invalid_words: Vec<String>,
    score: i32,
    bingo: bool,
    words: Vec<WordResult>,
}

impl CheckResult {
    fn err(code: &'static str) -> Self {
        CheckResult { valid: false, code: Some(code), invalid_words: vec![], score: 0, bingo: false, words: vec![] }
    }
}

/// `tiles_json`: a JSON array of `{row, col, letter, blank}`. Never throws --
/// every outcome, including a malformed argument, comes back as a JSON
/// string so the caller never needs try/catch on the happy path.
#[wasm_bindgen]
pub fn check_placement(board: &str, rack: &str, tiles_json: &str) -> String {
    let result = DICT.with(|d| -> CheckResult {
        let dict_ref = d.borrow();
        let Some(dict) = dict_ref.as_ref() else {
            return CheckResult::err("dictionary_not_ready");
        };
        let Some(board) = Board::from_str(board) else {
            return CheckResult::err("bad_board");
        };
        let Ok(tiles) = serde_json::from_str::<Vec<PlacedTile>>(tiles_json) else {
            return CheckResult::err("bad_tiles");
        };
        match moves::validate_play(&board, rack, &tiles, dict) {
            Ok(outcome) => CheckResult {
                valid: true,
                code: None,
                invalid_words: vec![],
                score: outcome.total,
                bingo: outcome.bingo,
                words: outcome
                    .words
                    .iter()
                    .zip(&outcome.word_cells)
                    .map(|(w, cells)| WordResult { text: w.word.clone(), cells: cells.clone() })
                    .collect(),
            },
            Err(moves::PlayError::InvalidWords(words)) => CheckResult {
                valid: false,
                code: Some("invalid_words"),
                invalid_words: words,
                score: 0,
                bingo: false,
                words: vec![],
            },
            Err(e) => CheckResult::err(e.code()),
        }
    });
    serde_json::to_string(&result).expect("CheckResult always serializes")
}
