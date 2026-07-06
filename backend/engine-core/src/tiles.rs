//! Tile distribution, letter values, and bag operations.
//!
//! The bag is a `String` of tiles in draw order (`A`-`Z` plus `?` for
//! blanks); drawing pops from the front. Racks use the same alphabet.

use rand::seq::SliceRandom;
use rand::Rng;

pub const RACK_SIZE: usize = 7;
#[cfg(test)]
pub const BAG_SIZE: usize = 100;

/// Standard English distribution: (tile, count).
pub const DISTRIBUTION: [(char, u8); 27] = [
    ('A', 9),
    ('B', 2),
    ('C', 2),
    ('D', 4),
    ('E', 12),
    ('F', 2),
    ('G', 3),
    ('H', 2),
    ('I', 9),
    ('J', 1),
    ('K', 1),
    ('L', 4),
    ('M', 2),
    ('N', 6),
    ('O', 8),
    ('P', 2),
    ('Q', 1),
    ('R', 6),
    ('S', 4),
    ('T', 6),
    ('U', 4),
    ('V', 2),
    ('W', 2),
    ('X', 1),
    ('Y', 2),
    ('Z', 1),
    ('?', 2),
];

/// Point value of a tile. Blanks are 0.
pub fn letter_value(tile: char) -> i32 {
    match tile.to_ascii_uppercase() {
        'A' | 'E' | 'I' | 'O' | 'U' | 'L' | 'N' | 'S' | 'T' | 'R' => 1,
        'D' | 'G' => 2,
        'B' | 'C' | 'M' | 'P' => 3,
        'F' | 'H' | 'V' | 'W' | 'Y' => 4,
        'K' => 5,
        'J' | 'X' => 8,
        'Q' | 'Z' => 10,
        _ => 0, // '?'
    }
}

/// Total value of the tiles on a rack (for end-game deductions).
pub fn rack_value(rack: &str) -> i32 {
    rack.chars().map(letter_value).sum()
}

pub fn shuffled_bag(rng: &mut impl Rng) -> String {
    let mut tiles: Vec<char> = DISTRIBUTION
        .iter()
        .flat_map(|&(tile, count)| std::iter::repeat(tile).take(count as usize))
        .collect();
    tiles.shuffle(rng);
    tiles.into_iter().collect()
}

/// Draw from the front of the bag until the rack holds `RACK_SIZE` tiles or
/// the bag is empty.
pub fn draw(bag: &mut String, rack: &mut String) {
    while rack.chars().count() < RACK_SIZE && !bag.is_empty() {
        let tile = bag.remove(0);
        rack.push(tile);
    }
}

/// Remove `letters` from `rack` (error if any aren't held). Returns the
/// removed letters.
pub fn take_from_rack(rack: &mut String, letters: &str) -> Result<String, char> {
    let mut taken = String::new();
    for l in letters.chars() {
        let l = if l == '?' { l } else { l.to_ascii_uppercase() };
        match rack.find(l) {
            Some(i) => {
                rack.remove(i);
                taken.push(l);
            }
            None => return Err(l),
        }
    }
    Ok(taken)
}

/// Swap: remove `letters` from the rack, draw replacements, then return the
/// removed letters to the bag at random positions.
pub fn swap_tiles(
    bag: &mut String,
    rack: &mut String,
    letters: &str,
    rng: &mut impl Rng,
) -> Result<(), char> {
    let returned = take_from_rack(rack, letters)?;
    draw(bag, rack);
    for tile in returned.chars() {
        let pos = rng.gen_range(0..=bag.len());
        bag.insert(pos, tile);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::collections::HashMap;

    fn multiset(s: &str) -> HashMap<char, usize> {
        let mut m = HashMap::new();
        for c in s.chars() {
            *m.entry(c).or_insert(0) += 1;
        }
        m
    }

    #[test]
    fn bag_has_100_tiles_with_standard_distribution() {
        let mut rng = StdRng::seed_from_u64(1);
        let bag = shuffled_bag(&mut rng);
        assert_eq!(bag.chars().count(), BAG_SIZE);
        let counts = multiset(&bag);
        assert_eq!(counts[&'E'], 12);
        assert_eq!(counts[&'A'], 9);
        assert_eq!(counts[&'Q'], 1);
        assert_eq!(counts[&'?'], 2);
        let total_value: i32 = bag.chars().map(letter_value).sum();
        assert_eq!(total_value, 187); // standard Scrabble tile-set value
    }

    #[test]
    fn shuffle_is_deterministic_with_seed() {
        let a = shuffled_bag(&mut StdRng::seed_from_u64(42));
        let b = shuffled_bag(&mut StdRng::seed_from_u64(42));
        assert_eq!(a, b);
        let c = shuffled_bag(&mut StdRng::seed_from_u64(43));
        assert_ne!(a, c);
    }

    #[test]
    fn draw_replenishes_to_seven() {
        let mut bag = "ABCDEFGHIJ".to_string();
        let mut rack = "XY".to_string();
        draw(&mut bag, &mut rack);
        assert_eq!(rack, "XYABCDE");
        assert_eq!(bag, "FGHIJ");
    }

    #[test]
    fn draw_stops_at_empty_bag() {
        let mut bag = "AB".to_string();
        let mut rack = String::new();
        draw(&mut bag, &mut rack);
        assert_eq!(rack, "AB");
        assert!(bag.is_empty());
    }

    #[test]
    fn take_from_rack_errors_on_missing_letter() {
        let mut rack = "ABC".to_string();
        assert_eq!(take_from_rack(&mut rack, "AZ"), Err('Z'));
    }

    #[test]
    fn swap_conserves_the_tile_multiset() {
        let mut rng = StdRng::seed_from_u64(7);
        let mut bag = shuffled_bag(&mut rng);
        let mut rack = String::new();
        draw(&mut bag, &mut rack);
        let before = multiset(&format!("{bag}{rack}"));

        let to_swap: String = rack.chars().take(3).collect();
        swap_tiles(&mut bag, &mut rack, &to_swap, &mut rng).unwrap();

        assert_eq!(rack.chars().count(), RACK_SIZE);
        assert_eq!(bag.chars().count(), BAG_SIZE - RACK_SIZE);
        let after = multiset(&format!("{bag}{rack}"));
        assert_eq!(before, after);
    }

    #[test]
    fn rack_value_sums_letter_values() {
        assert_eq!(rack_value("QZ?E"), 21);
        assert_eq!(rack_value(""), 0);
    }
}
