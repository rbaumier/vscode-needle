use fuzzy_matcher::FuzzyMatcher;
use fuzzy_matcher::skim::SkimMatcherV2;
use napi::bindgen_prelude::*;
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

/// Calculate hybrid score combining skim and levenshtein
fn calculate_hybrid_score(
    skim: &SkimMatcherV2,
    query: &str,
    candidate: &str,
) -> i64 {
    // 1. Skim score (subsequence matching)
    let skim_score = skim
        .fuzzy_match(candidate, query)
        .unwrap_or(0);

    // 2. Levenshtein score (typo tolerance)
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

    // Calculate scores for all lines
    let mut results: Vec<(usize, i64, Option<(i64, Vec<usize>)>)> = lines
        .iter()
        .enumerate()
        .filter_map(|(idx, line)| {
            let norm_line = normalize(line);

            // Get match positions using skim's fuzzy_indices
            let match_positions = skim.fuzzy_indices(&norm_line, &norm_query);

            // Only include if skim actually matched
            if match_positions.is_some() {
                let score = calculate_hybrid_score(&skim, &norm_query, &norm_line);
                Some((idx, score, match_positions))
            } else {
                None
            }
        })
        .collect();

    // Sort by score (descending)
    results.sort_by(|a, b| b.1.cmp(&a.1));

    // Take top matches and convert to FuzzyMatch
    results
        .into_iter()
        .take(limit)
        .map(|(idx, score, positions)| {
            let (start, end) = if let Some((_score, indices)) = positions {
                if !indices.is_empty() {
                    let first = *indices.first().unwrap();
                    let last = *indices.last().unwrap() + 1;
                    (first, last)
                } else {
                    (0, 0)
                }
            } else {
                (0, 0)
            };

            FuzzyMatch {
                line_index: idx as u32,
                line_content: lines[idx].clone(),
                score: score as i32,
                match_start: start as u32,
                match_end: end as u32,
            }
        })
        .collect()
}
