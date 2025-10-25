use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;
use napi_derive::napi;
use strsim::damerau_levenshtein;
use unicode_normalization::UnicodeNormalization;

/// Normalize string: lowercase + remove diacritics
fn normalize(s: &str) -> String {
    use unicode_normalization::char::is_combining_mark;
    s.nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase()
}

/// Calculate hybrid score: Universal ranking system (never rejects)
///
/// Strategy:
/// 1. ALWAYS calculate both skim and levenshtein scores
/// 2. Apply length penalty to favor candidates with similar length to query
/// 3. Final score = ((skim_score × 10) + levenshtein_score) × length_penalty_factor
///    → This is a RANKER, not a FILTER. Every candidate gets a score.
fn calculate_hybrid_score(
    skim: &SkimMatcherV2,
    query: &str,
    candidate: &str,
) -> i64 {
    // 1. Skim score (subsequence matching) - ALWAYS calculated
    let skim_score = skim
        .fuzzy_match(candidate, query)
        .unwrap_or(0);

    // 2. Levenshtein score (typo tolerance) - ALWAYS calculated
    let lev_score = if query.len() >= 2 {
        let distance = damerau_levenshtein(query, candidate);
        let max_len = query.len().max(candidate.len());
        let similarity_ratio = 1.0 - (distance as f64 / max_len as f64);
        (similarity_ratio.max(0.0) * 100.0) as i64
    } else {
        0
    };

    // 3. Length penalty factor
    let length_diff = (query.len() as i64 - candidate.len() as i64).abs();
    let max_len = query.len().max(candidate.len()) as f64;
    let length_penalty_factor = 1.0 - (length_diff as f64 / max_len);

    // 4. Combined score
    let base_score = (skim_score * 10) + lev_score;
    let final_score = (base_score as f64 * length_penalty_factor).max(1.0);

    final_score as i64
}

#[napi(object)]
pub struct FuzzyMatch {
    pub line_index: u32,
    pub line_content: String,
    pub score: i32,
    pub match_start: u32,
    pub match_end: u32,
    pub match_indices: Vec<u32>,  // Individual character positions that matched
}

/// Fuzzy search in lines of text
/// Returns matches sorted by score (best first)
#[napi]
pub fn fuzzy_search(lines: Vec<String>, pattern: String, limit: Option<u32>) -> Vec<FuzzyMatch> {
    if pattern.is_empty() {
        return vec![];
    }

    let limit = limit.unwrap_or(100) as usize;
    let norm_query = normalize(&pattern);
    let skim = SkimMatcherV2::default();

    // Calculate scores for ALL lines (universal ranking - never reject)
    // Use .map() not .filter_map() - every line gets a score
    let mut results: Vec<(usize, i64, Option<(i64, Vec<usize>)>)> = lines
        .iter()
        .enumerate()
        .map(|(idx, line)| {
            let norm_line = normalize(line);

            // Always calculate score
            let score = calculate_hybrid_score(&skim, &norm_query, &norm_line);

            // Try to get match positions from skim
            let match_positions = skim.fuzzy_indices(&norm_line, &norm_query);

            (idx, score, match_positions)
        })
        .collect();

    // Sort by score (descending) - best matches first
    results.sort_by(|a, b| b.1.cmp(&a.1));

    // Take top matches and convert to FuzzyMatch
    results
        .into_iter()
        .take(limit)
        .map(|(idx, score, positions)| {
            let (start, end, indices) = if let Some((_score, match_indices)) = positions {
                if !match_indices.is_empty() {
                    let first = *match_indices.first().unwrap();
                    let last = *match_indices.last().unwrap() + 1;
                    let indices_u32: Vec<u32> = match_indices.iter().map(|&i| i as u32).collect();
                    (first, last, indices_u32)
                } else {
                    (0, 0, vec![])
                }
            } else {
                // No skim match (typo case) - use levenshtein to find best matching word
                // Extract word-character sequences (alphanumeric + underscore)
                let line_str = &lines[idx];
                let mut best_word_start = 0;
                let mut best_word_end = 0;
                let mut best_similarity = 0.0;

                // Find all word boundaries using character classification
                let mut current_word_start = None;
                for (i, ch) in line_str.char_indices() {
                    let is_word_char = ch.is_alphanumeric() || ch == '_';

                    if is_word_char && current_word_start.is_none() {
                        current_word_start = Some(i);
                    } else if !is_word_char && current_word_start.is_some() {
                        let start = current_word_start.unwrap();
                        let word = &line_str[start..i];
                        let norm_word = normalize(word);
                        let distance = damerau_levenshtein(&norm_query, &norm_word);
                        let max_len = norm_query.len().max(norm_word.len());
                        let similarity = 1.0 - (distance as f64 / max_len as f64);

                        if similarity > best_similarity {
                            best_similarity = similarity;
                            best_word_start = start;
                            best_word_end = i;
                        }
                        current_word_start = None;
                    }
                }

                // Handle word at end of line
                if let Some(start) = current_word_start {
                    let word = &line_str[start..];
                    let norm_word = normalize(word);
                    let distance = damerau_levenshtein(&norm_query, &norm_word);
                    let max_len = norm_query.len().max(norm_word.len());
                    let similarity = 1.0 - (distance as f64 / max_len as f64);

                    if similarity > best_similarity {
                        best_similarity = similarity;
                        best_word_start = start;
                        best_word_end = line_str.len();
                    }
                }

                // Create indices for the best matching word
                let indices_vec: Vec<u32> = (best_word_start..best_word_end.min(best_word_start + norm_query.len()))
                    .map(|i| i as u32)
                    .collect();

                (best_word_start, best_word_end, indices_vec)
            };

            FuzzyMatch {
                line_index: idx as u32,
                line_content: lines[idx].clone(),
                score: score as i32,
                match_start: start as u32,
                match_end: end as u32,
                match_indices: indices,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ondid_case() {
        let line = "function onDidAccept() {";
        let query = "ondid";

        let results = fuzzy_search(vec![line.to_string()], query.to_string(), Some(5));

        println!("\n=== Testing 'ondid' → 'onDidAccept' ===");
        if let Some(result) = results.first() {
            println!("Line: {}", result.line_content);
            println!("Match start: {}", result.match_start);
            println!("Match end: {}", result.match_end);
            println!("Match indices: {:?}", result.match_indices);
            println!("Matched text: '{}'", &line[result.match_start as usize..result.match_end as usize]);

            // Simulate TypeScript word detection using regex /\w+/g
            println!("\n--- Simulating TypeScript word detection ---");

            #[derive(Debug)]
            struct Word {
                start: usize,
                end: usize,
                text: String,
            }

            let mut words: Vec<Word> = Vec::new();
            let mut current_word_start = None;

            for (i, ch) in line.char_indices() {
                let is_word_char = ch.is_alphanumeric() || ch == '_';

                if is_word_char && current_word_start.is_none() {
                    current_word_start = Some(i);
                } else if !is_word_char && current_word_start.is_some() {
                    let start = current_word_start.unwrap();
                    words.push(Word {
                        start,
                        end: i,
                        text: line[start..i].to_string(),
                    });
                    current_word_start = None;
                }
            }

            // Handle word at end
            if let Some(start) = current_word_start {
                words.push(Word {
                    start,
                    end: line.len(),
                    text: line[start..].to_string(),
                });
            }

            println!("Words found:");
            for (i, word) in words.iter().enumerate() {
                println!("  [{}] {}-{}: {}", i, word.start, word.end, word.text);
            }

            // Find which words contain match indices
            use std::collections::HashSet;
            let mut highlighted_word_indices: HashSet<usize> = HashSet::new();

            for &char_index in &result.match_indices {
                for (i, word) in words.iter().enumerate() {
                    if char_index as usize >= word.start && (char_index as usize) < word.end {
                        highlighted_word_indices.insert(i);
                        println!("  Char index {} in word [{}] {}", char_index, i, word.text);
                        break;
                    }
                }
            }

            println!("\nHighlighted word indices: {:?}", highlighted_word_indices);

            if highlighted_word_indices.len() == 1 {
                let word_idx = *highlighted_word_indices.iter().next().unwrap();
                let selected_word = &words[word_idx];
                println!("\nCas A: Selection should be word [{}]: '{}'", word_idx, selected_word.text);
                println!("  Selection range: {}-{}", selected_word.start, selected_word.end);
            } else {
                println!("\nCas B: Selection spans {} words", highlighted_word_indices.len());
            }
        } else {
            panic!("No results found for 'ondid'");
        }
    }
}
