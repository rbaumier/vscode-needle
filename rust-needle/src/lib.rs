use std::fs;
use std::io::{self, BufRead};

use memchr::memmem;
use napi_derive::napi;

/// Incremental line counter — counts \n between `from` and `to` in the buffer.
#[inline]
fn count_newlines_between(buf: &[u8], from: usize, to: usize) -> u32 {
    if from >= to {
        return 0;
    }
    memchr::memchr_iter(b'\n', &buf[from..to]).count() as u32
}

struct LineTracker {
    scanned_to: usize,
    line: u32,
}

impl LineTracker {
    fn new() -> Self {
        Self { scanned_to: 0, line: 0 }
    }

    #[inline]
    fn line_at(&mut self, buf: &[u8], byte_pos: usize) -> u32 {
        if byte_pos > self.scanned_to {
            self.line += count_newlines_between(buf, self.scanned_to, byte_pos);
            self.scanned_to = byte_pos;
        }
        self.line
    }
}

/// Fast selection bounds: expand match to word boundaries.
#[inline]
fn selection_bounds_ascii(bytes: &[u8], match_start: usize, match_end: usize) -> (u32, u32) {
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut sel_start = match_start;
    while sel_start > 0 && is_word(bytes[sel_start - 1]) {
        sel_start -= 1;
    }
    let mut sel_end = match_end;
    while sel_end < bytes.len() && is_word(bytes[sel_end]) {
        sel_end += 1;
    }
    (sel_start as u32, sel_end as u32)
}

#[inline]
fn selection_bounds_unicode(line: &str, match_start: usize, match_end: usize) -> (u32, u32) {
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    let chars: Vec<char> = line.chars().collect();
    let mut sel_start = match_start;
    while sel_start > 0 && is_word(chars[sel_start - 1]) {
        sel_start -= 1;
    }
    let mut sel_end = match_end;
    while sel_end < chars.len() && is_word(chars[sel_end]) {
        sel_end += 1;
    }
    (sel_start as u32, sel_end as u32)
}

/// Flat search results — no per-match string allocations.
/// All arrays are parallel (same index = same match).
#[napi(object)]
pub struct SearchResults {
    /// Number of matches found
    pub count: u32,
    /// Line number (0-based) for each match
    pub line_indices: Vec<u32>,
    /// Byte offset of line start in source text (for TS to extract line content)
    pub line_byte_starts: Vec<u32>,
    /// Byte offset of line end in source text
    pub line_byte_ends: Vec<u32>,
    /// Char offset of match start within the line
    pub match_starts: Vec<u32>,
    /// Char offset of match end within the line
    pub match_ends: Vec<u32>,
    /// Char offset of selection start within the line (word-expanded)
    pub selection_starts: Vec<u32>,
    /// Char offset of selection end within the line
    pub selection_ends: Vec<u32>,
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
            selection_starts: Vec::with_capacity(cap),
            selection_ends: Vec::with_capacity(cap),
        }
    }

    #[inline]
    #[allow(clippy::too_many_arguments)]
    fn push(
        &mut self,
        line_index: u32,
        line_byte_start: u32,
        line_byte_end: u32,
        match_start: u32,
        match_end: u32,
        sel_start: u32,
        sel_end: u32,
    ) {
        self.line_indices.push(line_index);
        self.line_byte_starts.push(line_byte_start);
        self.line_byte_ends.push(line_byte_end);
        self.match_starts.push(match_start);
        self.match_ends.push(match_end);
        self.selection_starts.push(sel_start);
        self.selection_ends.push(sel_end);
        self.count += 1;
    }
}

/// Search text buffer. Returns flat offset arrays — no string copies.
/// TS extracts line content using line_byte_starts/line_byte_ends.
#[napi]
pub fn search_text(text: String, pattern: String, limit: Option<u32>) -> SearchResults {
    if pattern.is_empty() || text.is_empty() {
        return SearchResults::with_capacity(0);
    }

    let limit = limit.unwrap_or(100) as usize;
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());
    let pat_bytes = pattern.as_bytes();
    let pat_char_len = pattern.chars().count() as u32;
    let buf = text.as_bytes();

    if pattern.is_ascii() {
        return search_bytes_flat(buf, pat_bytes, pat_char_len, limit, case_insensitive);
    }

    // Non-ASCII fallback: line-by-line
    search_lines_flat(&text, &pattern, limit)
}

/// Search file by path. Returns flat offset arrays.
/// For ASCII patterns: mmap + SIMD. For non-ASCII: BufReader fallback.
#[napi]
pub fn search_file(path: String, pattern: String, limit: Option<u32>) -> SearchResults {
    if pattern.is_empty() {
        return SearchResults::with_capacity(0);
    }

    let limit = limit.unwrap_or(100) as usize;
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());
    let pat_bytes = pattern.as_bytes();
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
        return search_bytes_flat(&mmap, pat_bytes, pat_char_len, limit, case_insensitive);
    }

    // Non-ASCII fallback
    let reader = io::BufReader::new(file);
    let text: String = reader
        .lines()
        .map_while(Result::ok)
        .collect::<Vec<_>>()
        .join("\n");
    search_lines_flat(&text, &pattern, limit)
}

/// SIMD byte-level search returning flat results.
fn search_bytes_flat(
    buf: &[u8],
    pat_bytes: &[u8],
    pat_char_len: u32,
    limit: usize,
    case_insensitive: bool,
) -> SearchResults {
    let mut results = SearchResults::with_capacity(limit.min(1000));
    let mut tracker = LineTracker::new();
    let mut prev_line_start: usize = usize::MAX;
    let pat_len = pat_bytes.len();

    let line_start_of = |hit: usize| -> usize {
        match memchr::memrchr(b'\n', &buf[..hit]) {
            Some(p) => p + 1,
            None => 0,
        }
    };

    let line_end_of = |hit: usize| -> usize {
        match memchr::memchr(b'\n', &buf[hit..]) {
            Some(p) => hit + p,
            None => buf.len(),
        }
    };

    let mut process = |hit: usize| -> bool {
        let ls = line_start_of(hit);
        if ls == prev_line_start {
            return false; // same line, skip
        }
        prev_line_start = ls;

        let le = line_end_of(hit);
        let line_bytes = &buf[ls..le];

        let is_ascii = line_bytes.is_ascii();
        let byte_offset_in_line = hit - ls;
        let char_pos = if is_ascii {
            byte_offset_in_line as u32
        } else {
            std::str::from_utf8(&buf[ls..hit])
                .map(|s| s.chars().count() as u32)
                .unwrap_or(byte_offset_in_line as u32)
        };

        let (sel_start, sel_end) = if is_ascii {
            selection_bounds_ascii(line_bytes, byte_offset_in_line, byte_offset_in_line + pat_len)
        } else if let Ok(line) = std::str::from_utf8(line_bytes) {
            selection_bounds_unicode(line, char_pos as usize, (char_pos + pat_char_len) as usize)
        } else {
            (char_pos, char_pos + pat_char_len)
        };

        let line_idx = tracker.line_at(buf, hit);
        results.push(
            line_idx,
            ls as u32,
            le as u32,
            char_pos,
            char_pos + pat_char_len,
            sel_start,
            sel_end,
        );
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
            if process(hit) {
                break;
            }
            pos = line_end_of(hit) + 1;
        }
    } else {
        let first_lower = pat_bytes[0].to_ascii_lowercase();
        let first_upper = pat_bytes[0].to_ascii_uppercase();
        let use_single = first_lower == first_upper;
        let mut pos = 0;

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

            if hit + pat_len > buf.len() {
                break;
            }

            if !buf[hit..hit + pat_len]
                .iter()
                .zip(pat_bytes.iter())
                .all(|(a, b)| a.eq_ignore_ascii_case(b))
            {
                pos = hit + 1;
                continue;
            }

            if process(hit) {
                break;
            }
            pos = line_end_of(hit) + 1;
        }
    }

    results
}

/// Non-ASCII line-by-line fallback returning flat results.
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
        byte_offset = line_byte_end + 1; // +1 for \n

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
            let (sel_start, sel_end) = selection_bounds_unicode(line, char_pos, char_pos + plen);
            results.push(
                idx as u32,
                line_byte_start as u32,
                line_byte_end as u32,
                cp,
                cp + pat_char_len,
                sel_start,
                sel_end,
            );
        }
    }

    results
}

/// Legacy API: search lines array, return old-style SearchMatch objects.
/// Kept for backward compatibility with tests.
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

#[napi]
pub fn search(lines: Vec<String>, pattern: String, limit: Option<u32>) -> Vec<SearchMatch> {
    let text = lines.join("\n");
    let results = search_text(text.clone(), pattern, limit);

    let mut matches = Vec::with_capacity(results.count as usize);
    for i in 0..results.count as usize {
        let line_start = results.line_byte_starts[i] as usize;
        let line_end = (results.line_byte_ends[i] as usize).min(text.len());
        let line_content = text[line_start..line_end].to_string();
        let ms = results.match_starts[i];
        let me = results.match_ends[i];

        matches.push(SearchMatch {
            line_index: results.line_indices[i],
            line_content,
            match_start: ms,
            match_end: me,
            match_indices: (ms..me).collect(),
            selection_start: results.selection_starts[i],
            selection_end: results.selection_ends[i],
            highlights: vec![vec![ms, me]],
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
        let results = search(vec!["function onDidAccept() {".to_string()], "ondid".to_string(), Some(5));
        assert!(!results.is_empty());
        assert_eq!(results[0].match_start, 9);
        assert_eq!(results[0].match_end, 14);
    }

    #[test]
    fn test_selection_bounds_single_word() {
        let results = search(
            vec!["export async function applySelectionFromItem(): boolean {".to_string()],
            "apply".to_string(), Some(5),
        );
        assert!(!results.is_empty());
        assert_eq!(results[0].selection_start, 22);
        assert_eq!(results[0].selection_end, 44);
    }

    #[test]
    fn test_highlights_contiguous() {
        let results = search(vec!["const foo = bar".to_string()], "foo".to_string(), Some(5));
        assert!(!results.is_empty());
        assert_eq!(results[0].highlights, vec![vec![6, 9]]);
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

    #[test]
    fn test_multiline_buffer_search() {
        let lines = vec![
            "first line".to_string(),
            "second line with foo".to_string(),
            "third line".to_string(),
            "fourth foo line".to_string(),
        ];
        let results = search(lines, "foo".to_string(), Some(10));
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].line_index, 1);
        assert_eq!(results[0].line_content, "second line with foo");
        assert_eq!(results[1].line_index, 3);
    }

    #[test]
    fn test_search_text_flat() {
        let text = "first line\nsecond foo line\nthird\nfourth foo".to_string();
        let results = search_text(text, "foo".to_string(), Some(10));
        assert_eq!(results.count, 2);
        assert_eq!(results.line_indices, vec![1, 3]);
        assert_eq!(results.match_starts, vec![7, 7]);
    }
}
