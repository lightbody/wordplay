//! Word list membership. The ENABLE list (public domain, ~173k words,
//! lowercase) is compiled into the binary.

use std::collections::HashSet;
use std::sync::LazyLock;

static WORDS: LazyLock<HashSet<&'static str>> =
    LazyLock::new(|| include_str!("../../assets/enable.txt").lines().collect());

pub fn is_word(word: &str) -> bool {
    WORDS.contains(word.to_ascii_lowercase().as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_common_words_in_any_case() {
        assert!(is_word("hello"));
        assert!(is_word("HELLO"));
        assert!(is_word("Jo"));
        assert!(is_word("zyzzyvas"));
    }

    #[test]
    fn rejects_non_words() {
        assert!(!is_word("qzx"));
        assert!(!is_word(""));
        assert!(!is_word("hello world"));
    }

    #[test]
    fn list_is_fully_loaded() {
        assert!(WORDS.len() > 170_000, "expected full ENABLE list, got {}", WORDS.len());
    }
}
