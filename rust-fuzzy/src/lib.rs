use napi_derive::napi;
use nucleo_matcher::{Matcher, Config, Utf32String};
use nucleo_matcher::pattern::{Pattern, CaseMatching, Normalization};
use std::time::Instant;

/// Word structure for selection bounds calculation
#[derive(Debug)]
struct Word {
    start: usize,
    end: usize,
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

#[napi(object)]
pub struct FuzzyMatch {
    pub line_index: u32,
    pub line_content: String,
    pub score: i32,
    pub match_start: u32,
    pub match_end: u32,
    pub match_indices: Vec<u32>,  // Individual character positions that matched
    pub selection_start: u32,     // Start of selection (Cas A or B)
    pub selection_end: u32,       // End of selection (Cas A or B)
}

/// Document source: either text content or file path
#[napi(object)]
pub struct DocumentSource {
    /// Text content (if document is dirty or unsaved)
    pub text: Option<String>,
    /// File path (if document is clean and saved)
    pub path: Option<String>,
}

/// Fuzzy search from document source (hybrid: text or file path)
/// Returns matches sorted by score (best first)
#[napi]
pub fn fuzzy_search_document(source: DocumentSource, pattern: String, limit: Option<u32>) -> Vec<FuzzyMatch> {
    use std::fs;
    use std::io::{self, BufRead};

    let total_start = Instant::now();

    if pattern.is_empty() {
        return vec![];
    }

    // Read document: either from text or file path
    #[cfg(feature = "perf-logging")]
    let read_start = Instant::now();

    let lines: Vec<String> = if let Some(text) = source.text {
        // Text provided: split into lines
        text.lines().map(|s| s.to_string()).collect()
    } else if let Some(path) = source.path {
        // Path provided: read file directly
        match fs::File::open(&path) {
            Ok(file) => {
                io::BufReader::new(file)
                    .lines()
                    .filter_map(|line| line.ok())
                    .collect()
            }
            Err(_e) => {
                #[cfg(feature = "perf-logging")]
                eprintln!("[RUST ERROR] Failed to read file '{}': {}", path, _e);
                return vec![];
            }
        }
    } else {
        #[cfg(feature = "perf-logging")]
        eprintln!("[RUST ERROR] DocumentSource must have either text or path");
        return vec![];
    };

    #[cfg(feature = "perf-logging")]
    {
        let read_time = read_start.elapsed();
        eprintln!("[RUST PERF] Read document:       {:>8.2?} ({} lines)", read_time, lines.len());
    }

    // Call existing fuzzy_search logic
    fuzzy_search_internal(lines, pattern, limit, total_start)
}

/// Legacy function for backward compatibility (deprecated)
/// Use fuzzy_search_document instead
#[napi]
pub fn fuzzy_search(lines: Vec<String>, pattern: String, limit: Option<u32>) -> Vec<FuzzyMatch> {
    fuzzy_search_internal(lines, pattern, limit, Instant::now())
}

/// Internal fuzzy search implementation
fn fuzzy_search_internal(lines: Vec<String>, pattern: String, limit: Option<u32>, #[allow(unused_variables)] total_start: Instant) -> Vec<FuzzyMatch> {
    if pattern.is_empty() {
        return vec![];
    }

    let limit = limit.unwrap_or(100) as usize;

    #[cfg(feature = "perf-logging")]
    let init_start = Instant::now();

    let nucleo_pattern = Pattern::parse(
        &pattern,
        CaseMatching::Ignore,   // Case-insensitive matching
        Normalization::Never,   // No Unicode normalization
    );

    #[cfg(feature = "perf-logging")]
    let init_time = init_start.elapsed();

    // Calculate scores and filter out non-matching lines
    // Note: Parallelization with Rayon was tested but Pattern cannot be shared between threads
    // Each thread would need to recreate the pattern, which is slower than sequential processing
    #[cfg(feature = "perf-logging")]
    let matching_start = Instant::now();

    // Use sequential iteration (fastest for Nucleo pattern matching)
    let mut matcher = Matcher::new(Config::DEFAULT);
    // Pre-allocate for ~1% match rate (conservative estimate)
    let mut results: Vec<(usize, u32, Vec<u32>)> = Vec::with_capacity(lines.len() / 100);

    for (idx, line) in lines.iter().enumerate() {
        let line_utf32 = Utf32String::from(line.as_str());
        let mut indices = Vec::new();
        let score = nucleo_pattern.indices(line_utf32.slice(..), &mut matcher, &mut indices);

        // Only keep if Nucleo found a match (score > 0)
        if let Some(score_value) = score {
            results.push((idx, score_value, indices));
        }
    }

    #[cfg(feature = "perf-logging")]
    let matching_total_time = matching_start.elapsed();

    // Sort by score (descending) - best matches first
    #[cfg(feature = "perf-logging")]
    let sort_start = Instant::now();

    results.sort_by(|a, b| b.1.cmp(&a.1));

    #[cfg(feature = "perf-logging")]
    let sort_time = sort_start.elapsed();

    // Store match count before consuming results
    #[cfg(feature = "perf-logging")]
    let match_count = results.len();

    // Take top matches and convert to FuzzyMatch
    #[cfg(feature = "perf-logging")]
    let conversion_start = Instant::now();
    #[cfg(feature = "perf-logging")]
    let mut selection_bounds_time = std::time::Duration::ZERO;

    let output = results
        .into_iter()
        .take(limit)
        .map(|(idx, score, indices)| {
            // Calculate match start/end from indices
            let (start, end) = if !indices.is_empty() {
                let first = *indices.first().unwrap() as usize;
                let last = *indices.last().unwrap() as usize + 1;
                (first as u32, last as u32)
            } else {
                (0, 0)
            };

            // Calculate selection bounds using the helper function
            #[cfg(feature = "perf-logging")]
            let bounds_start = Instant::now();

            let (sel_start, sel_end) = calculate_selection_bounds(&lines[idx], &indices);

            #[cfg(feature = "perf-logging")]
            {
                selection_bounds_time += bounds_start.elapsed();
            }

            FuzzyMatch {
                line_index: idx as u32,
                line_content: lines[idx].clone(),
                score: score as i32,
                match_start: start,
                match_end: end,
                match_indices: indices,
                selection_start: sel_start as u32,
                selection_end: sel_end as u32,
            }
        })
        .collect();

    #[cfg(feature = "perf-logging")]
    let conversion_time = conversion_start.elapsed();
    #[cfg(feature = "perf-logging")]
    let total_time = total_start.elapsed();

    // Log performance metrics
    #[cfg(feature = "perf-logging")]
    {
        eprintln!("[RUST PERF] Total lines: {}", lines.len());
        eprintln!("[RUST PERF] Pattern: '{}' (length: {})", pattern, pattern.len());
        eprintln!("[RUST PERF] Matches found: {}", match_count);
        eprintln!("[RUST PERF] ───────────────────────────────────");
        eprintln!("[RUST PERF] Init Nucleo:         {:>8.2?}", init_time);
        eprintln!("[RUST PERF] Matching phase:      {:>8.2?}", matching_total_time);
        eprintln!("[RUST PERF] Sort results:        {:>8.2?}", sort_time);
        eprintln!("[RUST PERF] Conversion:          {:>8.2?}", conversion_time);
        eprintln!("[RUST PERF]   └─ Selection bounds:{:>8.2?}", selection_bounds_time);
        eprintln!("[RUST PERF] ───────────────────────────────────");
        eprintln!("[RUST PERF] TOTAL TIME:          {:>8.2?}", total_time);
        eprintln!("[RUST PERF] ═══════════════════════════════════\n");
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper function to test fuzzy search with selection bounds
    /// Reduces duplication across all test cases
    fn assert_selection(
        test_name: &str,
        line: &str,
        query: &str,
        expected_start: u32,
        expected_end: u32,
        expected_text: &str,
    ) {
        let results = fuzzy_search(vec![line.to_string()], query.to_string(), Some(5));

        assert!(!results.is_empty(), "Should find match for '{}'", query);
        let result = &results[0];

        println!("\n=== {} ===", test_name);
        println!("Query: '{}'", query);
        println!("Line: {}", result.line_content);
        println!("Match indices: {:?}", result.match_indices);
        println!("Selection: {}-{}", result.selection_start, result.selection_end);
        println!("Selected text: '{}'", &line[result.selection_start as usize..result.selection_end as usize]);

        assert_eq!(result.selection_start, expected_start,
                   "Selection start should be {}", expected_start);
        assert_eq!(result.selection_end, expected_end,
                   "Selection end should be {}", expected_end);
        assert_eq!(&line[result.selection_start as usize..result.selection_end as usize],
                   expected_text,
                   "Should select '{}'", expected_text);
    }

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
        } else {
            panic!("No results found for 'ondid'");
        }
    }

    #[test]
    fn test_case_1_apply_cas_a() {
        assert_selection(
            "Test Case 1: 'apply' → Cas A (1 word)",
            "export async function applySelectionFromItem(): boolean {",
            "apply",
            22,
            44,
            "applySelectionFromItem",
        );
    }

    #[test]
    fn test_case_3_expfnitem_cas_b() {
        assert_selection(
            "Test Case 3: 'expfnitem' → Cas B (3 words)",
            "export async function applySelectionFromItem(): boolean {",
            "expfnitem",
            0,
            44,
            "export async function applySelectionFromItem",
        );
    }

    #[test]
    fn test_case_4_afrom_cas_a() {
        assert_selection(
            "Test Case 4: 'afrom' → Cas A (1 word, distant chars)",
            "export async function applySelectionFromItem(): boolean {",
            "afrom",
            22,
            44,
            "applySelectionFromItem",
        );
    }

    #[test]
    fn test_case_5_asyncbool_cas_b() {
        assert_selection(
            "Test Case 5: 'asyncbool' → Cas B (2 blocks)",
            "export async function applySelectionFromItem(): boolean {",
            "asyncbool",
            7,
            55,
            "async function applySelectionFromItem(): boolean",
        );
    }

    #[test]
    fn test_case_6_msv_cas_a() {
        assert_selection(
            "Test Case 6: 'msv' → Cas A (identifier with underscores)",
            "const my_super_variable = 42;",
            "msv",
            6,
            23,
            "my_super_variable",
        );
    }

    #[test]
    fn test_case_7_tdfix_cas_b() {
        assert_selection(
            "Test Case 7: 'tdfix' → Cas B (2 words in comment)",
            "// TODO: fix this issue now",
            "tdfix",
            3,
            12,
            "TODO: fix",
        );
    }
}
