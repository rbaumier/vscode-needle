use std::fs;
use std::io::{self, BufRead};

use memchr::memmem;
use napi_derive::napi;

/// Flat search results — parallel arrays, no per-match allocations.
/// Selection bounds are computed TS-side from match offsets + text.
#[napi(object)]
pub struct SearchResults {
    pub count: u32,
    pub line_indices: Vec<u32>,
    pub line_byte_starts: Vec<u32>,
    pub line_byte_ends: Vec<u32>,
    pub match_starts: Vec<u32>,
    pub match_ends: Vec<u32>,
}

impl SearchResults {
    fn with_capacity(cap: usize) -> Self {
        Self {
            count: 0,
            line_indices: Vec::with_capacity(cap),
            line_byte_starts: Vec::with_capacity(cap),
            line_byte_ends: Vec::with_capacity(cap),
            match_starts: Vec::with_capacity(cap),
            match_ends: Vec::with_capacity(cap),
        }
    }

    #[inline]
    fn push(&mut self, line_index: u32, line_byte_start: u32, line_byte_end: u32, match_start: u32, match_end: u32) {
        self.line_indices.push(line_index);
        self.line_byte_starts.push(line_byte_start);
        self.line_byte_ends.push(line_byte_end);
        self.match_starts.push(match_start);
        self.match_ends.push(match_end);
        self.count += 1;
    }
}

/// SIMD byte-level search on a buffer.
/// Tracks line boundaries incrementally (no memrchr per hit).
fn search_bytes_flat(
    buf: &[u8],
    pat_bytes: &[u8],
    pat_char_len: u32,
    limit: usize,
    case_insensitive: bool,
) -> SearchResults {
    if buf.is_empty() {
        return SearchResults::with_capacity(0);
    }

    let mut results = SearchResults::with_capacity(limit.min(1000));
    let pat_len = pat_bytes.len();

    // Incremental line counter
    let mut line_count: u32 = 0;
    let mut counted_to: usize = 0;

    // Common hit processing: line boundaries via memrchr/memchr, incremental line count
    let mut process_hit = |hit: usize| -> bool {
        let ls = match memchr::memrchr(b'\n', &buf[..hit]) {
            Some(p) => p + 1,
            None => 0,
        };
        let le = match memchr::memchr(b'\n', &buf[hit..]) {
            Some(p) => hit + p,
            None => buf.len(),
        };

        // Incremental line counting (SIMD memchr_iter on the gap)
        if hit > counted_to {
            line_count += memchr::memchr_iter(b'\n', &buf[counted_to..hit]).count() as u32;
            counted_to = hit;
        }

        let byte_in_line = hit - ls;
        let char_pos = if buf[ls..le].is_ascii() {
            byte_in_line as u32
        } else {
            std::str::from_utf8(&buf[ls..hit])
                .map(|s| s.chars().count() as u32)
                .unwrap_or(byte_in_line as u32)
        };

        results.push(line_count, ls as u32, le as u32, char_pos, char_pos + pat_char_len);
        results.count as usize >= limit
    };

    if !case_insensitive {
        let finder = memmem::Finder::new(pat_bytes);
        let mut pos = 0;

        while pos < buf.len() {
            let hit = match finder.find(&buf[pos..]) {
                Some(offset) => pos + offset,
                None => break,
            };

            if process_hit(hit) { break; }

            // Skip to next line
            pos = match memchr::memchr(b'\n', &buf[hit..]) {
                Some(p) => hit + p + 1,
                None => buf.len(),
            };
        }
    } else {
        let first_lower = pat_bytes[0].to_ascii_lowercase();
        let first_upper = pat_bytes[0].to_ascii_uppercase();
        let use_single = first_lower == first_upper;
        let mut pos = 0;
        let mut prev_line_start = usize::MAX;

        while pos < buf.len() {
            let hit = if use_single {
                match memchr::memchr(first_lower, &buf[pos..]) {
                    Some(offset) => pos + offset,
                    None => break,
                }
            } else {
                match memchr::memchr2(first_lower, first_upper, &buf[pos..]) {
                    Some(offset) => pos + offset,
                    None => break,
                }
            };

            if hit + pat_len > buf.len() { break; }

            if !buf[hit..hit + pat_len].iter().zip(pat_bytes.iter()).all(|(a, b)| a.eq_ignore_ascii_case(b)) {
                pos = hit + 1;
                continue;
            }

            // Dedup same line
            let ls = match memchr::memrchr(b'\n', &buf[..hit]) {
                Some(p) => p + 1,
                None => 0,
            };
            if ls == prev_line_start {
                pos = hit + 1;
                continue;
            }
            prev_line_start = ls;

            if process_hit(hit) { break; }

            pos = match memchr::memchr(b'\n', &buf[hit..]) {
                Some(p) => hit + p + 1,
                None => buf.len(),
            };
        }
    }

    results
}

/// Non-ASCII line-by-line fallback.
fn search_lines_flat(text: &str, pattern: &str, limit: usize) -> SearchResults {
    let pattern_chars: Vec<char> = pattern
        .chars()
        .map(|c| c.to_lowercase().next().unwrap_or(c))
        .collect();
    let plen = pattern_chars.len();
    let pat_char_len = plen as u32;
    let mut results = SearchResults::with_capacity(limit.min(1000));
    let mut byte_offset = 0usize;

    for (idx, line) in text.lines().enumerate() {
        if results.count as usize >= limit {
            break;
        }

        let line_byte_start = byte_offset;
        let line_byte_end = byte_offset + line.len();
        byte_offset = line_byte_end + 1;

        let line_chars: Vec<char> = line.chars().collect();
        if plen > line_chars.len() {
            continue;
        }

        let found = 'search: {
            for i in 0..=(line_chars.len() - plen) {
                let mut matched = true;
                for j in 0..plen {
                    let lc = line_chars[i + j].to_lowercase().next().unwrap_or(line_chars[i + j]);
                    if lc != pattern_chars[j] {
                        matched = false;
                        break;
                    }
                }
                if matched {
                    break 'search Some(i);
                }
            }
            None
        };

        if let Some(char_pos) = found {
            let cp = char_pos as u32;
            results.push(idx as u32, line_byte_start as u32, line_byte_end as u32, cp, cp + pat_char_len);
        }
    }

    results
}

#[napi]
pub fn search_text(text: String, pattern: String, limit: Option<u32>) -> SearchResults {
    if pattern.is_empty() || text.is_empty() {
        return SearchResults::with_capacity(0);
    }

    let limit = limit.unwrap_or(100) as usize;
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());

    if pattern.is_ascii() {
        return search_bytes_flat(text.as_bytes(), pattern.as_bytes(), pattern.chars().count() as u32, limit, case_insensitive);
    }

    search_lines_flat(&text, &pattern, limit)
}

#[napi]
pub fn search_file(path: String, pattern: String, limit: Option<u32>) -> SearchResults {
    if pattern.is_empty() {
        return SearchResults::with_capacity(0);
    }

    let limit = limit.unwrap_or(100) as usize;
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());
    let pat_char_len = pattern.chars().count() as u32;

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return SearchResults::with_capacity(0),
    };

    if pattern.is_ascii() {
        // SAFETY: file is opened read-only
        let mmap = match unsafe { memmap2::Mmap::map(&file) } {
            Ok(m) => m,
            Err(_) => return SearchResults::with_capacity(0),
        };
        return search_bytes_flat(&mmap, pattern.as_bytes(), pat_char_len, limit, case_insensitive);
    }

    let reader = io::BufReader::new(file);
    let text: String = reader.lines().map_while(Result::ok).collect::<Vec<_>>().join("\n");
    search_lines_flat(&text, &pattern, limit)
}

/// Legacy API for backward compatibility with tests.
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

fn selection_bounds_ascii(bytes: &[u8], match_start: usize, match_end: usize) -> (u32, u32) {
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut s = match_start;
    while s > 0 && is_word(bytes[s - 1]) { s -= 1; }
    let mut e = match_end;
    while e < bytes.len() && is_word(bytes[e]) { e += 1; }
    (s as u32, e as u32)
}

fn selection_bounds_unicode(line: &str, match_start: usize, match_end: usize) -> (u32, u32) {
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    let chars: Vec<char> = line.chars().collect();
    let mut s = match_start;
    while s > 0 && is_word(chars[s - 1]) { s -= 1; }
    let mut e = match_end;
    while e < chars.len() && is_word(chars[e]) { e += 1; }
    (s as u32, e as u32)
}

#[napi]
pub fn search(lines: Vec<String>, pattern: String, limit: Option<u32>) -> Vec<SearchMatch> {
    let text = lines.join("\n");
    let results = search_text(text.clone(), pattern, limit);

    let mut matches = Vec::with_capacity(results.count as usize);
    for i in 0..results.count as usize {
        let ls = results.line_byte_starts[i] as usize;
        let le = (results.line_byte_ends[i] as usize).min(text.len());
        let line = &text[ls..le];
        let ms = results.match_starts[i] as usize;
        let me = results.match_ends[i] as usize;

        let (ss, se) = if line.is_ascii() {
            selection_bounds_ascii(line.as_bytes(), ms, me)
        } else {
            selection_bounds_unicode(line, ms, me)
        };

        matches.push(SearchMatch {
            line_index: results.line_indices[i],
            line_content: line.to_string(),
            match_start: ms as u32,
            match_end: me as u32,
            match_indices: (ms as u32..me as u32).collect(),
            selection_start: ss,
            selection_end: se,
            highlights: vec![vec![ms as u32, me as u32]],
        });
    }
    matches
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_match(test_name: &str, line: &str, query: &str, expected_start: u32, expected_end: u32) {
        let results = search(vec![line.to_string()], query.to_string(), Some(5));
        assert!(!results.is_empty(), "[{}] Should find match for '{}'", test_name, query);
        assert_eq!(results[0].match_start, expected_start, "[{}] match_start", test_name);
        assert_eq!(results[0].match_end, expected_end, "[{}] match_end", test_name);
    }

    fn assert_no_match(test_name: &str, line: &str, query: &str) {
        let results = search(vec![line.to_string()], query.to_string(), Some(5));
        assert!(results.is_empty(), "[{}] Should NOT find match for '{}'", test_name, query);
    }

    #[test]
    fn test_plain_substring_match() {
        assert_match("plain substring", "function applySelectionFromItem() {", "apply", 9, 14);
    }

    #[test]
    fn test_case_insensitive_by_default() {
        assert_match("case insensitive", "function ApplySelection() {", "apply", 9, 14);
    }

    #[test]
    fn test_case_sensitive_when_uppercase_in_query() {
        assert_match("case sensitive", "function ApplySelection() {", "Apply", 9, 14);
        assert_no_match("case sensitive no match", "function applySelection() {", "Apply");
    }

    #[test]
    fn test_non_contiguous_chars_do_not_match() {
        assert_no_match("scattered", "function applySelectionFromItem() {", "afrm");
    }

    #[test]
    fn test_scattered_chars_do_not_match() {
        assert_no_match("scattered2", "export async function applySelectionFromItem(): boolean {", "expfnitem");
    }

    #[test]
    fn test_contiguous_match_in_identifier() {
        let r = search(vec!["function onDidAccept() {".to_string()], "ondid".to_string(), Some(5));
        assert!(!r.is_empty());
        assert_eq!(r[0].match_start, 9);
        assert_eq!(r[0].match_end, 14);
    }

    #[test]
    fn test_selection_bounds_single_word() {
        let r = search(vec!["export async function applySelectionFromItem(): boolean {".to_string()], "apply".to_string(), Some(5));
        assert!(!r.is_empty());
        assert_eq!(r[0].selection_start, 22);
        assert_eq!(r[0].selection_end, 44);
    }

    #[test]
    fn test_highlights_contiguous() {
        let r = search(vec!["const foo = bar".to_string()], "foo".to_string(), Some(5));
        assert!(!r.is_empty());
        assert_eq!(r[0].highlights, vec![vec![6, 9]]);
    }

    #[test]
    fn test_line_order() {
        let lines = vec!["third line has foo here".to_string(), "first line".to_string(), "second line with foo".to_string(), "fourth foo line".to_string()];
        let r = search(lines, "foo".to_string(), Some(10));
        assert_eq!(r.len(), 3);
        assert_eq!(r[0].line_index, 0);
        assert_eq!(r[1].line_index, 2);
        assert_eq!(r[2].line_index, 3);
    }

    #[test]
    fn test_empty_pattern() {
        assert!(search(vec!["hello".to_string()], "".to_string(), Some(5)).is_empty());
    }

    #[test]
    fn test_limit() {
        let lines: Vec<String> = (0..200).map(|i| format!("line {} with foo", i)).collect();
        assert_eq!(search(lines, "foo".to_string(), Some(50)).len(), 50);
    }

    #[test]
    fn test_unicode_case_insensitive() {
        assert_match("unicode lowercase", "let café = 42", "café", 4, 8);
        assert_match("unicode case insensitive", "let Café = 42", "café", 4, 8);
    }

    #[test]
    fn test_multiline_buffer_search() {
        let lines = vec!["first line".to_string(), "second line with foo".to_string(), "third line".to_string(), "fourth foo line".to_string()];
        let r = search(lines, "foo".to_string(), Some(10));
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].line_index, 1);
        assert_eq!(r[0].line_content, "second line with foo");
        assert_eq!(r[1].line_index, 3);
    }

    #[test]
    fn test_search_text_flat() {
        let r = search_text("first line\nsecond foo line\nthird\nfourth foo".to_string(), "foo".to_string(), Some(10));
        assert_eq!(r.count, 2);
        assert_eq!(r.line_indices, vec![1, 3]);
        assert_eq!(r.match_starts, vec![7, 7]);
    }
}
