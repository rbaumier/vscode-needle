import { Position, type QuickPickItem, Selection, window } from "vscode";
import { type DocumentSource, type FuzzyMatch, fuzzySearchDocument } from "../rust-fuzzy";
import { searchCache } from "./cache";

type MatchingInfo = {
  start: number; // Start of matched pattern in line
  end: number; // End of matched pattern in line
  wordStart: number; // Start of whole word containing the match
  wordEnd: number; // End of whole word containing the match
  indices?: number[]; // Individual character indices that matched (for non-contiguous highlights)
  selection: Selection; // Selection of the whole word
};

type ParsedLine = {
  number: string;
  content: string;
  matching: MatchingInfo;
};

type QuickPickLineItem = QuickPickItem & {
  line: ParsedLine;
};

const LIMIT_MATCHES = 100;

/**
 * Convert cached FuzzyMatch results to ParsedLine format
 */
function convertCachedToParseLines(matches: FuzzyMatch[]): ParsedLine[] {
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
        selection: new Selection(
          new Position(lineNumber, selectionStart),
          new Position(lineNumber, selectionEnd)
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
  if (pattern.length === 0) {
    return [];
  }

  const activeDocument = window.activeTextEditor?.document;
  if (!activeDocument) {
    return null;
  }

  const filePath = activeDocument.uri.fsPath;
  const fileVersion = activeDocument.version;

  // Check TypeScript cache first
  const cached = searchCache.get(filePath, pattern, fileVersion);
  if (cached) {
    return convertCachedToParseLines(cached);
  }

  // Determine document source (hybrid approach)
  let documentSource: DocumentSource;

  if (activeDocument.isDirty || activeDocument.isUntitled) {
    // Document is dirty or unsaved: pass text content
    documentSource = {
      text: activeDocument.getText(),
      path: undefined,
    };
  } else {
    // Document is clean and saved: pass file path for Rust to read directly
    const fsPath = activeDocument.uri.fsPath;
    documentSource = {
      text: undefined,
      path: fsPath,
    };
  }

  const matches = fuzzySearchDocument(documentSource, pattern, LIMIT_MATCHES);

  // Store in TypeScript cache for future searches
  searchCache.set(filePath, pattern, fileVersion, matches);

  // Convert Rust results to ParsedLine format
  const result = matches.map((match) => {
    const lineNumber = match.lineIndex;
    const lineContent = match.lineContent;

    // Use selection bounds calculated by Rust (Cas A or Cas B)
    const selectionStart = match.selectionStart;
    const selectionEnd = match.selectionEnd;

    return {
      number: String(lineNumber + 1),
      content: lineContent,
      matching: {
        start: match.matchStart, // Pattern position for highlighting
        end: match.matchEnd,
        wordStart: selectionStart, // Selection boundaries (Cas A or B from Rust)
        wordEnd: selectionEnd,
        indices: match.matchIndices, // Individual character positions for non-contiguous highlights
        selection: new Selection(
          new Position(lineNumber, selectionStart),
          new Position(lineNumber, selectionEnd)
        ),
      },
    };
  });

  return result;
}

/**
 * Perform a search against a document
 * and return the matching lines as vscode quickPick items
 */
export default function search(pattern: string): QuickPickLineItem[] {
  const matchingLines = findInDocument(pattern);
  if (!matchingLines) {
    return [];
  }

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

    return {
      label: `${number}: ${content}`,
      description: "",
      picked: i === 0,
      alwaysShow: true,
      highlights,
      line,
    };
  });

  return items;
}
