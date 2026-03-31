use std::fs;
use std::io::{self, BufRead};

use memchr::memmem;
use napi_derive::napi;

/// Count UTF-16 code units in a UTF-8 byte slice.
/// This matches JavaScript's String.length / String.substring() indexing.
/// Fast path: pure ASCII => byte count == UTF-16 count (zero overhead).
#[inline]
fn utf16_len(bytes: &[u8]) -> u32 {
    if bytes.is_ascii() {
        return bytes.len() as u32;
    }
    std::str::from_utf8(bytes)
        .map(|s| s.chars().map(|c| c.len_utf16() as u32).sum())
        .unwrap_or(bytes.len() as u32)
}

/// Normalize \r\n to \n in-place. Returns the normalized string.
#[inline]
fn normalize_crlf(text: String) -> String {
    if memchr::memchr(b'\r', text.as_bytes()).is_some() {
        text.replace("\r\n", "\n")
    } else {
        text
    }
}

/// Flat search results — parallel arrays, no per-match allocations.
/// All offsets are UTF-16 code unit offsets (compatible with JS String.substring).
#[napi(object)]
pub struct SearchResults {
    pub count: u32,
    pub line_indices: Vec<u32>,
    pub line_starts: Vec<u32>,
    pub line_ends: Vec<u32>,
    pub match_starts: Vec<u32>,
    pub match_ends: Vec<u32>,
}

impl SearchResults {
    fn with_capacity(cap: usize) -> Self {
        Self {
            count: 0,
            line_indices: Vec::with_capacity(cap),
            line_starts: Vec::with_capacity(cap),
            line_ends: Vec::with_capacity(cap),
            match_starts: Vec::with_capacity(cap),
            match_ends: Vec::with_capacity(cap),
        }
    }

    #[inline]
    fn push(&mut self, line_index: u32, line_start: u32, line_end: u32, match_start: u32, match_end: u32) {
        self.line_indices.push(line_index);
        self.line_starts.push(line_start);
        self.line_ends.push(line_end);
        self.match_starts.push(match_start);
        self.match_ends.push(match_end);
        self.count += 1;
    }
}

/// SIMD byte-level search on a \n-normalized buffer.
/// Returns UTF-16 code unit offsets for JS compatibility.
fn search_bytes_flat(
    buf: &[u8],
    pat_bytes: &[u8],
    pat_utf16_len: u32,
    limit: usize,
    case_insensitive: bool,
) -> SearchResults {
    if buf.is_empty() {
        return SearchResults::with_capacity(0);
    }

    let mut results = SearchResults::with_capacity(limit.min(1000));
    let pat_len = pat_bytes.len();

    let mut line_count: u32 = 0;
    let mut counted_to: usize = 0;

    let mut process_hit = |hit: usize| -> bool {
        let ls = match memchr::memrchr(b'\n', &buf[..hit]) {
            Some(p) => p + 1,
            None => 0,
        };
        let le = match memchr::memchr(b'\n', &buf[hit..]) {
            Some(p) => hit + p,
            None => buf.len(),
        };

        // Incremental line counting
        if hit > counted_to {
            line_count += memchr::memchr_iter(b'\n', &buf[counted_to..hit]).count() as u32;
            counted_to = hit;
        }

        // Convert byte offsets to UTF-16 code unit offsets
        let utf16_ls = utf16_len(&buf[..ls]);
        let utf16_line_len = utf16_len(&buf[ls..le]);
        let utf16_match_pos = utf16_len(&buf[ls..hit]);

        results.push(
            line_count,
            utf16_ls,
            utf16_ls + utf16_line_len,
            utf16_match_pos,
            utf16_match_pos + pat_utf16_len,
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

            if process_hit(hit) {
                break;
            }

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

            if process_hit(hit) {
                break;
            }

            pos = match memchr::memchr(b'\n', &buf[hit..]) {
                Some(p) => hit + p + 1,
                None => buf.len(),
            };
        }
    }

    results
}

/// Non-ASCII line-by-line fallback. Returns UTF-16 code unit offsets.
fn search_lines_flat(text: &str, pattern: &str, limit: usize) -> SearchResults {
    let pattern_chars: Vec<char> = pattern
        .chars()
        .map(|c| c.to_lowercase().next().unwrap_or(c))
        .collect();
    let plen = pattern_chars.len();
    let pat_utf16_len: u32 = pattern.chars().map(|c| c.len_utf16() as u32).sum();
    let mut results = SearchResults::with_capacity(limit.min(1000));
    let mut utf16_offset: u32 = 0;

    for (idx, line) in text.lines().enumerate() {
        if results.count as usize >= limit {
            break;
        }

        let line_utf16_len: u32 = line.chars().map(|c| c.len_utf16() as u32).sum();
        let line_utf16_start = utf16_offset;
        let line_utf16_end = utf16_offset + line_utf16_len;
        // +1 for \n (text is already \r\n-normalized at this point)
        utf16_offset = line_utf16_end + 1;

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
            // Convert char position to UTF-16 offset within line
            let utf16_match_pos: u32 = line_chars[..char_pos]
                .iter()
                .map(|c| c.len_utf16() as u32)
                .sum();
            results.push(
                idx as u32,
                line_utf16_start,
                line_utf16_end,
                utf16_match_pos,
                utf16_match_pos + pat_utf16_len,
            );
        }
    }

    results
}

/// Search text buffer (from VS Code getText()). Returns UTF-16 code unit offsets.
#[napi]
pub fn search_text(text: String, pattern: String, limit: Option<u32>) -> SearchResults {
    if pattern.is_empty() || text.is_empty() {
        return SearchResults::with_capacity(0);
    }

    // Guard: u32 offset overflow
    if text.len() > u32::MAX as usize {
        return SearchResults::with_capacity(0);
    }

    let limit = limit.unwrap_or(100) as usize;
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());

    // Normalize \r\n to \n for consistent offset calculation
    let text = normalize_crlf(text);

    if pattern.is_ascii() {
        let pat_utf16_len = pattern.len() as u32; // ASCII: byte len == UTF-16 len
        return search_bytes_flat(text.as_bytes(), pattern.as_bytes(), pat_utf16_len, limit, case_insensitive);
    }

    search_lines_flat(&text, &pattern, limit)
}

/// Search file by path. Returns UTF-16 code unit offsets.
#[napi]
pub fn search_file(path: String, pattern: String, limit: Option<u32>) -> SearchResults {
    if pattern.is_empty() {
        return SearchResults::with_capacity(0);
    }

    let limit = limit.unwrap_or(100) as usize;
    let case_insensitive = !pattern.chars().any(|c| c.is_uppercase());

    let file = match fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return SearchResults::with_capacity(0),
    };

    // Guard: u32 offset overflow for files > 4 GiB
    if let Ok(meta) = file.metadata() {
        if meta.len() > u32::MAX as u64 {
            return SearchResults::with_capacity(0);
        }
    }

    if pattern.is_ascii() {
        // SAFETY: file is opened read-only for the duration of the search.
        // Concurrent truncation by another process could cause SIGBUS on POSIX;
        // this is acceptable for a VS Code extension searching source files.
        let mmap = match unsafe { memmap2::Mmap::map(&file) } {
            Ok(m) => m,
            Err(_) => return SearchResults::with_capacity(0),
        };
        // Normalize \r\n in mmap buffer — search_bytes_flat expects \n only
        let buf = if memchr::memchr(b'\r', &mmap).is_some() {
            std::borrow::Cow::Owned(mmap.iter().copied().filter(|&b| b != b'\r').collect::<Vec<u8>>())
        } else {
            std::borrow::Cow::Borrowed(mmap.as_ref())
        };
        let pat_utf16_len = pattern.len() as u32;
        return search_bytes_flat(&buf, pattern.as_bytes(), pat_utf16_len, limit, case_insensitive);
    }

    // Non-ASCII fallback: read + normalize
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

fn selection_bounds_unicode(chars: &[char], match_start: usize, match_end: usize) -> (u32, u32) {
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    let mut s = match_start;
    while s > 0 && is_word(chars[s - 1]) { s -= 1; }
    let mut e = match_end;
    while e < chars.len() && is_word(chars[e]) { e += 1; }
    // Convert char positions to UTF-16 offsets
    let utf16_s: u32 = chars[..s].iter().map(|c| c.len_utf16() as u32).sum();
    let utf16_e: u32 = chars[..e].iter().map(|c| c.len_utf16() as u32).sum();
    (utf16_s, utf16_e)
}

#[napi]
pub fn search(lines: Vec<String>, pattern: String, limit: Option<u32>) -> Vec<SearchMatch> {
    if pattern.is_empty() {
        return vec![];
    }

    let text = normalize_crlf(lines.join("\n"));
    let results = search_text(text.clone(), pattern, limit);
    let text_lines: Vec<&str> = text.split('\n').collect();

    let mut matches = Vec::with_capacity(results.count as usize);
    for i in 0..results.count as usize {
        let line_idx = results.line_indices[i] as usize;
        let line = text_lines.get(line_idx).copied().unwrap_or("");
        let ms = results.match_starts[i] as usize;
        let me = results.match_ends[i] as usize;

        let line_chars: Vec<char> = line.chars().collect();
        // Convert UTF-16 offsets to char positions for selection bounds
        let (char_ms, char_me) = if line.is_ascii() {
            (ms, me) // ASCII: UTF-16 offset == char position
        } else {
            // Walk chars accumulating UTF-16 units to find char positions
            let mut utf16_acc = 0usize;
            let mut cms = 0usize;
            let mut cme = 0usize;
            for (ci, ch) in line_chars.iter().enumerate() {
                if utf16_acc == ms { cms = ci; }
                utf16_acc += ch.len_utf16();
                if utf16_acc == me { cme = ci + 1; }
            }
            (cms, cme)
        };
        let (ss, se) = if line.is_ascii() {
            selection_bounds_ascii(line.as_bytes(), char_ms, char_me)
        } else {
            selection_bounds_unicode(&line_chars, char_ms, char_me)
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
        let r = search(
            vec!["export async function applySelectionFromItem(): boolean {".to_string()],
            "apply".to_string(), Some(5),
        );
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

    #[test]
    fn test_emoji_offsets() {
        // 🎉 is 1 char in Rust but 2 UTF-16 code units (surrogate pair)
        let r = search(vec!["🎉 foo".to_string()], "foo".to_string(), Some(5));
        assert!(!r.is_empty());
        // "🎉" = 2 UTF-16 code units, " " = 1, so "foo" starts at UTF-16 index 3
        assert_eq!(r[0].match_start, 3);
        assert_eq!(r[0].match_end, 6);
    }

    #[test]
    fn test_crlf_offsets() {
        let r = search_text("first\r\nsecond foo\r\nthird".to_string(), "foo".to_string(), Some(10));
        assert_eq!(r.count, 1);
        assert_eq!(r.line_indices[0], 1);
        // After CRLF normalization: "first\nsecond foo\nthird"
        // "second foo" starts at offset 6, "foo" at offset 13
        assert_eq!(r.match_starts[0], 7);
    }
}
