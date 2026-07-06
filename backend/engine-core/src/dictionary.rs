//! Word list membership. No data is compiled in here -- callers supply the
//! word-list bytes explicitly (a `include_str!`'d file, a `fetch()`'d
//! buffer, etc.), so this stays a plain, portable data structure regardless
//! of where the words come from or how that source is cached.

use std::collections::HashSet;

pub struct Dictionary(HashSet<Box<str>>);

impl Dictionary {
    /// Builds the dictionary from a UTF-8 word list, one lowercase word per
    /// line (the ENABLE list format).
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, std::str::Utf8Error> {
        let text = std::str::from_utf8(bytes)?;
        Ok(Dictionary(text.lines().map(Box::from).collect()))
    }

    pub fn is_word(&self, word: &str) -> bool {
        self.0.contains(word.to_ascii_lowercase().as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dict() -> Dictionary {
        Dictionary::from_bytes(include_str!("../assets/enable.txt").as_bytes()).unwrap()
    }

    #[test]
    fn knows_common_words_in_any_case() {
        let dict = test_dict();
        assert!(dict.is_word("hello"));
        assert!(dict.is_word("HELLO"));
        assert!(dict.is_word("Jo"));
        assert!(dict.is_word("zyzzyvas"));
    }

    #[test]
    fn rejects_non_words() {
        let dict = test_dict();
        assert!(!dict.is_word("qzx"));
        assert!(!dict.is_word(""));
        assert!(!dict.is_word("hello world"));
    }

    #[test]
    fn list_is_fully_loaded() {
        assert!(test_dict().0.len() > 170_000, "expected full ENABLE list, got {}", test_dict().0.len());
    }
}
