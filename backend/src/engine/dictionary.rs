//! The ENABLE list (public domain, ~173k words, lowercase) is compiled into
//! the backend binary. The wasm build gets the same word list as a
//! separately fetched, separately cached asset instead (see
//! `wasm-engine/src/lib.rs`'s `init_dictionary`) -- so the two builds share
//! the `Dictionary` type but not its data source.

use std::sync::LazyLock;

use wordplay_engine_core::dictionary::Dictionary;

pub static WORDS: LazyLock<Dictionary> = LazyLock::new(|| {
    Dictionary::from_bytes(include_str!("../../engine-core/assets/enable.txt").as_bytes())
        .expect("enable.txt is valid UTF-8")
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_common_words_in_any_case() {
        assert!(WORDS.is_word("hello"));
        assert!(WORDS.is_word("HELLO"));
        assert!(WORDS.is_word("Jo"));
        assert!(WORDS.is_word("zyzzyvas"));
    }

    #[test]
    fn rejects_non_words() {
        assert!(!WORDS.is_word("qzx"));
        assert!(!WORDS.is_word(""));
        assert!(!WORDS.is_word("hello world"));
    }
}
