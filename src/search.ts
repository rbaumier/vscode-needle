import * as vscode from "vscode";
import { fuzzySearch } from "../rust-fuzzy";
import { log } from "./logger";

type MatchingInfo = {
  start: number;  // Start of matched pattern in line
  end: number;    // End of matched pattern in line
  wordStart: number;  // Start of whole word containing the match
  wordEnd: number;    // End of whole word containing the match
  indices?: number[];  // Individual character indices that matched (for non-contiguous highlights)
  selection: vscode.Selection;  // Selection of the whole word
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
 * Get the active (focused) vscode document,
 * pattern search it using Rust fuzzy matching
 */
async function findInDocument(pattern: string): Promise<ParsedLine[] | null> {
  log(`findInDocument called with pattern: "${pattern}"`);

  if (pattern.length === 0) {
    log("Empty pattern, returning empty array");
    return [];
  }

  const activeDocument = vscode.window.activeTextEditor?.document;
  if (!activeDocument) {
    log("No active document");
    return null;
  }

  // Split document into lines
  const lines = activeDocument.getText().split("\n");
  log(`Document has ${lines.length} lines`);
  log(`First 3 lines:`, lines.slice(0, 3));

  // Call Rust fuzzy search
  log("Calling Rust fuzzySearch...");
  const matches = fuzzySearch(lines, pattern, 100);
  log(`Rust returned ${matches.length} matches`);

  if (matches.length > 0) {
    log("First 3 matches:", matches.slice(0, 3));
  } else {
    log("No matches found!");
  }

  // Convert Rust results to ParsedLine format
  return matches.map((match) => {
    const lineNumber = match.lineIndex;
    const lineContent = match.lineContent;

    // Find all words in the line with their positions
    const wordRegex = /\w+/g;
    const words: Array<{ start: number; end: number }> = [];
    let wordMatch;
    while ((wordMatch = wordRegex.exec(lineContent)) !== null) {
      words.push({
        start: wordMatch.index,
        end: wordMatch.index + wordMatch[0].length,
      });
    }

    // Find which words contain highlighted characters
    const highlightedWordIndices = new Set<number>();

    // DEBUG: Log matchIndices for ALL lines
    log(`DEBUG line ${lineNumber}: matchIndices = ${match.matchIndices ? `[${match.matchIndices.join(', ')}]` : 'UNDEFINED'}, length = ${match.matchIndices?.length || 0}`);

    for (const charIndex of match.matchIndices) {
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (charIndex >= word.start && charIndex < word.end) {
          highlightedWordIndices.add(i);
          break;
        }
      }
    }

    // Determine selection based on distribution of highlighted characters
    let selectionStart: number;
    let selectionEnd: number;
    let selectionCase: string;

    if (highlightedWordIndices.size === 0) {
      // Fallback: no words found (shouldn't happen)
      selectionStart = match.matchStart;
      selectionEnd = match.matchEnd;
      selectionCase = "Fallback";
    } else if (highlightedWordIndices.size === 1) {
      // Cas A: All highlights in ONE word → select that entire word
      const wordIndex = Array.from(highlightedWordIndices)[0];
      selectionStart = words[wordIndex].start;
      selectionEnd = words[wordIndex].end;
      selectionCase = "Cas A (1 word)";
    } else {
      // Cas B: Highlights span MULTIPLE words → select from first to last word
      const wordIndices = Array.from(highlightedWordIndices).sort((a, b) => a - b);
      const firstWordIndex = wordIndices[0];
      const lastWordIndex = wordIndices[wordIndices.length - 1];
      selectionStart = words[firstWordIndex].start;
      selectionEnd = words[lastWordIndex].end;
      selectionCase = `Cas B (${highlightedWordIndices.size} words)`;
    }

    // Log selection logic for debugging
    if (lineNumber === matches[0]?.lineIndex) {
      log(`Selection logic for first match:`);
      log(`  Line: "${lineContent}"`);
      log(`  Match indices: [${match.matchIndices.join(', ')}]`);
      log(`  Words found: ${words.length}`);
      log(`  Highlighted word indices: [${Array.from(highlightedWordIndices).join(', ')}]`);
      log(`  Selection case: ${selectionCase}`);
      log(`  Selection range: ${selectionStart}-${selectionEnd}`);
      log(`  Selected text: "${lineContent.substring(selectionStart, selectionEnd)}"`);
    }

    return {
      number: String(lineNumber + 1),
      content: lineContent,
      matching: {
        start: match.matchStart,  // Keep pattern position for highlighting
        end: match.matchEnd,
        wordStart: selectionStart,     // Selection boundaries (Cas A or B)
        wordEnd: selectionEnd,
        indices: match.matchIndices,  // Individual character positions for non-contiguous highlights
        selection: new vscode.Selection(
          new vscode.Position(lineNumber, selectionStart),
          new vscode.Position(lineNumber, selectionEnd)
        ),
      },
    };
  });
}

/**
 * Perform a search against a document
 * and return the matching lines as vscode quickPick items
 */
export default async function search(pattern: string): Promise<QuickPickLineItem[]> {
  const matchingLines = await findInDocument(pattern);
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

    if (i === 0) {
      log(`First item highlight calculation:`);
      log(`  Content: "${content}"`);
      log(`  Match indices: [${matching.indices?.join(', ')}]`);
      log(`  Word selection positions: ${matching.wordStart}-${matching.wordEnd}`);
      log(`  Word selected: "${content.substring(matching.wordStart, matching.wordEnd)}"`);
      log(`  Highlights: ${JSON.stringify(highlights)}`);
    }

    return {
      label: `${number}: ${content}`,
      description: "",
      picked: i === 0,
      alwaysShow: true,
      highlights: highlights,
      line,
    };
  });

  log(`Returning ${items.length} QuickPick items`);
  if (items.length > 0) {
    log(`First item: ${items[0].label}`);
  }

  return items;
}
