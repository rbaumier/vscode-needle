import * as vscode from "vscode";
import { fuzzySearch, fuzzySearchDocument, DocumentSource } from "../rust-fuzzy";
import { log } from "./logger";
import { searchCache } from "./cache";

type MatchingInfo = {
  start: number; // Start of matched pattern in line
  end: number; // End of matched pattern in line
  wordStart: number; // Start of whole word containing the match
  wordEnd: number; // End of whole word containing the match
  indices?: number[]; // Individual character indices that matched (for non-contiguous highlights)
  selection: vscode.Selection; // Selection of the whole word
};

type ParsedLine = {
  number: string;
  content: string;
  matching: MatchingInfo;
};

interface QuickPickLineItem extends vscode.QuickPickItem {
  line: ParsedLine;
}

/**
 * Convert cached FuzzyMatch results to ParsedLine format
 */
function convertCachedToParseLines(matches: typeof import("../rust-fuzzy").FuzzyMatch[]): ParsedLine[] {
  return matches.map((match) => {
    const lineNumber = match.lineIndex;
    const lineContent = match.lineContent;
    const selectionStart = match.selectionStart;
    const selectionEnd = match.selectionEnd;

    return {
      number: String(lineNumber + 1),
      content: lineContent,
      matching: {
        start: match.matchStart,
        end: match.matchEnd,
        wordStart: selectionStart,
        wordEnd: selectionEnd,
        indices: match.matchIndices,
        selection: new vscode.Selection(
          new vscode.Position(lineNumber, selectionStart),
          new vscode.Position(lineNumber, selectionEnd)
        ),
      },
    };
  });
}

/**
 * Get the active (focused) vscode document,
 * pattern search it using Rust fuzzy matching
 */
function findInDocument(pattern: string): ParsedLine[] | null {
  const startTotal = performance.now();
  log(`[TS PERF] findInDocument called with pattern: "${pattern}"`);

  if (pattern.length === 0) {
    log("Empty pattern, returning empty array");
    return [];
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (!activeDocument) {
    log("No active document");
    return null;
  }

  const filePath = activeDocument.uri.fsPath;
  const fileVersion = activeDocument.version;

  // Check TypeScript cache first
  const cached = searchCache.get(filePath, pattern, fileVersion);
  if (cached) {
    log(`[TS CACHE HIT] Returning ${cached.length} cached results`);
    return convertCachedToParseLines(cached);
  }

  // Determine document source (hybrid approach)
  const prepareStart = performance.now();
  let documentSource: DocumentSource;

  if (activeDocument.isDirty || activeDocument.isUntitled) {
    // Document is dirty or unsaved: pass text content
    log("[TS] Document is dirty/unsaved, using getText()");
    documentSource = {
      text: activeDocument.getText(),
      path: undefined,
    };
  } else {
    // Document is clean and saved: pass file path for Rust to read directly
    const fsPath = activeDocument.uri.fsPath;
    log(`[TS] Document is clean, using file path: ${fsPath}`);
    documentSource = {
      text: undefined,
      path: fsPath,
    };
  }
  const prepareTime = performance.now() - prepareStart;

  log(`[TS PERF] Document prepare: ${prepareTime.toFixed(2)}ms`);

  // Call Rust fuzzy search with hybrid document source
  const startRust = performance.now();
  const matches = fuzzySearchDocument(documentSource, pattern, 100);
  const rustTime = performance.now() - startRust;

  log(`[TS PERF] Rust fuzzySearch: ${matches.length} matches in ${rustTime.toFixed(2)}ms`);

  // Store in TypeScript cache for future searches
  searchCache.set(filePath, pattern, fileVersion, matches);

  // Convert Rust results to ParsedLine format
  const startConversion = performance.now();
  const result = matches.map((match) => {
    const lineNumber = match.lineIndex;
    const lineContent = match.lineContent;

    // Use selection bounds calculated by Rust (Cas A or Cas B)
    const selectionStart = match.selectionStart;
    const selectionEnd = match.selectionEnd;

    // Log selection info for first match (debugging)
    if (lineNumber === matches[0]?.lineIndex) {
      log("Selection info for first match:");
      log(`  Line: "${lineContent}"`);
      log(`  Match indices: [${match.matchIndices.join(", ")}]`);
      log(`  Selection range: ${selectionStart}-${selectionEnd}`);
      log(`  Selected text: "${lineContent.substring(selectionStart, selectionEnd)}"`);
    }

    return {
      number: String(lineNumber + 1),
      content: lineContent,
      matching: {
        start: match.matchStart, // Pattern position for highlighting
        end: match.matchEnd,
        wordStart: selectionStart, // Selection boundaries (Cas A or B from Rust)
        wordEnd: selectionEnd,
        indices: match.matchIndices, // Individual character positions for non-contiguous highlights
        selection: new vscode.Selection(
          new vscode.Position(lineNumber, selectionStart),
          new vscode.Position(lineNumber, selectionEnd)
        ),
      },
    };
  });
  const conversionTime = performance.now() - startConversion;
  const totalTime = performance.now() - startTotal;

  log(`[TS PERF] Conversion to ParsedLine: ${conversionTime.toFixed(2)}ms`);
  log(`[TS PERF] ───────────────────────────────────`);
  log(`[TS PERF] TOTAL findInDocument: ${totalTime.toFixed(2)}ms`);
  log(`[TS PERF]   ├─ Document prepare:  ${prepareTime.toFixed(2)}ms (${((prepareTime/totalTime)*100).toFixed(1)}%)`);
  log(`[TS PERF]   ├─ Rust fuzzySearch:  ${rustTime.toFixed(2)}ms (${((rustTime/totalTime)*100).toFixed(1)}%)`);
  log(`[TS PERF]   └─ Result conversion: ${conversionTime.toFixed(2)}ms (${((conversionTime/totalTime)*100).toFixed(1)}%)`);

  return result;
}

/**
 * Perform a search against a document
 * and return the matching lines as vscode quickPick items
 */
export default function search(pattern: string): QuickPickLineItem[] {
  const startSearch = performance.now();

  const matchingLines = findInDocument(pattern);
  if (!matchingLines) {
    return [];
  }

  const startItemCreation = performance.now();
  const items = matchingLines.map((line, i) => {
    const { number, content, matching } = line;

    // Calculate highlight positions in the label
    // Label format: "lineNumber: content"
    const lineNumberPrefix = `${number}: `;
    const prefixLength = lineNumberPrefix.length;

    // Create individual highlights for each matched character
    // This allows highlighting non-contiguous matches like "onddaccept" -> "onDidAccept"
    const highlights: [number, number][] = [];

    if (matching.indices && matching.indices.length > 0) {
      // Group consecutive indices into ranges for efficient highlighting
      let rangeStart = matching.indices[0];
      let rangeEnd = matching.indices[0] + 1;

      for (let j = 1; j < matching.indices.length; j++) {
        const currentIdx = matching.indices[j];
        if (currentIdx === rangeEnd) {
          // Consecutive index, extend the range
          rangeEnd = currentIdx + 1;
        } else {
          // Gap found, save current range and start new one
          highlights.push([prefixLength + rangeStart, prefixLength + rangeEnd]);
          rangeStart = currentIdx;
          rangeEnd = currentIdx + 1;
        }
      }
      // Add the last range
      highlights.push([prefixLength + rangeStart, prefixLength + rangeEnd]);
    } else {
      // Fallback to old behavior if no indices (shouldn't happen)
      highlights.push([prefixLength + matching.start, prefixLength + matching.end]);
    }

    if (i === 0) {
      log("First item highlight calculation:");
      log(`  Content: "${content}"`);
      log(`  Match indices: [${matching.indices?.join(", ")}]`);
      log(`  Word selection positions: ${matching.wordStart}-${matching.wordEnd}`);
      log(`  Word selected: "${content.substring(matching.wordStart, matching.wordEnd)}"`);
      log(`  Highlights: ${JSON.stringify(highlights)}`);
    }

    return {
      label: `${number}: ${content}`,
      description: "",
      picked: i === 0,
      alwaysShow: true,
      highlights,
      line,
    };
  });

  const itemCreationTime = performance.now() - startItemCreation;
  const totalSearchTime = performance.now() - startSearch;

  log(`[TS PERF] QuickPick item creation: ${itemCreationTime.toFixed(2)}ms`);
  log(`[TS PERF] ═══════════════════════════════════`);
  log(`[TS PERF] TOTAL SEARCH TIME: ${totalSearchTime.toFixed(2)}ms`);
  log(`[TS PERF] ═══════════════════════════════════\n`);

  return items;
}
