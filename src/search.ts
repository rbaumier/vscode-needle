// Import VSCode types and utilities for editor integration
import { Position, type QuickPickItem, Selection, window } from "vscode";
// Import Rust fuzzy search bindings and types
import { type DocumentSource, type FuzzyMatch, fuzzySearchDocument } from "../rust-fuzzy";
// Import in-memory cache for search results
import { searchCache } from "./cache";

/**
 * Extended QuickPickItem type that includes the text selection range
 * for navigating to the matched line in the editor
 */
type QuickPickLineItem = QuickPickItem & {
  selection: Selection;
};

// Maximum number of matches to return from fuzzy search
const LIMIT_MATCHES = 100;

/**
 * Converts fuzzy match results from Rust into VSCode QuickPick items
 * with proper highlighting and selection information
 *
 * @param matches - Array of fuzzy matches from the Rust search engine
 * @returns Array of QuickPick items ready to display in VSCode UI
 */
function fuzzyMatchesToQuickPickItems(matches: FuzzyMatch[]): QuickPickLineItem[] {
  return matches.map((match, i) => {
    // Get the zero-indexed line number from the match
    const lineNumber = match.lineIndex;
    // Convert to 1-indexed for display (users expect lines to start at 1)
    const lineNumberStr = String(lineNumber + 1);
    // Get the text content of the matched line
    const lineContent = match.lineContent;

    // Calculate highlight positions in the label
    // Label format: "lineNumber: content"
    const lineNumberPrefix = `${lineNumberStr}: `;
    const prefixLength = lineNumberPrefix.length;

    // Use highlights from Rust (already calculated and grouped into ranges)
    // Adjust the highlight positions by adding the prefix length offset
    // since the Rust engine doesn't account for the "lineNumber: " prefix
    const highlights: [number, number][] = match.highlights.map((h) => [
      prefixLength + h[0],
      prefixLength + h[1],
    ]);

    return {
      // Display format: "123: matched line content"
      label: `${lineNumberStr}: ${lineContent}`,
      description: "",
      // Pre-select the first match for better UX
      picked: i === 0,
      // Force Always show this item, otherwise VSCode will filter it out
      // if the pattern doesn't match it
      alwaysShow: true,
      // Highlight ranges for matched characters
      highlights,
      // Selection range to apply when user picks this item
      // This determines what text gets selected in the editor
      selection: new Selection(
        new Position(lineNumber, match.selectionStart),
        new Position(lineNumber, match.selectionEnd)
      ),
    };
  });
}

/**
 * Searches the currently active VSCode document using Rust-powered fuzzy matching
 *
 * This function implements a hybrid optimization approach:
 * - Uses in-memory cache to avoid redundant searches
 * - Passes file paths for saved files (Rust reads directly - faster)
 * - Passes text content for unsaved/dirty files (ensures accuracy)
 *
 * @param pattern - Search query string to match against document lines
 * @returns Array of fuzzy matches, empty array if no pattern, or null if no active document
 */
function findInDocument(pattern: string): FuzzyMatch[] | null {
  // Early return for empty search pattern
  if (pattern.length === 0) {
    return [];
  }

  // Get the currently focused document in the editor
  const activeDocument = window.activeTextEditor?.document;
  if (!activeDocument) {
    return null;
  }

  // Extract file path and version for cache key
  const filePath = activeDocument.uri.fsPath;
  const fileVersion = activeDocument.version;

  // Check TypeScript in-memory cache first to avoid redundant Rust calls
  const cached = searchCache.get(filePath, pattern, fileVersion);
  if (cached) {
    return cached;
  }

  // Determine document source using hybrid approach for optimal performance
  const documentSource: DocumentSource = (() => {
    if (activeDocument.isDirty || activeDocument.isUntitled) {
      // Document has unsaved changes or is new: pass text content directly
      // This ensures we search the current editor state, not stale file content
      return {
        text: activeDocument.getText(),
        path: undefined,
      };
    }
    // Document is clean and saved: pass file path for Rust to read directly
    // This is faster as Rust can optimize file I/O
    const fsPath = activeDocument.uri.fsPath;
    return {
      text: undefined,
      path: fsPath,
    };
  })();

  // Execute the fuzzy search using the native Rust implementation
  const matches = fuzzySearchDocument(documentSource, pattern, LIMIT_MATCHES);

  // Store results in TypeScript cache for future searches with the same pattern
  // Cache is invalidated automatically when document version changes
  searchCache.set(filePath, pattern, fileVersion, matches);

  return matches;
}

/**
 * Main search function that coordinates the entire search pipeline
 *
 * This is the primary entry point for the VSCode extension's search feature.
 * It orchestrates:
 * 1. Finding matches in the active document using Rust fuzzy search
 * 2. Converting matches to VSCode QuickPick items with highlighting
 *
 * @param pattern - User's search query string
 * @returns Array of QuickPick items ready for display, or empty array if no matches/document
 */
export default function search(pattern: string): QuickPickLineItem[] {
  // Execute the fuzzy search against the active document
  const matches = findInDocument(pattern);
  if (!matches) {
    return [];
  }

  // Transform Rust matches into VSCode UI-ready QuickPick items
  return fuzzyMatchesToQuickPickItems(matches);
}
