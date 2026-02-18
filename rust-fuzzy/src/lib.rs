use napi_derive::napi;

/// Word structure for selection bounds calculation
#[derive(Debug)]
struct Word {
    start: usize,
    end: usize,
}

/// Calculate highlights from match indices
/// Groups consecutive indices into [start, end] ranges
fn calculate_highlights(indices: &[u32]) -> Vec<Vec<u32>> {
    if indices.is_empty() {
        return vec![];
    }

    let mut highlights: Vec<Vec<u32>> = Vec::new();
    let mut range_start = indices[0];
    let mut range_end = indices[0] + 1;

    for i in 1..indices.len() {
        let current_idx = indices[i];
        if current_idx == range_end {
            range_end = current_idx + 1;
        } else {
            highlights.push(vec![range_start, range_end]);
            range_start = current_idx;
            range_end = current_idx + 1;
        }
    }
    highlights.push(vec![range_start, range_end]);

    highlights
}

/// Calculate selection bounds following TypeScript logic (Cas A or Cas B)
/// Returns (selection_start, selection_end)
fn calculate_selection_bounds(
    line: &str,
    match_indices: &[u32],
) -> (usize, usize) {
    use std::collections::HashSet;

    // Find all words in the line (mimics /\w+/g regex)
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
            });
            current_word_start = None;
        }
    }

    // Handle word at end of line
    if let Some(start) = current_word_start {
        words.push(Word {
            start,
            end: line.len(),
        });
    }

    // Find which words contain highlighted characters
    let mut highlighted_word_indices: HashSet<usize> = HashSet::new();

    for &char_index in match_indices {
        for (i, word) in words.iter().enumerate() {
            if (char_index as usize) >= word.start && (char_index as usize) < word.end {
                highlighted_word_indices.insert(i);
                break;
            }
        }
    }

    // Determine selection based on distribution of highlighted characters
    if highlighted_word_indices.is_empty() {
        // Fallback: no words found (shouldn't happen in normal cases)
        let start = *match_indices.first().unwrap_or(&0) as usize;
        let end = *match_indices.last().unwrap_or(&0) as usize + 1;
        (start, end)
    } else if highlighted_word_indices.len() == 1 {
        // Cas A: All highlights in ONE word → select that entire word
        let word_idx = *highlighted_word_indices.iter().next().unwrap();
        let selected_word = &words[word_idx];
        (selected_word.start, selected_word.end)
    } else {
        // Cas B: Highlights span MULTIPLE words → select from first to last word
        let mut word_indices: Vec<usize> = highlighted_word_indices.iter().copied().collect();
        word_indices.sort();
        let first_word = &words[word_indices[0]];
        let last_word = &words[word_indices[word_indices.len() - 1]];
        (first_word.start, last_word.end)
    }
}

/// Plain text substring search (char-level)
/// Smart case: case-insensitive unless query contains uppercase
/// Returns the char index of the first match, or None
fn find_plain(line_chars: &[char], pattern_chars: &[char], case_insensitive: bool) -> Option<usize> {
    let plen = pattern_chars.len();

    if plen == 0 || plen > line_chars.len() {
        return None;
    }

    'outer: for i in 0..=(line_chars.len() - plen) {
        for j in 0..plen {
            let lc = if case_insensitive {
                line_chars[i + j].to_ascii_lowercase()
            } else {
                line_chars[i + j]
            };
            if lc != pattern_chars[j] {
                continue 'outer;
            }
        }
        return Some(i);
    }
    None
}

#[napi(object)]
pub struct FuzzyMatch {
    pub line_index: u32,
    pub line_content: String,
    pub score: i32,
    pub match_start: u32,
    pub match_end: u32,
    pub match_indices: Vec<u32>,
    pub selection_start: u32,
    pub selection_end: u32,
    pub highlights: Vec<Vec<u32>>,
}

/// Document source: either text content or file path
#[napi(object)]
pub struct DocumentSource {
    /// Text content (if document is dirty or unsaved)
    pub text: Option<String>,
    /// File path (if document is clean and saved)
    pub path: Option<String>,
}

/// Plain text search from document source (hybrid: text or file path)
/// Returns matches in line order (first occurrence per line)
#[napi]
pub fn fuzzy_search_document(source: DocumentSource, pattern: String, limit: Option<u32>) -> Vec<FuzzyMatch> {
    use std::fs;
    use std::io::{self, BufRead};

    if pattern.is_empty() {
        return vec![];
    }

    let lines: Vec<String> = if let Some(text) = source.text {
        text.lines().map(|s| s.to_string()).collect()
    } else if let Some(path) = source.path {
        match fs::File::open(&path) {
            Ok(file) => {
                io::BufReader::new(file)
                    .lines()
                    .filter_map(|line| line.ok())
                    .collect()
            }
            Err(_e) => {
                eprintln!("[RUST ERROR] Failed to read file '{}': {}", path, _e);
                return vec![];
            }
        }
    } else {
        eprintln!("[RUST ERROR] DocumentSource must have either text or path");
        return vec![];
    };

    plain_search_internal(lines, pattern, limit)
}

/// Legacy function for backward compatibility
#[napi]
pub fn fuzzy_search(lines: Vec<String>, pattern: String, limit: Option<u32>) -> Vec<FuzzyMatch> {
    plain_search_internal(lines, pattern, limit)
}

/// Internal plain text search implementation
/// Smart case: case-insensitive unless query contains uppercase
fn plain_search_internal(lines: Vec<String>, pattern: String, limit: Option<u32>) -> Vec<FuzzyMatch> {
    if pattern.is_empty() {
        return vec![];
    }

    let limit = limit.unwrap_or(100) as usize;

    // Smart case: case-insensitive unless query contains uppercase
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());

    let pattern_chars: Vec<char> = if case_insensitive {
        pattern.chars().map(|c| c.to_ascii_lowercase()).collect()
    } else {
        pattern.chars().collect()
    };
    let pattern_len = pattern_chars.len();

    let mut results: Vec<FuzzyMatch> = Vec::with_capacity(limit.min(lines.len() / 10));

    for (idx, line) in lines.iter().enumerate() {
        if results.len() >= limit {
            break;
        }

        let line_chars: Vec<char> = line.chars().collect();

        if let Some(char_pos) = find_plain(&line_chars, &pattern_chars, case_insensitive) {
            let match_start = char_pos as u32;
            let match_end = (char_pos + pattern_len) as u32;

            // Contiguous match indices
            let match_indices: Vec<u32> = (match_start..match_end).collect();

            let (sel_start, sel_end) = calculate_selection_bounds(line, &match_indices);

            results.push(FuzzyMatch {
                line_index: idx as u32,
                line_content: line.clone(),
                score: 0,
                match_start,
                match_end,
                match_indices: match_indices.clone(),
                selection_start: sel_start as u32,
                selection_end: sel_end as u32,
                highlights: calculate_highlights(&match_indices),
            });
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_match(
        test_name: &str,
        line: &str,
        query: &str,
        expected_start: u32,
        expected_end: u32,
    ) {
        let results = fuzzy_search(vec![line.to_string()], query.to_string(), Some(5));

        assert!(!results.is_empty(), "[{}] Should find match for '{}'", test_name, query);
        let result = &results[0];

        println!("\n=== {} ===", test_name);
        println!("Query: '{}'", query);
        println!("Line: {}", result.line_content);
        println!("Match: {}-{}", result.match_start, result.match_end);
        println!("Matched text: '{}'", &line[result.match_start as usize..result.match_end as usize]);

        assert_eq!(result.match_start, expected_start,
                   "[{}] match_start", test_name);
        assert_eq!(result.match_end, expected_end,
                   "[{}] match_end", test_name);
    }

    fn assert_no_match(test_name: &str, line: &str, query: &str) {
        let results = fuzzy_search(vec![line.to_string()], query.to_string(), Some(5));
        assert!(results.is_empty(), "[{}] Should NOT find match for '{}'", test_name, query);
    }

    #[test]
    fn test_plain_substring_match() {
        assert_match(
            "plain substring",
            "function applySelectionFromItem() {",
            "apply",
            9, 14,
        );
    }

    #[test]
    fn test_case_insensitive_by_default() {
        assert_match(
            "case insensitive",
            "function ApplySelection() {",
            "apply",
            9, 14,
        );
    }

    #[test]
    fn test_case_sensitive_when_uppercase_in_query() {
        // Query has uppercase → case-sensitive
        assert_match(
            "case sensitive uppercase query",
            "function ApplySelection() {",
            "Apply",
            9, 14,
        );
        assert_no_match(
            "case sensitive no match",
            "function applySelection() {",
            "Apply",
        );
    }

    #[test]
    fn test_no_fuzzy_matching() {
        // "afrm" should NOT match "applySelectionFromItem" (non-contiguous chars)
        assert_no_match(
            "no fuzzy: scattered chars across word",
            "function applySelectionFromItem() {",
            "afrm",
        );
    }

    #[test]
    fn test_no_fuzzy_scattered_chars() {
        // "expfnitem" should NOT match (scattered chars)
        assert_no_match(
            "no fuzzy: scattered chars",
            "export async function applySelectionFromItem(): boolean {",
            "expfnitem",
        );
    }

    #[test]
    fn test_contiguous_match_in_identifier() {
        // "ondid" won't match "onDidAccept" but "onDid" (case-insensitive) would
        // since "ondid" lowered matches "ondid" in "onDidAccept" lowered → "ondidaccept"
        // Wait: "onDidAccept" lowered = "ondidaccept", and "ondid" is a substring of that!
        // So this SHOULD match case-insensitively.
        let line = "function onDidAccept() {";
        let results = fuzzy_search(vec![line.to_string()], "ondid".to_string(), Some(5));
        assert!(!results.is_empty(), "ondid should match onDidAccept case-insensitively");
        let r = &results[0];
        assert_eq!(r.match_start, 9); // "onDid" starts at char 9
        assert_eq!(r.match_end, 14);  // 5 chars
    }

    #[test]
    fn test_selection_bounds_single_word() {
        let line = "export async function applySelectionFromItem(): boolean {";
        let results = fuzzy_search(vec![line.to_string()], "apply".to_string(), Some(5));
        assert!(!results.is_empty());
        let r = &results[0];
        // Match is inside "applySelectionFromItem" → Cas A: select entire word
        assert_eq!(r.selection_start, 22);
        assert_eq!(r.selection_end, 44);
    }

    #[test]
    fn test_highlights_contiguous() {
        let line = "const foo = bar";
        let results = fuzzy_search(vec![line.to_string()], "foo".to_string(), Some(5));
        assert!(!results.is_empty());
        let r = &results[0];
        // Highlights should be a single contiguous range
        assert_eq!(r.highlights.len(), 1);
        assert_eq!(r.highlights[0], vec![6, 9]);
    }

    #[test]
    fn test_line_order() {
        let lines = vec![
            "third line has foo here".to_string(),
            "first line".to_string(),
            "second line with foo".to_string(),
            "fourth foo line".to_string(),
        ];
        let results = fuzzy_search(lines, "foo".to_string(), Some(10));
        assert_eq!(results.len(), 3);
        // Results should be in line order
        assert_eq!(results[0].line_index, 0);
        assert_eq!(results[1].line_index, 2);
        assert_eq!(results[2].line_index, 3);
    }

    #[test]
    fn test_empty_pattern() {
        let results = fuzzy_search(vec!["hello".to_string()], "".to_string(), Some(5));
        assert!(results.is_empty());
    }

    #[test]
    fn test_limit() {
        let lines: Vec<String> = (0..200).map(|i| format!("line {} with foo", i)).collect();
        let results = fuzzy_search(lines, "foo".to_string(), Some(50));
        assert_eq!(results.len(), 50);
    }
}
