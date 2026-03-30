use std::collections::HashSet;
use std::fs;
use std::io::{self, BufRead};

use memchr::memmem;
use napi_derive::napi;

/// Word structure for selection bounds calculation
#[derive(Debug)]
struct Word {
    start: usize,
    end: usize,
}

/// Groups consecutive indices into [start, end] highlight ranges
fn calculate_highlights(indices: &[u32]) -> Vec<Vec<u32>> {
    if indices.is_empty() {
        return vec![];
    }

    let mut highlights: Vec<Vec<u32>> = Vec::new();
    let mut range_start = indices[0];
    let mut range_end = indices[0] + 1;

    for &current_idx in &indices[1..] {
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

/// Calculate selection bounds (single word or span of words).
/// All indices are char-based (not byte offsets) for Unicode correctness.
fn calculate_selection_bounds(line_chars: &[char], match_indices: &[u32]) -> (usize, usize) {
    let mut words: Vec<Word> = Vec::new();
    let mut current_word_start = None;

    for (i, &ch) in line_chars.iter().enumerate() {
        let is_word_char = ch.is_alphanumeric() || ch == '_';

        if is_word_char && current_word_start.is_none() {
            current_word_start = Some(i);
        } else if !is_word_char && current_word_start.is_some() {
            let start = current_word_start.unwrap();
            words.push(Word { start, end: i });
            current_word_start = None;
        }
    }

    if let Some(start) = current_word_start {
        words.push(Word {
            start,
            end: line_chars.len(),
        });
    }

    let mut highlighted_word_indices: HashSet<usize> = HashSet::new();

    for &char_index in match_indices {
        for (i, word) in words.iter().enumerate() {
            if (char_index as usize) >= word.start && (char_index as usize) < word.end {
                highlighted_word_indices.insert(i);
                break;
            }
        }
    }

    if highlighted_word_indices.is_empty() {
        let start = *match_indices.first().unwrap_or(&0) as usize;
        let end = *match_indices.last().unwrap_or(&0) as usize + 1;
        (start, end)
    } else if highlighted_word_indices.len() == 1 {
        let word_idx = *highlighted_word_indices.iter().next().unwrap();
        let selected_word = &words[word_idx];
        (selected_word.start, selected_word.end)
    } else {
        let mut word_indices: Vec<usize> = highlighted_word_indices.iter().copied().collect();
        word_indices.sort();
        let first_word = &words[word_indices[0]];
        let last_word = &words[word_indices[word_indices.len() - 1]];
        (first_word.start, last_word.end)
    }
}

/// SIMD-accelerated byte-level substring search using memchr::memmem.
/// Returns the char index of the match start, or None.
/// For case-sensitive ASCII patterns this is extremely fast (SIMD two-way algorithm).
/// For case-insensitive, falls back to char-level comparison.
fn find_in_line(line: &str, pattern: &str, finder: Option<&memmem::Finder<'_>>, case_insensitive: bool) -> Option<usize> {
    if pattern.is_empty() || line.len() < pattern.len() {
        return None;
    }

    // Fast path: case-sensitive, ASCII — use SIMD memmem
    if !case_insensitive {
        if let Some(f) = finder {
            let byte_pos = f.find(line.as_bytes())?;
            // Convert byte offset to char offset
            return Some(line[..byte_pos].chars().count());
        }
    }

    // Case-insensitive or non-ASCII pattern: char-level search
    let line_chars: Vec<char> = line.chars().collect();
    let pattern_chars: Vec<char> = if case_insensitive {
        pattern.chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect()
    } else {
        pattern.chars().collect()
    };
    let plen = pattern_chars.len();

    if plen > line_chars.len() {
        return None;
    }

    // For case-insensitive ASCII, try SIMD on lowercased bytes first
    if case_insensitive && pattern.is_ascii() && line.is_ascii() {
        let lower_line: String = line.to_ascii_lowercase();
        let lower_pattern: String = pattern.to_ascii_lowercase();
        if let Some(byte_pos) = memmem::find(lower_line.as_bytes(), lower_pattern.as_bytes()) {
            return Some(byte_pos); // ASCII: byte pos == char pos
        }
        return None;
    }

    // Full Unicode case-insensitive fallback
    'outer: for i in 0..=(line_chars.len() - plen) {
        for j in 0..plen {
            let lc = line_chars[i + j].to_lowercase().next().unwrap_or(line_chars[i + j]);
            if lc != pattern_chars[j] {
                continue 'outer;
            }
        }
        return Some(i);
    }
    None
}

/// Build a SearchMatch from a line match
fn build_match(line: &str, line_index: u32, char_pos: usize, pattern_char_len: usize) -> SearchMatch {
    let match_start = char_pos as u32;
    let match_end = (char_pos + pattern_char_len) as u32;
    let match_indices: Vec<u32> = (match_start..match_end).collect();

    let line_chars: Vec<char> = line.chars().collect();
    let (sel_start, sel_end) = calculate_selection_bounds(&line_chars, &match_indices);
    let highlights = calculate_highlights(&match_indices);

    SearchMatch {
        line_index,
        line_content: line.to_string(),
        match_start,
        match_end,
        match_indices,
        selection_start: sel_start as u32,
        selection_end: sel_end as u32,
        highlights,
    }
}

#[napi(object)]
pub struct SearchMatch {
    pub line_index: u32,
    pub line_content: String,
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
    pub text: Option<String>,
    pub path: Option<String>,
}

/// Search document by text content or file path.
/// Streams lines from file — stops reading as soon as limit is reached.
#[napi]
pub fn search_document(
    source: DocumentSource,
    pattern: String,
    limit: Option<u32>,
) -> Vec<SearchMatch> {
    if pattern.is_empty() {
        return vec![];
    }

    let limit = limit.unwrap_or(100) as usize;
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());
    let pattern_char_len = pattern.chars().count();

    // Build SIMD finder for case-sensitive searches
    let finder = if !case_insensitive {
        Some(memmem::Finder::new(pattern.as_bytes()))
    } else {
        None
    };

    // Text source: already in memory, iterate lines directly
    if let Some(text) = source.text {
        let mut results = Vec::with_capacity(limit);
        for (idx, line) in text.lines().enumerate() {
            if results.len() >= limit {
                break;
            }
            if let Some(char_pos) = find_in_line(line, &pattern, finder.as_ref(), case_insensitive) {
                results.push(build_match(line, idx as u32, char_pos, pattern_char_len));
            }
        }
        return results;
    }

    // File source: stream with BufReader, stop at limit
    if let Some(path) = source.path {
        let file = match fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => return vec![],
        };
        let reader = io::BufReader::new(file);
        let mut results = Vec::with_capacity(limit);

        for (idx, line_result) in reader.lines().enumerate() {
            if results.len() >= limit {
                break;
            }
            let line = match line_result {
                Ok(l) => l,
                Err(_) => break,
            };
            if let Some(char_pos) = find_in_line(&line, &pattern, finder.as_ref(), case_insensitive) {
                results.push(build_match(&line, idx as u32, char_pos, pattern_char_len));
            }
        }
        return results;
    }

    vec![]
}

/// Search lines for a pattern. Exported for testing and direct use.
#[napi]
pub fn search(lines: Vec<String>, pattern: String, limit: Option<u32>) -> Vec<SearchMatch> {
    if pattern.is_empty() {
        return vec![];
    }

    let limit = limit.unwrap_or(100) as usize;
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());
    let pattern_char_len = pattern.chars().count();

    let finder = if !case_insensitive {
        Some(memmem::Finder::new(pattern.as_bytes()))
    } else {
        None
    };

    let mut results: Vec<SearchMatch> = Vec::with_capacity(limit);

    for (idx, line) in lines.iter().enumerate() {
        if results.len() >= limit {
            break;
        }
        if let Some(char_pos) = find_in_line(line, &pattern, finder.as_ref(), case_insensitive) {
            results.push(build_match(line, idx as u32, char_pos, pattern_char_len));
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
        let results = search(vec![line.to_string()], query.to_string(), Some(5));

        assert!(
            !results.is_empty(),
            "[{}] Should find match for '{}'",
            test_name,
            query
        );
        let result = &results[0];

        assert_eq!(
            result.match_start, expected_start,
            "[{}] match_start",
            test_name
        );
        assert_eq!(result.match_end, expected_end, "[{}] match_end", test_name);
    }

    fn assert_no_match(test_name: &str, line: &str, query: &str) {
        let results = search(vec![line.to_string()], query.to_string(), Some(5));
        assert!(
            results.is_empty(),
            "[{}] Should NOT find match for '{}'",
            test_name,
            query
        );
    }

    #[test]
    fn test_plain_substring_match() {
        assert_match(
            "plain substring",
            "function applySelectionFromItem() {",
            "apply",
            9,
            14,
        );
    }

    #[test]
    fn test_case_insensitive_by_default() {
        assert_match(
            "case insensitive",
            "function ApplySelection() {",
            "apply",
            9,
            14,
        );
    }

    #[test]
    fn test_case_sensitive_when_uppercase_in_query() {
        assert_match(
            "case sensitive uppercase query",
            "function ApplySelection() {",
            "Apply",
            9,
            14,
        );
        assert_no_match(
            "case sensitive no match",
            "function applySelection() {",
            "Apply",
        );
    }

    #[test]
    fn test_non_contiguous_chars_do_not_match() {
        assert_no_match(
            "scattered chars across word",
            "function applySelectionFromItem() {",
            "afrm",
        );
    }

    #[test]
    fn test_scattered_chars_do_not_match() {
        assert_no_match(
            "scattered chars",
            "export async function applySelectionFromItem(): boolean {",
            "expfnitem",
        );
    }

    #[test]
    fn test_contiguous_match_in_identifier() {
        let results = search(
            vec!["function onDidAccept() {".to_string()],
            "ondid".to_string(),
            Some(5),
        );
        assert!(
            !results.is_empty(),
            "ondid should match onDidAccept case-insensitively"
        );
        assert_eq!(results[0].match_start, 9);
        assert_eq!(results[0].match_end, 14);
    }

    #[test]
    fn test_selection_bounds_single_word() {
        let results = search(
            vec!["export async function applySelectionFromItem(): boolean {".to_string()],
            "apply".to_string(),
            Some(5),
        );
        assert!(!results.is_empty());
        assert_eq!(results[0].selection_start, 22);
        assert_eq!(results[0].selection_end, 44);
    }

    #[test]
    fn test_highlights_contiguous() {
        let results = search(
            vec!["const foo = bar".to_string()],
            "foo".to_string(),
            Some(5),
        );
        assert!(!results.is_empty());
        assert_eq!(results[0].highlights.len(), 1);
        assert_eq!(results[0].highlights[0], vec![6, 9]);
    }

    #[test]
    fn test_line_order() {
        let lines = vec![
            "third line has foo here".to_string(),
            "first line".to_string(),
            "second line with foo".to_string(),
            "fourth foo line".to_string(),
        ];
        let results = search(lines, "foo".to_string(), Some(10));
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].line_index, 0);
        assert_eq!(results[1].line_index, 2);
        assert_eq!(results[2].line_index, 3);
    }

    #[test]
    fn test_empty_pattern() {
        let results = search(vec!["hello".to_string()], "".to_string(), Some(5));
        assert!(results.is_empty());
    }

    #[test]
    fn test_limit() {
        let lines: Vec<String> = (0..200).map(|i| format!("line {} with foo", i)).collect();
        let results = search(lines, "foo".to_string(), Some(50));
        assert_eq!(results.len(), 50);
    }

    #[test]
    fn test_unicode_case_insensitive() {
        assert_match("unicode lowercase", "let café = 42", "café", 4, 8);
        assert_match("unicode case insensitive", "let Café = 42", "café", 4, 8);
    }
}
